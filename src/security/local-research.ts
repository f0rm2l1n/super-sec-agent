import { randomUUID } from 'node:crypto'
import { ContinuousResearch, pendingLocalRequests } from './continuous-research.ts'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { followupOwners, type Engine, type Trigger, type ReceiveResult } from '../core/index.ts'
import type { Store, Receipt } from '../app/store.ts'
import type { Prompts, PromptConfig } from '../app/prompts.ts'
import { record } from '../kv.ts'
import { SettingsSchema } from '../policy.ts'
import type { SourceKind } from '../sources/kind.ts'
import { checkWorkspace, createWorkspaceProfile } from './workspace.ts'
import { LocalInbox } from './local-inbox.ts'

const bindingKey = record<{ workspace: string; id: string; profile: PromptConfig }>('local-research-binding')
export const LocalMessageSchema = z.object({
  id: z.string().uuid(), text: z.string().trim().min(1).max(20_000),
  kind: z.enum(['question', 'correction']).default('question'),
}).strict()

/** Replies are already persisted by Outbox. Delivering locally requires no external service. */
export const localKind: SourceKind = {
  kind: 'local', title: { zh: '本地研究', en: 'Local research' },
  description: { zh: '此研究工作区的本地用户问答与订正', en: 'Local questions and corrections for this research workspace' },
  schema: z.object({}).strict(), fields: [], health: [],
  channel: { send: async () => 'sent', link: () => ({ url: '', label: { zh: '本地研究', en: 'Local research' } }) },
}

/** A local request conflict or operator-correctable intake error. */
export class LocalResearchError extends Error {
  constructor(message: string, readonly status: 400 | 409 = 400) { super(message) }
}
interface LocalHost {
  store: Store
  prompts: Prompts
  engine: Pick<Engine, 'decide' | 'bindThread' | 'note' | 'report' | 'retryTicket'>
  receive(trigger: Trigger): ReceiveResult
  idle(ticketId: string): boolean
  cancel(ticketId: string): void
}

/** Local intake reuses Engine, durable Outbox and the persistent DSH worker session. */
export class LocalResearch {
  readonly continuous: ContinuousResearch
  readonly inbox: LocalInbox
  private readonly workspace: ReturnType<typeof createWorkspaceProfile>
  constructor(directory: string, private readonly host: LocalHost) {
    this.workspace = createWorkspaceProfile(directory)
    const { root, config, profile } = this.workspace
    const previous = host.store.get(bindingKey)
    if (previous && (previous.workspace !== root || previous.id !== config.id)) {
      throw new Error('This state directory belongs to a different research workspace; use a separate stateDir')
    }
    if (!previous && host.store.read.recentTriggers(0, 1).length) {
      throw new Error('Local research requires a separate stateDir from existing external tasks')
    }
    const current = host.prompts.current()
    if (!previous || JSON.stringify(previous.profile) !== JSON.stringify(profile)) {
      if (current.revision > 0 && JSON.stringify(current.config) !== JSON.stringify(previous?.profile)
        && JSON.stringify(current.config) !== JSON.stringify(profile)) {
        throw new Error('Workspace context changed alongside edited prompts; reconcile prompts before restarting')
      }
      host.prompts.save(profile, current.revision, 'tool')
    }
    host.store.set(bindingKey, { workspace: root, id: config.id, profile })
    this.inbox = new LocalInbox(root, message => this.send(message))
    const settings = host.store.settings()
    // A local deployment never polls or publishes to an external Source. Local
    // authorization belongs to the same-origin operator endpoint, not to gh.
    const sources = Object.fromEntries(Object.entries(settings.sources).map(([id, value]) =>
      [id, id === 'local' ? value : { ...value, enabled: false }]))
    const updated = SettingsSchema.parse({ ...settings,
      sources: { ...sources, local: { enabled: true, config: {} } },
      policy: { ...settings.policy, sources: { ...settings.policy.sources, local: { allowed: [{ id: 'operator' }] } } },
    })
    if (JSON.stringify(updated) !== JSON.stringify(settings)) host.store.saveSettings(updated)
    this.continuous = new ContinuousResearch(root, {
      store: host.store, engine: host.engine, validate: () => this.validate(), idle: host.idle, cancel: host.cancel,
      sources: this.workspace.lock.sources.map(source => ({ ...source, path: config.sources.find(item => item.id === source.id)!.path })),
      ticket: () => this.ticket(),
      start: () => {
        const previous = this.ticket()
        const pending = previous ? pendingLocalRequests(host.store, previous) : []
        this.send({ id: randomUUID(), kind: 'question', text: `启用持续项目安全研究：在 SCOPE.md 与锁定版本内，自主选择有高安全价值的问题，学习攻击面、防护机制和跨模块边界，持续沉淀有源码证据的知识；优先处理我的问题与订正。不修改目标源码、不做动态攻击或外部发布。请先确认接管这项常驻职责，用 orchestrator_report ready + reply_to_trigger_id 回复；具体研究轮次由宿主随后调度。此前有未明确标记答复的消息 ${JSON.stringify(pending)}；若已处理，请先各用 ready + reply_to_trigger_id 简要确认旧结果，勿重复调查。本授权开启新的常驻研究，之前首次连通性验收的单轮文件数限制不延续到新研究。` })
        return this.ticket()!
      },
    })
  }

