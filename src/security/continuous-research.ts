import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { canRetry, latestAssignment, liveTicket, type Engine, type Ticket } from '../core/index.ts'
import type { Store } from '../app/store.ts'
import { record } from '../kv.ts'

const Candidate = z.object({ question: z.string().trim().min(5).max(800), reason: z.string().trim().min(5).max(1200), priority: z.number().int().min(1).max(5) }).strict()
export const ResearchCheckpointSchema = z.object({
  round_id: z.string().uuid(), summary: z.string().trim().min(10).max(4000),
  outcome: z.enum(['continue', 'blocked', 'exhausted']),
  artifacts: z.array(z.string().min(1).max(500)).max(20),
  evidence: z.array(z.object({ source: z.string(), path: z.string(), line: z.number().int().positive(), claim: z.string().trim().min(5).max(1500) }).strict()).max(30),
  next: z.array(Candidate).max(8),
  blocker: z.string().trim().min(5).max(1500).optional(),
}).strict()
type Checkpoint = z.infer<typeof ResearchCheckpointSchema>
interface Round {
  id: string; question: string; reason: string; startedAt: string; deadline: string
  baseline: Record<string, string>; inputId?: string; recoveries: number
}
export interface Completed {
  id: string; question: string; at: string; summary: string; outcome: Checkpoint['outcome']
  artifacts: { path: string; sha256: string }[]; evidence: (Checkpoint['evidence'][number] & { revision: string })[]
  next: Checkpoint['next']; blocker?: string
}
interface State {
  enabled: boolean; ticketId?: string; active?: Round; completed: Completed[]
  candidates: Checkpoint['next']; nextAt: string; error?: string
}
const stateKey = record<State>('continuous-security-research-v1')
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const roots = ['knowledge', 'research', 'reports']
const ROUND_MS = 15 * 60_000
const GAP_MS = 10_000
export interface ContinuousHost {
  store: Store
  engine: Pick<Engine, 'note' | 'report' | 'retryTicket'>
  ticket(): Ticket | undefined
  start(): Ticket
  validate(): void
  idle(ticketId: string): boolean
  cancel(ticketId: string): void
  sources: { id: string; path: string; revision: string }[]
}

/** Completed local answers outlive the Engine's one-use permission to relay them. */
export function pendingLocalRequests(store: Store, ticket: Ticket): string[] {
  const answered = new Set(ticket.answers ?? [])
  const receipts = store.db.prepare(`SELECT value ->> '$.channel.address.request' AS request FROM outbox
    WHERE value ->> '$.ticketId' = ? AND value ->> '$.channel.source' = 'local'
      AND value ->> '$.kind' = 'reply' AND value ->> '$.status' IN ('sent', 'pending')`).all(ticket.id)
  for (const row of receipts) answered.add(String(row.request))
  return [...new Set([ticket.origin.triggerId, ...ticket.inputs.flatMap(input =>
    input.kind === 'trigger' && input.human && !input.context ? [input.triggerId] : [])])]
    .filter(id => !answered.has(id) && store.triggers.get(id)?.human)
}

