import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { canRetry, latestAssignment, liveTicket, type Engine, type Ticket } from '../core/index.ts'
import type { Store } from '../app/store.ts'
import type { RoleModel } from '../policy.ts'
import { record } from '../kv.ts'
import { activeResearchSchedule } from './research-schedule.ts'

const CandidateInput = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  question: z.string().trim().min(5).max(800),
  rationale: z.string().trim().min(5).max(1200),
  hypothesis: z.string().trim().min(5).max(1600),
  evidencePlan: z.string().trim().min(5).max(1600),
  stopCondition: z.string().trim().min(5).max(1200),
  impact: z.number().int().min(1).max(5),
  uncertainty: z.number().int().min(1).max(5),
  feasibility: z.number().int().min(1).max(5),
  status: z.enum(['open', 'active', 'confirmed', 'weakened', 'blocked', 'exhausted']),
  provenance: z.enum(['user', 'source', 'checkpoint', 'agent']),
}).strict()
type LegacyCandidate = { id?: string; question: string; rationale?: string; reason?: string; hypothesis?: string; evidencePlan?: string; stopCondition?: string; impact?: number; uncertainty?: number; feasibility?: number; priority?: number; status?: Candidate['status']; provenance?: Candidate['provenance']; blocker?: string }
export interface Candidate {
  id: string; question: string; rationale: string; hypothesis: string; evidencePlan: string; stopCondition: string
  impact: number; uncertainty: number; feasibility: number
  status: 'open' | 'active' | 'confirmed' | 'weakened' | 'blocked' | 'exhausted'
  provenance: 'user' | 'source' | 'checkpoint' | 'agent'; blocker?: string
}
const normalizeCandidate = (raw: LegacyCandidate): Candidate => ({
  id: raw.id ?? `frontier-${randomUUID()}`,
  question: raw.question,
  rationale: raw.rationale ?? raw.reason ?? '填补当前项目安全知识缺口。',
  hypothesis: raw.hypothesis ?? `需要验证：${raw.question}`,
  evidencePlan: raw.evidencePlan ?? '检查锁定源码、已有知识和必要的真实运行证据。',
  stopCondition: raw.stopCondition ?? '形成带源码或运行证据的结论，并记录反证与未知。',
  impact: raw.impact ?? raw.priority ?? 3,
  uncertainty: raw.uncertainty ?? 3,
  feasibility: raw.feasibility ?? 3,
  status: raw.status ?? 'open',
  provenance: raw.provenance ?? 'agent',
  ...(raw.blocker ? { blocker: raw.blocker } : {}),
})
const frontierScore = (candidate: Candidate) => candidate.impact * 3 + candidate.uncertainty * 2 + candidate.feasibility
export const ResearchCheckpointSchema = z.object({
  round_id: z.string().uuid(), summary: z.string().trim().min(10).max(4000),
  outcome: z.enum(['continue', 'blocked', 'exhausted']),
  artifacts: z.array(z.string().min(1).max(500)).max(20),
  evidence: z.array(z.object({ source: z.string(), path: z.string(), line: z.number().int().positive(), claim: z.string().trim().min(5).max(1500) }).strict()).max(30),
  next: z.array(CandidateInput).max(8),
  blocker: z.string().trim().min(5).max(1500).optional(),
}).strict()
type Checkpoint = z.infer<typeof ResearchCheckpointSchema>
interface Round {
  id: string; question: string; rationale: string; hypothesis: string; evidencePlan: string; stopCondition: string
  startedAt: string; deadline?: string; timeoutMs: number | null
  baseline: Record<string, string>; inputId?: string; recoveries: number
}
export interface Completed {
  id: string; question: string; rationale: string; hypothesis: string; evidencePlan: string; stopCondition: string
  at: string; summary: string; outcome: Checkpoint['outcome']
  artifacts: { path: string; sha256: string }[]; evidence: (Checkpoint['evidence'][number] & { revision: string })[]
  next: Checkpoint['next']; blocker?: string
}
interface WorkerState {
  ticketId: string
  active?: Round
  nextAt: string
  failureCount: number
  retryAt?: string
  error?: string
}
interface State {
  enabled: boolean
  ticketId?: string
  workers: WorkerState[]
  active?: Round
  completed: Completed[]
  candidates: Candidate[]
  nextAt: string
  error?: string
}
const stateKey = record<State>('continuous-security-research-v1')
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const roots = ['knowledge', 'research', 'reports']
const GAP_MS = 10_000
const MAX_RESEARCH_RETRIES = 8
const INITIAL_FRONTIER_QUESTION = '审阅当前项目研究前沿，并选择一个最有安全价值且尚未充分验证的方向。'
const FRONTIER_REFRESH_QUESTION = '重新扫描已完成研究与未决问题，提出一个未重复且可用项目证据验证的新方向。'
const questionKey = (question: string) => question.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
const frontierRefreshCandidate = () => normalizeCandidate({
  question: FRONTIER_REFRESH_QUESTION,
  rationale: '上一轮前沿已收敛；重新检查项目范围、版本差异、配置、部署和跨组件边界，避免重复已完成问题。',
  hypothesis: '仍存在尚未被当前知识库覆盖、且可以用项目证据验证的安全问题。',
  evidencePlan: '回顾 SCOPE.md、已完成检查点、未决问题和所有输入类型，选择一个此前未完成且能获得新证据的方向。',
  stopCondition: '提出一个未重复的可验证问题并完成首批证据，或明确记录需要人工授权/新材料的具体阻塞。',
  provenance: 'agent', status: 'open', impact: 4, uncertainty: 4, feasibility: 3,
})
const retryableFailure = (value: unknown): boolean => /(?:\b(?:408|429|500|502|503|504)\b|bad gateway|service unavailable|too many requests|rate limit|overloaded|timeout|timed out|network error|fetch failed|econn|eai_again|socket hang up)/i.test(value instanceof Error ? value.message : String(value))
const retryDelay = (attempt: number): number => Math.min(5 * 60_000, 15_000 * 2 ** Math.max(0, attempt - 1))
export interface ContinuousHost {
  store: Store
  engine: Pick<Engine, 'note' | 'report' | 'retryTicket'>
  ticket(): Ticket | undefined
  start(): Ticket
  startWorker(): Ticket
  validate(): void
  idle(ticketId: string): boolean
  cancel(ticketId: string): void
  /** Apply the current schedule's model to the persistent worker before a new round. */
  selectModel?(ticketId: string, model: RoleModel | null): void
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
    .filter(id => {
      const trigger = store.triggers.get(id)
      // The standing-research authorization is host-generated context, not a
      // user request that should hold the autonomous scheduler indefinitely.
      return !answered.has(id) && trigger?.human && trigger.meta.kind !== 'autonomous'
        && (id === ticket.origin.triggerId || !trigger.text.startsWith('启用持续项目安全研究：'))
    })
}