  send(input: z.infer<typeof LocalMessageSchema>) {
    const message = LocalMessageSchema.parse(input)
    const { root, config, lock } = this.workspace
    this.validate()
    const id = `local:${message.id}`
    const existing = this.host.store.triggers.get(id)
    if (existing && (existing.text !== message.text || existing.meta.kind !== message.kind)) {
      throw new LocalResearchError('Message ID already belongs to different content', 409)
    }
    const trigger: Trigger = existing ?? {
      id, source: 'local', threads: [{ source: 'local', id: config.id }],
      actor: { source: 'local', id: 'operator' }, human: true, addressed: 'direct',
      at: new Date().toISOString(), text: message.text,
      channel: { source: 'local', thread: config.id, address: { request: id } },
      meta: { kind: message.kind, workspace: config.id },
    }
    const received = this.host.receive(trigger)
    if (received === 'filtered') throw new LocalResearchError('Local requests are disabled by the active source settings')
    const path = join(root, 'interactions', message.kind === 'correction' ? 'corrections' : 'requests', `${message.id}.json`)
    const saved = `${JSON.stringify(trigger, null, 2)}\n`
    if (existsSync(path)) {
      if (readFileSync(path, 'utf8') !== saved) throw new LocalResearchError('Request record conflicts with this message', 409)
    } else writeFileSync(path, saved, { flag: 'wx' })
    const disposition = this.host.store.triggers.disposition(id)
    if (!followupOwners(trigger, this.host.store).length && !disposition?.decisionId) {
      this.host.store.atomic(() => {
        const decision = this.host.engine.decide(id, {
          kind: 'accept', title: `${config.name}：安全研究`,
          scope: '研究工作区 SCOPE.md 所定义的项目安全，回答用户问题并吸收专家订正；具体操作受用户请求约束。',
          reason: { code: 'explicitRouted' }, name: 'security-research',
          acknowledgement: '已收到，将结合项目源码与已有研究处理。',
        })
        // The ongoing project conversation remains open after an individual answer
        // is ready. Existing thread lifecycle keeps follow-ups in the same session.
        if (decision.ticketId) this.host.engine.bindThread(decision.ticketId, { source: 'local', id: config.id }, true)
      })
    }
    return { id, duplicate: received === 'duplicate' }
  }

  /** Poll the explicit workspace inbox. The runtime calls this during its regular local pass. */
  pollInbox() { return this.inbox.poll() }

  private ticket() {
    return this.host.store.tickets.open().find(ticket =>
      this.host.store.triggers.get(ticket.origin.triggerId)?.source === 'local')
  }
  private validate() {
    const { root, config, lock } = this.workspace
    let current: ReturnType<typeof checkWorkspace>
    try { current = checkWorkspace(root) }
    catch (error) { throw new LocalResearchError(error instanceof Error ? error.message : String(error), 409) }
    if (JSON.stringify(current.lock) !== JSON.stringify(lock)
      || JSON.stringify(current.config) !== JSON.stringify(config) || current.scope !== this.workspace.scope) {
      throw new LocalResearchError('Workspace context changed; restart to load the reviewed sources and scope', 409)
    }
  }

  view() {
    const { root, config, lock } = this.workspace
    const requests = this.host.store.db.prepare(
      "SELECT value FROM trigger WHERE value ->> '$.source' = 'local' ORDER BY rowid DESC LIMIT 100",
    ).all().map(row => JSON.parse(String(row.value)) as Trigger).reverse()
    const replies = this.host.store.db.prepare(
      "SELECT value FROM outbox WHERE value ->> '$.channel.source' = 'local' ORDER BY rowid DESC LIMIT 300",
    ).all().map(row => JSON.parse(String(row.value)) as Receipt).reverse()
    const tickets = this.host.store.tickets.open().filter(ticket =>
      this.host.store.triggers.get(ticket.origin.triggerId)?.source === 'local')
    return { id: config.id, name: config.name, workspace: root, continuous: this.continuous.view(), inbox: this.inbox.view(),
      sources: lock.sources.map(({ id, revision, role }) => ({ id, revision, role })),
      messages: requests.map(request => ({ id: request.id, text: request.text, at: request.at,
        kind: String(request.meta.kind),
        replies: replies.filter(reply => reply.channel.address.request === request.id)
          .map(({ id, text, status, kind }) => ({ id, text, status, kind })),
      })),
      sessions: tickets.map(ticket => ({ ticketId: ticket.id, sessionId: `worker-${ticket.id}`, title: ticket.title })),
    }
  }
}
export type LocalResearchView = ReturnType<LocalResearch['view']>