/** Durable autonomous rounds on the existing project ticket, with verified file checkpoints and human priority. */
export class ContinuousResearch {
  constructor(private readonly root: string, private readonly host: ContinuousHost) {}
  private state(): State {
    return this.host.store.get(stateKey) ?? { enabled: false, completed: [], candidates: [], nextAt: new Date(0).toISOString() }
  }
  private save(state: State) { this.host.store.set(stateKey, state) }
  private pending(ticket: Ticket): boolean { return pendingLocalRequests(this.host.store, ticket).length > 0 }
  control(enabled: boolean) {
    if (enabled) this.host.validate()
    const state = this.state()
    if (enabled && (!state.enabled || !!state.error)) {
      const ticket = state.ticketId ? this.host.store.tickets.get(state.ticketId) : this.host.ticket()
      if (ticket && !liveTicket(ticket)) throw new Error('Research ticket ended; open a new project conversation first')
      state.ticketId = (state.ticketId ? ticket! : this.host.start()).id
      const current = this.host.store.tickets.get(state.ticketId)
      if (current && canRetry(current)) this.host.engine.retryTicket(current.id)
      state.nextAt = new Date().toISOString(); delete state.error
      if (state.active) { state.active.deadline = new Date(Date.now() + ROUND_MS).toISOString(); state.active.recoveries = 0 }
    }
    // Pausing stops scheduling; the current bounded round may checkpoint before going idle.
    state.enabled = enabled; this.save(state)
    return this.view()
  }
  view() {
    const state = this.state(), ticket = state.ticketId ? this.host.store.tickets.get(state.ticketId) : undefined
    const human = !!ticket && this.pending(ticket)
    return { enabled: state.enabled,
      status: !state.enabled ? 'paused' : state.error ? 'blocked' : this.host.store.settings().paused ? 'system-paused' : human ? 'user-priority' : state.active ? 'researching' : 'waiting',
      error: state.error, active: state.active ? { id: state.active.id, question: state.active.question, startedAt: state.active.startedAt, deadline: state.active.deadline } : null,
      nextAt: state.nextAt, rounds: state.completed.slice(-30), totalRounds: state.completed.length, candidates: state.candidates,
    }
  }
  private artifact(path: string): string {
    const absolute = resolve(this.root, path), rel = relative(this.root, absolute)
    if (!roots.some(root => rel.startsWith(`${root}${sep}`)) || rel !== path || !existsSync(absolute)
      || realpathSync(absolute) !== absolute || !statSync(absolute).isFile() || statSync(absolute).size === 0 || statSync(absolute).size > 2_000_000) {
      throw new Error(`Invalid research artifact: ${path}`)
    }
    return absolute
  }
  private snapshot(): Record<string, string> {
    const hashes: Record<string, string> = {}
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue
        const path = join(directory, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (entry.isFile() && statSync(path).size > 0) { const rel = relative(this.root, path); hashes[rel] = digest(this.artifact(rel)) }
      }
    }
    for (const root of roots) walk(join(this.root, root))
    return hashes
  }
  checkpoint(ticketId: string, input: Checkpoint) {
    const args = ResearchCheckpointSchema.parse(input), state = this.state()
    if (state.ticketId !== ticketId) throw new Error('Only the project research worker may checkpoint')
    const previous = state.completed.find(round => round.id === args.round_id)
    if (previous) return { recorded: true, duplicate: true, round_id: previous.id }
    const active = state.active
    if (!active || active.id !== args.round_id) throw new Error('Stale or unknown research round')
    this.host.validate()
    const artifacts = [...new Set(args.artifacts)].map(path => ({ path, sha256: digest(this.artifact(path)) }))
    if (artifacts.some(file => active.baseline[file.path] === file.sha256)) throw new Error('Checkpoint artifacts must contain actual changes since round start')
    const evidence = args.evidence.map(item => {
      const source = this.host.sources.find(source => source.id === item.source)
      if (!source) throw new Error(`Unknown evidence source: ${item.source}`)
      const directory = resolve(this.root, source.path), path = resolve(directory, item.path)
      if (!path.startsWith(`${directory}${sep}`) || realpathSync(path) !== path || !statSync(path).isFile()
        || statSync(path).size > 5_000_000 || item.line > readFileSync(path, 'utf8').split('\n').length) throw new Error('Invalid source evidence')
      return { ...item, revision: source.revision }
    })
    if (args.outcome === 'continue' && (!artifacts.length || !evidence.length || !args.next.length)) throw new Error('Continuing requires changed artifacts, source evidence and next questions')
    if (args.outcome === 'blocked' && !args.blocker) throw new Error('A blocker must explain the missing prerequisite')
    const completed: Completed = { id: active.id, question: active.question, at: new Date().toISOString(), summary: args.summary,
      outcome: args.outcome, artifacts, evidence, next: args.next, ...(args.blocker ? { blocker: args.blocker } : {}) }
    this.host.store.atomic(() => {
      this.host.engine.report(ticketId, { state: 'progress', summary: `研究检查点 ${active.id}: ${args.summary}` })
      state.completed.push(completed); state.candidates = args.next; delete state.active
      state.nextAt = new Date(Date.now() + GAP_MS).toISOString()
      if (args.outcome !== 'continue') state.error = args.blocker ?? '当前研究前沿已耗尽，需要新的方向。'
      this.save(state)
    })
    this.archive(completed)
    return { recorded: true, round_id: active.id, next: 'End this turn now. The host schedules the next round; do not call yourself or continue the next question.' }
  }
  private archive(round: Completed) {
    const directory = join(this.root, 'runs', 'continuous-research'); mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, `${round.id}.json`), `${JSON.stringify(round, null, 2)}\n`)
  }
  tick(): void {
    const state = this.state()
    if ((!state.enabled && !state.active) || state.error || this.host.store.settings().paused) return
    try {
      const ticket = state.ticketId ? this.host.store.tickets.get(state.ticketId) : undefined
      if (!ticket || !liveTicket(ticket)) throw new Error('Research ticket ended or is missing')
      if (ticket.delivery) throw new Error(`Input delivery failed: ${ticket.delivery.error}`)
      const assignment = latestAssignment(ticket)
      if (ticket.attention || ['blocked', 'failed'].includes(assignment?.report?.state ?? '')) throw new Error(ticket.attention?.question ?? assignment?.report?.summary ?? 'Worker stopped')
      if (this.pending(ticket)) {
        // User work does not consume the autonomous round's wall-clock allowance.
        if (state.active) { state.active.deadline = new Date(Date.now() + ROUND_MS).toISOString(); this.save(state) }
        return
      }
      if (state.active && Date.now() > Date.parse(state.active.deadline)) {
        this.host.cancel(ticket.id)
        throw new Error('Research round exceeded 15 minutes without a checkpoint; inspect the session and resume explicitly')
      }
      if (!state.enabled) return
      if (!this.host.idle(ticket.id) || ticket.undelivered.length || assignment?.state !== 'running') return
      if (assignment.deliveredAt && (!assignment.idleAt || assignment.idleAt < assignment.deliveredAt)) return
      if (Date.now() < Date.parse(state.nextAt)) return
      this.host.validate()
      // Repair the human-readable archive after a crash between the SQLite commit and file export.
      for (const round of state.completed) if (!existsSync(join(this.root, 'runs', 'continuous-research', `${round.id}.json`))) this.archive(round)
      if (state.active) {
        if (state.active.recoveries >= 2) throw new Error('Worker ended repeatedly without a research checkpoint; inspect the session')
        state.active.recoveries++
      } else {
        const candidate = [...state.candidates].sort((a, b) => b.priority - a.priority)[0] ?? {
          question: '结合已有研究，自主选择一个最值得弄清的项目安全机制或信任边界，追踪攻击路径和防护条件。',
          reason: '建立可复用的攻防知识，优先关键权限、输入可信度与跨模块边界；不要重复 first-contact。',
        }
        state.active = { id: randomUUID(), question: candidate.question, reason: candidate.reason,
          startedAt: new Date().toISOString(), deadline: new Date(Date.now() + ROUND_MS).toISOString(), baseline: this.snapshot(), recoveries: 0 }
      }
      const active = state.active
      this.host.store.atomic(() => {
        const text = [
          'CONTINUOUS_RESEARCH_ROUND (host scheduling context under the operator\'s standing research mandate; not a new human request)',
          JSON.stringify({ round_id: active.id, question: active.question, reason: active.reason, deadline: active.deadline, recovery: active.recoveries, frontier: state.candidates, recent: state.completed.slice(-3).map(round => ({ question: round.question, summary: round.summary, artifacts: round.artifacts.map(file => file.path) })) }),
          '研究一项有价值的新问题，默认中文。先读已有知识与研究前沿，自主决定具体路径；关注攻击与防护，优先高安全影响。',
          '本轮只完成一个可交接的知识增量，建议 5–15 次工具操作，15 分钟内结束。不要只写计划或重复旧结论。',
          '把结果写入 knowledge/ 或 research/ 或 reports/，记录源码版本、路径/行号、事实/假设/反证、未知和安全意义。不得修改 sources/、project.json、SCOPE.md、sources.lock.json，不读 evaluation/。',
          '必须用 orchestrator_research_checkpoint 提交本 round_id、实际变化的 artifacts、源码 evidence，以及按优先级排列的 next 问题（priority 1–5，5 最高）。',
          '检查点成功后立即结束本轮，不要自行循环。若遇到真正前置阻塞，checkpoint outcome=blocked；无新方向时 exhausted。',
          '用户新问题/订正立即优先，通过 orchestrator_report ready + reply_to_trigger_id 回答用户，然后再恢复本轮；不得把本轮研究当作用户问题的答案。',
          '若这是恢复：先检查已有文件与会话，保留已完成工作，补交检查点，不重做。',
        ].join('\n')
        const updated = this.host.engine.note(ticket.id, text)
        active.inputId = updated.inputs.at(-1)!.id
        state.nextAt = new Date(Date.now() + GAP_MS).toISOString(); this.save(state)
      })
    } catch (error) {
      state.error = (error instanceof Error ? error.message : String(error)).replace(/api_key:\s*[^,\s]+/gi, 'api_key: [redacted]'); this.save(state)
    }
  }
}