/** Durable autonomous rounds with independent DSH lanes, verified file checkpoints and human priority. */
export class ContinuousResearch {
  constructor(private readonly root: string, private readonly host: ContinuousHost) {}
  private state(): State {
    const saved = this.host.store.get(stateKey)
    if (!saved) return { enabled: false, workers: [], completed: [], candidates: [], nextAt: new Date(0).toISOString() }
    const normalizeRound = (round: Round | undefined): Round | undefined => round ? {
      ...round,
      timeoutMs: round.timeoutMs === undefined
        ? (round.deadline ? Math.max(0, Date.parse(round.deadline) - Date.parse(round.startedAt)) : null)
        : round.timeoutMs,
    } : undefined
    const workers = (saved.workers?.length ? saved.workers : saved.ticketId ? [{ ticketId: saved.ticketId, active: saved.active, nextAt: saved.nextAt, failureCount: 0 }] : [])
      .map(worker => ({ ...worker, active: normalizeRound(worker.active), nextAt: worker.nextAt ?? saved.nextAt, failureCount: worker.failureCount ?? 0 }))
    const ticketId = saved.ticketId ?? workers[0]?.ticketId
    const activeQuestions = new Set(workers.flatMap(worker => worker.active ? [worker.active.question] : []))
    // A crash or an older scheduler version can leave a frontier item marked
    // active after its worker disappeared. Reopen only those orphaned entries;
    // a candidate attached to a live round remains active until its checkpoint.
    let candidates = saved.candidates.map(candidate => normalizeCandidate(candidate as LegacyCandidate)).map(candidate =>
      candidate.status === 'active' && !activeQuestions.has(candidate.question) ? { ...candidate, status: 'open' as const } : candidate)
    // Versions before candidate-level blockers stored the blocker in the
    // scheduler-wide error field. Migrate that durable state when the error
    // exactly matches the completed blocked round, so upgrading does not
    // require a manual stop/start before other open work can resume.
    const legacyBlocked = saved.error
      ? [...saved.completed].reverse().find(round => round.outcome === 'blocked' && round.blocker === saved.error)
      : undefined
    if (legacyBlocked) {
      const blockedKey = questionKey(legacyBlocked.question)
      if (candidates.some(candidate => questionKey(candidate.question) === blockedKey)) {
        candidates = candidates.map(candidate => questionKey(candidate.question) === blockedKey
          ? { ...candidate, status: 'blocked' as const, blocker: legacyBlocked.blocker } : candidate)
      } else {
        candidates.push(normalizeCandidate({ id: legacyBlocked.id, question: legacyBlocked.question,
          rationale: legacyBlocked.rationale, hypothesis: legacyBlocked.hypothesis, evidencePlan: legacyBlocked.evidencePlan,
          stopCondition: legacyBlocked.stopCondition, status: 'blocked', provenance: 'agent', blocker: legacyBlocked.blocker }))
      }
    }
    return { ...saved, ticketId, workers, candidates, error: legacyBlocked ? undefined : saved.error,
      active: normalizeRound(workers.find(worker => worker.ticketId === ticketId)?.active ?? saved.active) }
  }
  private save(state: State) {
    const primary = state.workers.find(worker => worker.ticketId === state.ticketId) ?? state.workers[0]
    this.host.store.set(stateKey, { ...state, ticketId: primary?.ticketId ?? state.ticketId, active: primary?.active })
  }
  private pending(ticket: Ticket): boolean { return pendingLocalRequests(this.host.store, ticket).length > 0 }
  private primary(state: State): WorkerState | undefined {
    return state.workers.find(worker => worker.ticketId === state.ticketId) ?? state.workers[0]
  }
  private ensurePrimary(state: State): WorkerState {
    let ticket = state.ticketId ? this.host.store.tickets.get(state.ticketId) : undefined
    if (!ticket || !liveTicket(ticket)) ticket = this.host.ticket()
    if (!ticket || !liveTicket(ticket)) ticket = this.host.start()
    let worker = state.workers.find(item => item.ticketId === ticket!.id)
    if (!worker) { worker = { ticketId: ticket.id, nextAt: new Date(0).toISOString(), failureCount: 0 }; state.workers.unshift(worker) }
    state.ticketId = ticket.id
    return worker
  }
  private activeSchedule() { return activeResearchSchedule(this.host.store.settings().research) }
  /** All-day default is one; special windows explicitly opt into more lanes. */
  capacity(): number { return this.activeSchedule()?.schedule.maxWorkers ?? 1 }
  private extendDeadline(worker: WorkerState) {
    if (!worker.active) return
    if (worker.active.timeoutMs !== null) worker.active.deadline = new Date(Date.now() + worker.active.timeoutMs).toISOString()
    else delete worker.active.deadline
  }
  private extendDeadlines(state: State) {
    for (const worker of state.workers) this.extendDeadline(worker)
  }
  control(enabled: boolean) {
    if (enabled) this.host.validate()
    const state = this.state()
    if (enabled && (!state.enabled || !!state.error)) {
      const primary = this.ensurePrimary(state)
      const resumableBlockers = new Set(state.candidates.filter(candidate => candidate.status === 'blocked' && candidate.blocker)
        .map(candidate => candidate.blocker!))
      const requeueBlocked = !state.candidates.some(candidate => candidate.status === 'open')
      if (requeueBlocked) {
        // An explicit Start/resume is the operator's acknowledgement that a
        // previously blocked frontier may be attempted again. Reopen it only
        // when there is no independent open work, preserving the normal
        // candidate-level isolation during autonomous scheduling.
        state.candidates = state.candidates.map(candidate => candidate.status === 'blocked'
          ? { ...candidate, status: 'open' as const, blocker: undefined } : candidate)
        for (const worker of state.workers) {
          const ticket = this.host.store.tickets.get(worker.ticketId)
          if (ticket && liveTicket(ticket) && ticket.attention?.question && resumableBlockers.has(ticket.attention.question)) {
            this.host.engine.report(ticket.id, { state: 'progress', summary: '研究恢复：重新排队此前阻塞的研究前沿。', question: null })
          }
        }
      }
      const current = this.host.store.tickets.get(primary.ticketId)
      if (current && canRetry(current)) this.host.engine.retryTicket(current.id)
      for (const worker of state.workers) {
        const ticket = this.host.store.tickets.get(worker.ticketId)
        if (ticket && worker.ticketId !== primary.ticketId && canRetry(ticket)) this.host.engine.retryTicket(ticket.id)
      }
      state.nextAt = new Date().toISOString(); delete state.error
      for (const worker of state.workers) { worker.error = undefined; worker.failureCount = 0; if (worker.active) worker.active.recoveries = 0 }
      this.extendDeadlines(state)
    }
    state.enabled = enabled; this.save(state)
    return this.view()
  }
  view() {
    const state = this.state(), primary = this.primary(state), ticket = primary ? this.host.store.tickets.get(primary.ticketId) : undefined
    const schedule = activeResearchSchedule(this.host.store.settings().research)
    const human = !!ticket && this.pending(ticket)
    const activeRounds = state.workers.filter(worker => worker.active)
    const active = primary?.active
    const ticketAttention = state.workers.map(worker => this.host.store.tickets.get(worker.ticketId)?.attention).find(Boolean)
    const blockedCandidate = state.candidates.find(candidate => candidate.status === 'blocked' && candidate.blocker)
    const attention = ticketAttention ?? (blockedCandidate?.blocker ? { question: blockedCandidate.blocker, triggerId: undefined } : undefined)
    return { enabled: state.enabled,
      status: !state.enabled ? 'paused' : state.error ? 'blocked' : this.host.store.settings().paused ? 'system-paused' : human ? 'user-priority' : activeRounds.length ? 'researching' : 'waiting',
      error: state.error, active: active ? { id: active.id, question: active.question, rationale: active.rationale,
        hypothesis: active.hypothesis, evidencePlan: active.evidencePlan, stopCondition: active.stopCondition,
        startedAt: active.startedAt, deadline: active.deadline } : null,
      attention: attention ? { question: attention.question, triggerId: attention.triggerId } : null,
      workers: state.workers.map(worker => ({ ticketId: worker.ticketId, active: worker.active ? { id: worker.active.id, question: worker.active.question, startedAt: worker.active.startedAt, deadline: worker.active.deadline } : null, nextAt: worker.nextAt, error: worker.error })),
      activeRounds: activeRounds.map(worker => ({ ticketId: worker.ticketId, id: worker.active!.id, question: worker.active!.question })),
      nextAt: state.nextAt, rounds: state.completed.slice(-30), totalRounds: state.completed.length, candidates: state.candidates,
      capacity: this.capacity(),
      schedule: schedule ? { id: schedule.schedule.id, name: schedule.schedule.name, localTime: schedule.localTime,
        maxWorkers: schedule.schedule.maxWorkers, model: schedule.schedule.model, nextTransitionAt: schedule.nextTransitionAt,
        timezone: schedule.schedule.timezone } : {},
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
    for (const root of roots) if (existsSync(join(this.root, root))) walk(join(this.root, root))
    return hashes
  }
  checkpoint(ticketId: string, input: Checkpoint) {
    const args = ResearchCheckpointSchema.parse(input), state = this.state()
    const worker = state.workers.find(item => item.ticketId === ticketId)
    if (!worker) throw new Error('Only a project research worker may checkpoint')
    const previous = state.completed.find(round => round.id === args.round_id)
    if (previous) return { recorded: true, duplicate: true, round_id: previous.id }
    const active = worker.active
    if (!active || active.id !== args.round_id) throw new Error('Stale or unknown research round')
    this.host.validate()
    const artifacts = [...new Set(args.artifacts)].map(path => ({ path, sha256: digest(this.artifact(path)) }))
    if (worker.ticketId !== state.ticketId) {
      const laneRoot = `research/rounds/${active.id}/`
      if (artifacts.some(file => !file.path.startsWith(laneRoot))) throw new Error(`Concurrent research lanes must write artifacts under ${laneRoot}`)
    }
    if (artifacts.some(file => active.baseline[file.path] === file.sha256)) throw new Error('Checkpoint artifacts must contain actual changes since round start')
    const evidence = args.evidence.map(item => {
      const source = this.host.sources.find(source => source.id === item.source)
      if (!source) throw new Error(`Unknown evidence source: ${item.source}`)
      const directory = resolve(this.root, source.path), path = resolve(directory, item.path)
      if (!path.startsWith(`${directory}${sep}`) || !existsSync(path) || realpathSync(path) !== path || !statSync(path).isFile()
        || statSync(path).size > 5_000_000 || item.line > readFileSync(path, 'utf8').split('\n').length) throw new Error('Invalid source evidence')
      return { ...item, revision: source.revision }
    })
    const completedQuestions = new Set(state.completed.map(round => questionKey(round.question)))
    const seenQuestions = new Set<string>()
    const next = args.next.map(normalizeCandidate).filter(candidate => {
      const key = questionKey(candidate.question)
      if (completedQuestions.has(key) || seenQuestions.has(key)) return false
      seenQuestions.add(key)
      return true
    })
    if (args.outcome === 'continue' && (!artifacts.length || !evidence.length || !next.length)) throw new Error('Continuing requires changed artifacts, source evidence and next research frontier')
    if (args.outcome === 'blocked' && !args.blocker) throw new Error('A blocker must explain the missing prerequisite')
    const completed: Completed = { id: active.id, question: active.question, rationale: active.rationale, hypothesis: active.hypothesis,
      evidencePlan: active.evidencePlan, stopCondition: active.stopCondition, at: new Date().toISOString(), summary: args.summary,
      outcome: args.outcome, artifacts, evidence, next, ...(args.blocker ? { blocker: args.blocker } : {}) }
    this.host.store.atomic(() => {
      // A blocked research question is an operator-visible prerequisite, but it
      // must not block the persistent research Session. Keep the assignment in
      // progress with an attention question so other open candidates can run.
      this.host.engine.report(ticketId, { state: 'progress', summary: `研究检查点 ${active.id}: ${args.summary}`,
        ...(args.outcome === 'blocked' ? { question: args.blocker } : {}) })
      state.completed.push(completed); worker.active = undefined; worker.error = undefined; worker.failureCount = 0
      worker.nextAt = new Date(Date.now() + GAP_MS).toISOString(); state.nextAt = worker.nextAt
      const activeOthers = state.candidates.filter(candidate => candidate.status === 'active' && candidate.question !== active.question)
      const existingOpen = state.candidates.filter(candidate => candidate.status === 'open'
        && !completedQuestions.has(questionKey(candidate.question)) && !next.some(item => questionKey(item.question) === questionKey(candidate.question)))
      const existingBlocked = state.candidates.filter(candidate => candidate.status === 'blocked'
        && questionKey(candidate.question) !== questionKey(active.question))
      const previous = state.candidates.find(candidate => questionKey(candidate.question) === questionKey(active.question))
      const blocked = args.outcome === 'blocked' ? {
        ...(previous ?? normalizeCandidate({ id: active.id, question: active.question, rationale: active.rationale,
          hypothesis: active.hypothesis, evidencePlan: active.evidencePlan, stopCondition: active.stopCondition,
          status: 'blocked', provenance: 'agent' })),
        status: 'blocked' as const, blocker: args.blocker,
      } : undefined
      // A blocked round must not be immediately selected again if the agent
      // echoed its current question in `next`; retain the candidate as a
      // blocked item with the operator-visible prerequisite instead.
      const blockedQuestions = new Set(existingBlocked.map(candidate => questionKey(candidate.question)))
      const eligibleNext = next.filter(candidate => questionKey(candidate.question) !== questionKey(active.question)
        && !blockedQuestions.has(questionKey(candidate.question)))
      state.candidates = [...eligibleNext, ...activeOthers, ...existingOpen, ...existingBlocked, ...(blocked ? [blocked] : [])]
      if (args.outcome === 'blocked' && !state.candidates.some(candidate => candidate.status === 'open')
        && !state.workers.some(item => item.active)
        && !state.completed.some(round => questionKey(round.question) === questionKey(FRONTIER_REFRESH_QUESTION))) {
        state.candidates.push(frontierRefreshCandidate())
      }
      else if (args.outcome === 'exhausted' && !state.candidates.some(candidate => candidate.status === 'open') && !state.workers.some(item => item.active)) {
        if (questionKey(active.question) === questionKey(FRONTIER_REFRESH_QUESTION)) state.error = '当前研究前沿已耗尽，需要新的项目证据或人工授权。'
        else state.candidates = [...existingBlocked, frontierRefreshCandidate()]
      }
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
    const state = this.state(), activeCount = state.workers.filter(worker => worker.active).length
    if ((!state.enabled && !activeCount) || state.error || this.host.store.settings().paused) return
    try {
      const primary = state.enabled ? this.ensurePrimary(state) : this.primary(state)
      const primaryTicket = primary ? this.host.store.tickets.get(primary.ticketId) : undefined
      if (!primaryTicket || !liveTicket(primaryTicket)) throw new Error('Research ticket ended or is missing')
      const schedule = this.activeSchedule()
      const capacity = schedule?.schedule.maxWorkers ?? 1
      if (state.enabled) {
        while (state.workers.length < capacity) state.workers.push({ ticketId: this.host.startWorker().id, nextAt: new Date(0).toISOString(), failureCount: 0 })
      }
      for (const round of state.completed) if (!existsSync(join(this.root, 'runs', 'continuous-research', `${round.id}.json`))) this.archive(round)
      for (const [index, worker] of state.workers.entries()) {
        // A lane that was created during a special window may finish its current
        // round after the window closes, but it must not start a new one outside
        // the configured capacity.
        if (index >= capacity && !worker.active) continue
        let ticket = this.host.store.tickets.get(worker.ticketId)
        if (!ticket || !liveTicket(ticket)) {
          if (worker.ticketId === state.ticketId) throw new Error('Primary research ticket ended or is missing')
          // A secondary lane may have ended while the host was restarting or
          // recovering a provider failure. Do not leave a dead ticket occupying
          // a capacity slot forever; reopen its candidate and replace the lane.
          if (!state.enabled || index >= capacity) continue
          if (worker.active) state.candidates = state.candidates.map(candidate => candidate.question === worker.active!.question
            ? { ...candidate, status: 'open' } : candidate)
          const replacement = this.host.startWorker()
          worker.ticketId = replacement.id; worker.active = undefined; worker.error = undefined
          worker.failureCount = 0; delete worker.retryAt; worker.nextAt = new Date(0).toISOString()
          ticket = replacement
        }
        // A human request pauses only the lane it belongs to. Other autonomous
        // lanes remain eligible during a slow answer on the primary session.
        if (this.pending(ticket)) {
          this.extendDeadline(worker)
          continue
        }
        const assignment = latestAssignment(ticket)
        // `checkpoint(outcome=blocked)` deliberately leaves a progress report
        // with an attention question so the operator can see the prerequisite.
        // That attention belongs to the completed candidate, not to the
        // persistent research Session; keep it visible while allowing another
        // open candidate to start. Other attention/failure states still stop
        // or retry the lane as before.
        const internalBlockedAttention = assignment?.report?.state === 'progress'
          && !!ticket.attention?.question
          && state.candidates.some(candidate => candidate.status === 'blocked' && candidate.blocker === ticket.attention?.question)
        const failure = ticket.delivery?.error ?? (internalBlockedAttention ? undefined : (ticket.attention?.question ?? (['blocked', 'failed'].includes(assignment?.report?.state ?? '') ? assignment?.report?.summary : undefined)))
        if (failure) {
          if (retryableFailure(failure) && canRetry(ticket) && worker.failureCount < MAX_RESEARCH_RETRIES) {
            // Keep the failed ticket untouched until the durable backoff expires.
            // Calling retryTicket immediately would relaunch the model while a
            // 502/429 is still active and turn a fleet of night lanes into a
            // rate-limit storm.
            if (!worker.retryAt) {
              worker.failureCount++
              const delay = retryDelay(worker.failureCount)
              worker.retryAt = new Date(Date.now() + delay).toISOString()
              worker.nextAt = worker.retryAt
              worker.error = `暂时失败，将在 ${Math.round(delay / 1000)} 秒后重试：${failure}`
              continue
            }
            if (Date.now() < Date.parse(worker.retryAt)) continue
            this.host.engine.retryTicket(ticket.id)
            delete worker.retryAt
            continue
          }
          // A secondary lane is isolated from the operator-facing primary
          // conversation. Keep its failure visible on that lane while allowing
          // other research workers to continue; only the primary failure blocks
          // the whole scheduler.
          if (worker.ticketId !== state.ticketId) {
            worker.error = failure
            continue
          }
          throw new Error(failure)
        }
        if (worker.active?.deadline && Date.now() > Date.parse(worker.active.deadline)) {
          this.host.cancel(ticket.id)
          if (worker.ticketId !== state.ticketId) {
            state.candidates = state.candidates.map(candidate => candidate.question === worker.active!.question ? { ...candidate, status: 'open' } : candidate)
            worker.error = '并发研究槽超过了已配置的宿主时限，已暂停该槽位；其他研究槽继续运行。'
            worker.active = undefined
            worker.nextAt = new Date(Date.now() + GAP_MS).toISOString()
            continue
          }
          throw new Error('Research round exceeded its configured time limit without a checkpoint; inspect the session and resume explicitly')
        }
        if (!state.enabled || !this.host.idle(ticket.id) || ticket.undelivered.length || assignment?.state !== 'running'
          || assignment.deliveredAt && (!assignment.idleAt || assignment.idleAt < assignment.deliveredAt)
          || Date.now() < Date.parse(worker.nextAt)) continue
        this.host.validate()
        if (worker.active) {
          if (worker.active.recoveries >= 2) {
            if (worker.ticketId !== state.ticketId) {
              state.candidates = state.candidates.map(candidate => candidate.question === worker.active!.question ? { ...candidate, status: 'open' } : candidate)
              worker.error = '并发研究槽连续结束但未提交检查点，已暂停该槽位；其他研究槽继续运行。'
              worker.active = undefined
              worker.nextAt = new Date(Date.now() + GAP_MS).toISOString()
              continue
            }
            throw new Error('Worker ended repeatedly without a research checkpoint; inspect the session')
          }
          worker.active.recoveries++
        } else {
          const activeQuestions = new Set(state.workers.flatMap(item => item.active ? [item.active.question] : []))
          const refreshCompleted = state.completed.some(round => questionKey(round.question) === questionKey(FRONTIER_REFRESH_QUESTION))
          const candidate = [...state.candidates].filter(item => item.status === 'open' && !activeQuestions.has(item.question)).sort((a, b) => frontierScore(b) - frontierScore(a))[0]
            ?? (activeQuestions.size || refreshCompleted ? undefined : normalizeCandidate({
              question: state.completed.length ? FRONTIER_REFRESH_QUESTION : INITIAL_FRONTIER_QUESTION,
              rationale: '当前没有可继续的开放问题，需要重新扫描项目范围和已有证据。',
              hypothesis: '当前知识库之外仍可能存在尚未覆盖、且能够获得项目证据的安全问题。',
              evidencePlan: '回顾项目范围、已完成检查点、未决问题和所有输入类型，提出一个未重复且可验证的新方向。',
              stopCondition: '形成一个未重复的可验证研究问题并记录首批证据，或明确需要人工授权/新材料的阻塞。', provenance: 'agent',
            }))
          if (!candidate) continue
          if (!state.candidates.some(item => item.id === candidate.id)) state.candidates.push(candidate)
          state.candidates = state.candidates.map(item => item.id === candidate.id ? { ...item, status: 'active' } : item)
          const timeoutMs = schedule?.schedule.timeoutSeconds ? schedule.schedule.timeoutSeconds * 1000 : null
          // The worker Session persists across rounds; select the route at the
          // round boundary so schedule changes actually affect the next request.
          this.host.selectModel?.(ticket.id, schedule?.schedule.model ?? null)
          worker.active = { id: randomUUID(), question: candidate.question, rationale: candidate.rationale, hypothesis: candidate.hypothesis,
            evidencePlan: candidate.evidencePlan, stopCondition: candidate.stopCondition, startedAt: new Date().toISOString(),
            ...(timeoutMs === null ? {} : { deadline: new Date(Date.now() + timeoutMs).toISOString() }), timeoutMs, baseline: this.snapshot(), recoveries: 0 }
          mkdirSync(join(this.root, 'research', 'rounds', worker.active.id), { recursive: true })
        }
        const active = worker.active
        this.host.store.atomic(() => {
          const text = [
            'CONTINUOUS_RESEARCH_ROUND (host scheduling context under the operator\'s standing research mandate; not a new human request)',
            JSON.stringify({ round_id: active.id, proposal: { question: active.question, rationale: active.rationale, hypothesis: active.hypothesis, evidencePlan: active.evidencePlan, stopCondition: active.stopCondition }, recovery: active.recoveries, frontier: state.candidates, recent: state.completed.slice(-3).map(round => ({ question: round.question, summary: round.summary, artifacts: round.artifacts.map(file => file.path) })) }),
            '研究目标由项目章程和安全边界定义，具体研究问题由你根据当前项目、知识库和研究前沿自主选择。默认中文，关注攻击与防护。',
            '本轮只完成一个可交接的知识增量。不要只写计划或重复旧结论。',
            worker.ticketId === state.ticketId
              ? '把结果写入 knowledge/ 或 research/ 或 reports/，记录源码版本、路径/行号、事实/假设/反证、未知和安全意义。不得修改 sources/、project.json、SCOPE.md、sources.lock.json，不读 evaluation/。'
              : `这是并发研究槽。为避免多个 worker 覆盖共享知识，每个结果文件必须写入 research/rounds/${active.id}/；不要直接修改 knowledge/、reports/ 或其他 round 的文件。记录源码版本、路径/行号、事实/假设/反证、未知和安全意义。`,
            '必须用 orchestrator_research_checkpoint 提交本 round_id、实际变化的 artifacts、源码 evidence，以及结构化的 next 研究前沿：问题、理由、假设、证据计划、停止条件、影响、未知和可行性。',
            '检查点成功后立即结束本轮，不要自行循环。若遇到真正前置阻塞，checkpoint outcome=blocked 并说明最小求助条件；宿主会保留求助并继续其他 open 前沿，不要重复这个 blocked 问题。若当前静态前沿暂时收敛，checkpoint outcome=exhausted，宿主会安排一次新的前沿扫描；前沿扫描仍无新方向时才会暂停并等待新的项目证据或人工授权。',
            '用户新问题/订正立即优先，通过 orchestrator_report ready + reply_to_trigger_id 回答用户，然后再恢复本轮；不得把本轮研究当作用户问题的答案。',
            '若这是恢复：先检查已有文件与会话，保留已完成工作，补交检查点，不重做。',
          ].join('\n')
          const updated = this.host.engine.note(ticket.id, text)
          active.inputId = updated.inputs.at(-1)!.id
          worker.nextAt = new Date(Date.now() + GAP_MS).toISOString(); state.nextAt = worker.nextAt; worker.failureCount = 0; worker.error = undefined; this.save(state)
        })
      }
      this.save(state)
    } catch (error) {
      state.error = (error instanceof Error ? error.message : String(error)).replace(/api_key:\s*[^,\s]+/gi, 'api_key: [redacted]'); this.save(state)
    }
  }

}
