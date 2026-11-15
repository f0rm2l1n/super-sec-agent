import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { initializeWorkspace, lockWorkspace } from '../src/security/workspace.ts'
import { resolveDeployment } from '../src/deployment.ts'
import { testMachine } from './fixtures/deployment.ts'
import { startRuntime, type Host } from './fixtures/host.ts'

const directories: string[] = []
let host: Host | undefined
afterEach(async () => {
  await host?.stop(); host = undefined
  vi.restoreAllMocks()
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})
function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'brainafk-local-'))
  directories.push(root)
  initializeWorkspace({ directory: root, id: 'sample', topic: '身份隔离与安全机制' })
  const source = join(root, 'sources', 'main')
  execFileSync('git', ['init', '--quiet', source])
  const git = (...args: string[]) => execFileSync('git', ['-C', source, ...args], { stdio: 'pipe' })
  git('remote', 'add', 'origin', 'https://example.invalid/main.git')
  writeFileSync(join(source, 'auth.c'), '/* baseline */\n')
  git('add', 'auth.c')
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'baseline')
  const config = JSON.parse(readFileSync(join(root, 'project.json'), 'utf8'))
  config.primarySource = 'main'
  config.sources = [{ id: 'main', path: 'sources/main', url: 'https://example.invalid/main.git',
    ref: 'HEAD', role: 'subject', purpose: 'security subject' }]
  writeFileSync(join(root, 'project.json'), JSON.stringify(config))
  lockWorkspace(root)
  return root
}
const message = (text: string, kind: 'question' | 'correction' = 'question') => ({ id: randomUUID(), text, kind })

it('starts without any account CLI and keeps questions, answers and corrections in one local worker', async () => {
  const root = workspace()
  const probe = vi.fn().mockRejectedValue(new Error('no account CLI'))
  expect(await resolveDeployment(testMachine({ workspace: root }), {}, probe, '')).toMatchObject({ local: { workspace: realpathSync(root) } })
  expect(probe).not.toHaveBeenCalled()
  host = await startRuntime(undefined, { workspace: root })
  const h = host
  expect(h.runtime.configured()).toBe(true)
  expect(h.subprocess.spawn).not.toHaveBeenCalled()
  expect(existsSync(join(h.directory, 'agent-gh'))).toBe(false)
  expect((await h.api('GET', 'state')).body).toMatchObject({ setup: { accounts: null, local: { workspace: realpathSync(root) } } })
  expect(h.runtime.prompts.current().config.scope).toContain('Locked source collection')
  const first = message('解释访问控制的生效条件。')
  expect(await h.api('POST', 'research/messages', first)).toMatchObject({ status: 200, body: { duplicate: false } })
  await h.runtime.idle()
  const ticket = h.runtime.store.tickets.open()[0]!
  expect(ticket.execution?.directory).toBe(root)
  const sessionId = `worker-${ticket.id}`
  expect(h.agents.has(sessionId)).toBe(true)
  expect(JSON.parse(readFileSync(join(root, 'interactions/requests', `${first.id}.json`), 'utf8')).text).toBe(first.text)
  await h.runTool(sessionId, 'orchestrator_report', { state: 'ready', summary: '测试回复：条件待真实研究确认。', reply_to_trigger_id: `local:${first.id}` })
  await h.runTool(h.runtime.masterId, 'orchestrator_reply', { purpose: 'answer', ticket_id: ticket.id, trigger_id: `local:${first.id}`, text: '测试回复：条件待真实研究确认。' })
  await h.runtime.idle()
  expect(h.runtime.store.tickets.get(ticket.id)?.ended).toBeUndefined()
  const correction = message('纠正：这个机制只有开启对应配置才会生效。', 'correction')
  expect((await h.api('POST', 'research/messages', correction)).status).toBe(200)
  await h.runtime.idle()
  expect(h.runtime.store.tickets.open().map(t => t.id)).toEqual([ticket.id])
  expect(h.runtime.store.tickets.get(ticket.id)?.inputs).toEqual(expect.arrayContaining([expect.objectContaining({ triggerId: `local:${correction.id}` })]))
  expect(existsSync(join(root, 'interactions/corrections', `${correction.id}.json`))).toBe(true)
  expect(JSON.stringify(h.relays(sessionId))).toContain('"request_kind":"correction"')
  expect((await h.api('POST', 'research/messages', correction)).body.duplicate).toBe(true)
  expect((await h.api('POST', 'research/messages', { ...correction, text: 'different' })).status).toBe(409)
  const view = h.runtime.research!.view()
  expect(view.messages).toHaveLength(2)
  expect(view.messages[0]!.replies).toContainEqual(expect.objectContaining({ text: '测试回复：条件待真实研究确认。', status: 'sent' }))
  expect(view.sessions[0]?.sessionId).toBe(sessionId)
  expect(h.subprocess.spawn.mock.calls.every(([spec]) => !spec.argv.some(arg => arg.includes('agent-gh') || arg.includes('lark')))).toBe(true)
})

it('ingests only explicit folder tasks, claims them atomically and quarantines malformed files', async () => {
  const root = workspace()
  host = await startRuntime(undefined, { workspace: root })
  const valid = randomUUID()
  writeFileSync(join(root, 'interactions/inbox/requests', `${valid}.md`), '请检查身份校验入口与权限边界。\n')
  writeFileSync(join(root, 'docs', 'not-a-task.md'), '这只是项目资料，不应触发 agent。\n')
  writeFileSync(join(root, 'interactions/inbox/requests', 'bad-name.md'), '不应被当作任务。\n')
  await host.runtime.pump(); await host.runtime.idle()
  expect(host.runtime.research!.view().messages.map(message => message.id)).toContain(`local:${valid}`)
  expect(existsSync(join(root, 'interactions/inbox/processed/requests', `${valid}.md`))).toBe(true)
  expect(readdirSync(join(root, 'interactions/inbox/requests')).filter(name => name.endsWith('.md'))).toEqual([])
  expect(readdirSync(join(root, 'interactions/inbox/errors/requests')).filter(name => name.endsWith('.md'))).toContain('bad-name.md')
  expect(host.runtime.research!.view().inbox).toEqual({ pending: 0, errors: 1 })
})

it('restores the local identity and request history and refuses source/scope drift', async () => {
  const root = workspace()
  host = await startRuntime(undefined, { workspace: root, keepState: true })
  const first = message('列出待研究的问题。')
  expect((await host.api('POST', 'research/messages', first)).status).toBe(200)
  await host.runtime.idle()
  const stateDir = host.directory
  directories.push(stateDir)
  const ticketId = host.runtime.store.tickets.open()[0]!.id
  await host.stop(); host = undefined
  host = await startRuntime(undefined, { workspace: root, stateDir, keepState: true })
  expect(host.runtime.configured()).toBe(true)
  expect(host.runtime.research!.view().messages).toHaveLength(1)
  expect((await host.api('POST', 'research/messages', first)).body.duplicate).toBe(true)
  expect(host.runtime.store.tickets.open()[0]?.id).toBe(ticketId)
  writeFileSync(join(root, 'SCOPE.md'), 'changed scope')
  expect(await host.api('POST', 'research/messages', message('下一步？'))).toMatchObject({ status: 409 })
})

it('rejects a state directory bound to another local workspace and rejects malformed requests', async () => {
  const root = workspace()
  host = await startRuntime(undefined, { workspace: root, keepState: true })
  expect((await host.api('POST', 'research/messages', { id: '../../escape', text: 'x', kind: 'question' })).status).toBe(400)
  const stateDir = host.directory
  directories.push(stateDir)
  await host.stop(); host = undefined
  host = await startRuntime(undefined, { workspace: workspace(), stateDir, keepState: true })
  expect(host.runtime.configured()).toBe(false)
  expect(host.runtime.setupProblem?.code).toBe('localWorkspaceInvalid')
  expect((await host.api('POST', 'research/messages', message('x'))).status).toBe(400)
})

async function idleWorker(h: Host, sessionId: string) {
  const agent = h.agents.get(sessionId)!
  agent.status = 'idle'
  h.ctx.emit('agent/status', { agent, status: 'idle' } as never)
  await new Promise(resolve => setTimeout(resolve, 5))
  await h.runtime.idle()
}
async function continuousWorker(root: string, options: { stateDir?: string; keepState?: boolean; timeoutSeconds?: number } = {}) {
  const { timeoutSeconds, ...runtimeOptions } = options
  host = await startRuntime(undefined, { workspace: root, ...runtimeOptions })
  const h = host
  if (timeoutSeconds !== undefined) h.runtime.store.saveSettings({ ...h.runtime.store.settings(), research: { schedules: [
    { id: 'test-timeout', name: 'Test timeout', timezone: 'UTC', start: '00:00', end: '00:00', maxWorkers: 1, model: null, timeoutSeconds },
  ] } })
  expect((await h.api('POST', 'research/continuous', { enabled: true })).status).toBe(200)
  await h.runtime.idle()
  const ticket = h.runtime.store.tickets.open()[0]!, sessionId = `worker-${ticket.id}`
  expect(h.runtime.research!.continuous.view().status).toBe('user-priority')
  await h.runTool(sessionId, 'orchestrator_report', { state: 'ready', summary: '确认接管常驻研究职责。', reply_to_trigger_id: ticket.origin.triggerId })
  await idleWorker(h, sessionId)
  await h.runtime.pump(); await h.runtime.idle()
  expect(h.runtime.research!.continuous.view().active).not.toBeNull()
  const note = h.runtime.store.tickets.get(ticket.id)!.inputs.find(input => input.kind === 'note')
  expect(note?.text).toContain('具体研究问题由你根据当前项目、知识库和研究前沿自主选择')
  expect(note?.text).toContain('evidencePlan')
  expect(note?.text).not.toContain('结合已有研究，自主选择一个最值得弄清的项目安全机制')
  return { h, ticket, sessionId }
}

it('surfaces a research worker toolchain request on the Superagent-sec page', async () => {
  const root = workspace(), { h, sessionId } = await continuousWorker(root)
  const question = '请提供 llvm-objdump 17 或挂载包含它的临时分析 runtime。'
  await h.runTool(sessionId, 'orchestrator_report', { state: 'blocked', summary: '现有工具无法解析目标格式，已记录替代尝试。', human_action: question })
  const view = h.runtime.research!.view()
  expect(view.attention).toMatchObject({ question })
  expect(view.continuous.attention).toMatchObject({ question })
})

function checkpoint(h: Host, root: string) {
  writeFileSync(join(root, 'knowledge/mechanisms/identity.md'), 'Confirmed: auth.c is the pinned entry. Missing implementation remains an explicit unknown.\n')
  return {
    round_id: h.runtime.research!.continuous.view().active!.id,
    summary: '确认源码入口并记录防护设计尚无实现证据，后续检查授权链。', outcome: 'continue',
    artifacts: ['knowledge/mechanisms/identity.md'],
    evidence: [{ source: 'main', path: 'auth.c', line: 1, claim: '当前锁定版本的入口仅包含 baseline 注释。' }],
    next: [{ question: '授权检查在哪里生效，入口与执行路径是否共享相同权限边界？', rationale: '跨模块权限差异影响隔离有效性，应优先核实。', hypothesis: '新增入口可能没有复用现有的租户授权边界。', evidencePlan: '对照入口、授权函数和执行路径的源码及运行证据。', stopCondition: '确认授权检查覆盖范围并记录反例或未知。', impact: 5, uncertainty: 4, feasibility: 4, status: 'open', provenance: 'agent' }],
  }
}

it('autonomously advances from changed knowledge to the next question without a new human message', async () => {
  const root = workspace(), { h, ticket, sessionId } = await continuousWorker(root)
  h.runtime.engine.reply({ purpose: 'answer', ticketId: ticket.id, triggerId: ticket.origin.triggerId, text: '已确认接管常驻研究。' })
  await h.runtime.sendReplies()
  expect(h.runtime.store.tickets.get(ticket.id)!.answers).not.toContain(ticket.origin.triggerId)
  expect(h.runtime.research!.continuous.view().status).toBe('researching')
  const first = checkpoint(h, root)
  await h.runTool(sessionId, 'orchestrator_research_checkpoint', first)
  const view = h.runtime.research!.continuous.view()
  expect(view.totalRounds).toBe(1)
  expect(view.active).toBeNull()
  expect(view.candidates[0]).toMatchObject({
    rationale: first.next[0]!.rationale,
    hypothesis: expect.any(String), evidencePlan: expect.any(String), stopCondition: expect.any(String),
  })
  expect(JSON.parse(readFileSync(join(root, 'runs/continuous-research', `${first.round_id}.json`), 'utf8')).evidence[0].revision).toMatch(/^[a-f0-9]{40}$/)
  expect((await h.runTool(sessionId, 'orchestrator_research_checkpoint', first))).toMatchObject({ duplicate: true })
  await idleWorker(h, sessionId)
  const future = Date.now() + 11_000
  vi.spyOn(Date, 'now').mockReturnValue(future)
  await h.runtime.pump(); await h.runtime.idle()
  const next = h.runtime.research!.continuous.view().active!
  expect(next.id).not.toBe(first.round_id)
  expect(next.question).toBe(first.next[0]!.question)
  const notes = () => h.runtime.store.tickets.get(ticket.id)!.inputs.filter(input => input.kind === 'note')
  expect(notes()).toHaveLength(2)
  for (let i = 0; i < 4; i++) await h.runtime.pump()
  expect(notes()).toHaveLength(2)
  expect(h.runtime.research!.view().messages).toHaveLength(1)
  expect(h.controller.prompt).not.toHaveBeenCalled()
})

it('refreshes the research frontier after exhaustion and keeps real blockers stopped', async () => {
  const root = workspace(), { h, sessionId } = await continuousWorker(root)
  await h.runTool(sessionId, 'orchestrator_research_checkpoint', {
    round_id: h.runtime.research!.continuous.view().active!.id,
    summary: '当前问题集合已检查完毕，要求宿主重新扫描未决方向。', outcome: 'exhausted', artifacts: [], evidence: [],
    next: [],
  })
  let view = h.runtime.research!.continuous.view()
  expect(view.error).toBeUndefined()
  expect(view.candidates).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'open', question: '重新扫描已完成研究与未决问题，提出一个未重复且可用项目证据验证的新方向。' })]))
  await idleWorker(h, sessionId)
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11_000)
  await h.runtime.pump(); await h.runtime.idle()
  view = h.runtime.research!.continuous.view()
  expect(view.active?.question).toBe('重新扫描已完成研究与未决问题，提出一个未重复且可用项目证据验证的新方向。')

  await h.runTool(sessionId, 'orchestrator_research_checkpoint', {
    round_id: view.active!.id, summary: '重新扫描仍需要新的项目材料或人工授权。', outcome: 'exhausted', artifacts: [], evidence: [], next: [],
  })
  expect(h.runtime.research!.continuous.view()).toMatchObject({ status: 'blocked', error: '当前研究前沿已耗尽，需要新的项目证据或人工授权。' })
})

it('keeps an explicit research prerequisite visible while leaving other frontier work eligible', async () => {
  const root = workspace(), { h, sessionId } = await continuousWorker(root)
  const next = { question: '继续检查另一个独立的授权边界。', rationale: '该边界不依赖当前等待授权的动态实验。',
    hypothesis: '另一个入口可能存在独立的权限差异。', evidencePlan: '检查入口和调用方的源码证据。',
    stopCondition: '确认边界并记录证据或反证。', impact: 4, uncertainty: 3, feasibility: 4, status: 'open' as const, provenance: 'agent' as const }
  await h.runTool(sessionId, 'orchestrator_research_checkpoint', {
    round_id: h.runtime.research!.continuous.view().active!.id, summary: '动态验证需要操作者授权。', outcome: 'blocked', artifacts: [], evidence: [], next: [next],
    blocker: '需要操作者授权隔离环境中的动态连接跟踪。',
  })
  const view = h.runtime.research!.continuous.view()
  expect(view).toMatchObject({ status: 'waiting', error: undefined })
  expect(view).toMatchObject({ attention: { question: '需要操作者授权隔离环境中的动态连接跟踪。' } })
  const candidate = view.candidates.find(item => item.status === 'blocked')
  expect(candidate).toMatchObject({ status: 'blocked', blocker: '需要操作者授权隔离环境中的动态连接跟踪。' })
  expect(view.candidates).toEqual(expect.arrayContaining([expect.objectContaining({ question: next.question, status: 'open' })]))
  await idleWorker(h, sessionId)
  const now = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(now + 11_000)
  h.runtime.research!.continuous.tick()
  expect(h.runtime.research!.continuous.view().active?.question).toBe(next.question)
  vi.spyOn(Date, 'now').mockReturnValue(now + 22_000)
  h.runtime.research!.continuous.tick()
  expect(h.runtime.research!.continuous.view().error).toBeUndefined()

  const third = { ...next, question: '继续检查第三个独立的信任边界。' }
  await h.runTool(sessionId, 'orchestrator_research_checkpoint', {
    round_id: h.runtime.research!.continuous.view().active!.id, summary: '继续检查另一个独立边界。', outcome: 'exhausted', artifacts: [], evidence: [], next: [third],
  })
  expect(h.runtime.research!.continuous.view().candidates).toEqual(expect.arrayContaining([
    expect.objectContaining({ status: 'blocked', blocker: '需要操作者授权隔离环境中的动态连接跟踪。' }),
    expect.objectContaining({ question: third.question, status: 'open' }),
  ]))
}, 15_000)

it('drops a completed question when an agent returns it as a next candidate', async () => {
  const root = workspace(), { h, sessionId } = await continuousWorker(root)
  const completedQuestion = h.runtime.research!.continuous.view().active!.question
  const first = checkpoint(h, root)
  await h.runTool(sessionId, 'orchestrator_research_checkpoint', first)
  await idleWorker(h, sessionId)
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11_000)
  await h.runtime.pump(); await h.runtime.idle()
  const active = h.runtime.research!.continuous.view().active!
  await h.runTool(sessionId, 'orchestrator_research_checkpoint', {
    round_id: active.id, summary: '重复候选已经被过滤。', outcome: 'exhausted', artifacts: [], evidence: [],
    next: [{ ...first.next[0]!, question: completedQuestion }],
  })
  expect(h.runtime.research!.continuous.view().candidates.map(candidate => candidate.question)).not.toContain(completedQuestion)
})

it('applies the active research schedule route before each persistent worker round', async () => {
  const root = workspace()
  host = await startRuntime(undefined, { workspace: root })
  const h = host
  h.runtime.store.saveSettings({ ...h.runtime.store.settings(), research: { schedules: [
    { id: 'night', name: 'Night', timezone: 'UTC', start: '00:00', end: '00:00', maxWorkers: 1,
      model: { provider: 'night-provider', model: 'night-model' }, timeoutSeconds: null },
  ] } })
  expect((await h.api('POST', 'research/continuous', { enabled: true })).status).toBe(200)
  await h.runtime.idle()
  const ticket = h.runtime.store.tickets.open()[0]!, sessionId = `worker-${ticket.id}`
  await h.runTool(sessionId, 'orchestrator_report', { state: 'ready', summary: '确认接管常驻研究职责。', reply_to_trigger_id: ticket.origin.triggerId })
  await idleWorker(h, sessionId); await h.runtime.pump(); await h.runtime.idle()
  expect(h.controller.selectForNextRequest).toHaveBeenCalledWith(h.agents.get(sessionId), { provider: 'night-provider', model: 'night-model' })
})

it('runs independent research lanes during a special window and isolates their artifacts', async () => {
  const root = workspace()
  host = await startRuntime(undefined, { workspace: root })
  const h = host
  h.runtime.store.saveSettings({ ...h.runtime.store.settings(), research: { schedules: [
    { id: 'night', name: 'Night', timezone: 'UTC', start: '00:00', end: '00:00', maxWorkers: 3, model: null, timeoutSeconds: null },
  ] } })
  expect((await h.api('POST', 'research/continuous', { enabled: true })).status).toBe(200)
  await h.runtime.idle()
  const primary = h.runtime.store.tickets.open().find(ticket => h.runtime.store.triggers.get(ticket.origin.triggerId)?.meta.kind !== 'autonomous')!, primarySession = `worker-${primary.id}`
  await h.runTool(primarySession, 'orchestrator_report', { state: 'ready', summary: '确认接管常驻研究职责。', reply_to_trigger_id: primary.origin.triggerId })
  await idleWorker(h, primarySession); await h.runtime.pump(); await h.runtime.idle()
  const first = checkpoint(h, root)
  first.next = [
    { ...first.next[0]!, id: 'lane-a', question: '检查入口 A 的认证边界。' },
    { ...first.next[0]!, id: 'lane-b', question: '检查入口 B 的认证边界。' },
  ] as unknown as typeof first.next
  await h.runTool(primarySession, 'orchestrator_research_checkpoint', first)
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11_000)
  for (const worker of h.runtime.research!.continuous.view().workers) {
    const agent = h.agents.get(`worker-${worker.ticketId}`)
    if (agent && agent.status !== 'idle') { agent.status = 'idle'; h.ctx.emit('agent/status', { agent, status: 'idle' } as never) }
  }
  await h.runtime.pump(); await h.runtime.idle()
  const view = h.runtime.research!.continuous.view()
  expect(view.capacity).toBe(3)
  expect(view.activeRounds).toHaveLength(2)
  expect(new Set(view.activeRounds.map(round => round.ticketId)).size).toBe(2)
  const extra = view.activeRounds.find(round => round.ticketId !== primary.id)!
  const extraRound = extra.id
  writeFileSync(join(root, 'research/rounds', extraRound, 'lane.md'), '独立并发研究产物。\n')
  const extraSession = `worker-${extra.ticketId}`
  await expect(h.runTool(extraSession, 'orchestrator_research_checkpoint', {
    round_id: extraRound, summary: '记录并发 lane 的独立证据。', outcome: 'continue', artifacts: ['knowledge/mechanisms/identity.md'],
    evidence: [{ source: 'main', path: 'auth.c', line: 1, claim: '并发 lane 使用同一锁定源码版本。' }], next: [first.next[0]!],
  })).rejects.toThrow('Concurrent research lanes')
  await h.runTool(extraSession, 'orchestrator_research_checkpoint', {
    round_id: extraRound, summary: '记录并发 lane 的独立证据。', outcome: 'continue', artifacts: [`research/rounds/${extraRound}/lane.md`],
    evidence: [{ source: 'main', path: 'auth.c', line: 1, claim: '并发 lane 使用同一锁定源码版本。' }], next: [first.next[0]!],
  })
})

it('rejects missing, escaping, unchanged and unreferenced knowledge rather than claiming progress', async () => {
  const root = workspace()
  writeFileSync(join(root, 'knowledge/mechanisms/unchanged.md'), 'previous knowledge')
  const { h, sessionId } = await continuousWorker(root)
  const valid = checkpoint(h, root)
  const submit = (overrides: Record<string, unknown>) => h.runTool(sessionId, 'orchestrator_research_checkpoint', { ...valid, ...overrides })
  await expect(submit({ artifacts: ['knowledge/mechanisms/missing.md'] })).rejects.toThrow('artifact')
  await expect(submit({ artifacts: ['../escape.md'] })).rejects.toThrow('artifact')
  writeFileSync(join(root, 'knowledge/mechanisms/empty.md'), '')
  await expect(submit({ artifacts: ['knowledge/mechanisms/empty.md'] })).rejects.toThrow('artifact')
  await expect(submit({ artifacts: ['knowledge/mechanisms/unchanged.md'] })).rejects.toThrow('actual changes')
  await expect(submit({ evidence: [] })).rejects.toThrow('source evidence')
  await expect(submit({ evidence: [{ ...valid.evidence[0], line: 1000 }] })).rejects.toThrow('evidence')
  await expect(submit({ round_id: randomUUID() })).rejects.toThrow('unknown')
  expect(h.runtime.research!.continuous.view().totalRounds).toBe(0)
  await submit({})
  expect(h.runtime.research!.continuous.view().totalRounds).toBe(1)
})

it('steers human input into the same session and waits for its answer before scheduling more research', async () => {
  const root = workspace(), { h, ticket, sessionId } = await continuousWorker(root)
  const user = message('优先解释当前权限边界，先别继续自主研究。')
  await h.api('POST', 'research/messages', user)
  await h.runtime.idle(); h.step(sessionId)
  expect(h.runtime.research!.continuous.view().status).toBe('user-priority')
  await h.runTool(sessionId, 'orchestrator_research_checkpoint', checkpoint(h, root))
  await idleWorker(h, sessionId)
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11_000)
  await h.runtime.pump(); await h.runtime.idle()
  expect(h.runtime.research!.continuous.view().active).toBeNull()
  const userDeliveries = h.deliveries.mock.calls.map(([delivery]) => delivery).filter(delivery => delivery.sessionId === sessionId && delivery.text.includes(user.text))
  expect(userDeliveries.at(-1)?.mode).toBe('steer')
  await h.runTool(sessionId, 'orchestrator_report', { state: 'ready', summary: '先回答权限边界；细节仍需继续研究。', reply_to_trigger_id: `local:${user.id}` })
  await h.runtime.pump(); await h.runtime.idle()
  expect(h.runtime.research!.continuous.view().active).not.toBeNull()
  expect(h.runtime.store.tickets.get(ticket.id)!.answers).toContain(`local:${user.id}`)
})

it('pauses future rounds, respects global pause, and blocks on source drift', async () => {
  const root = workspace(), { h, sessionId } = await continuousWorker(root)
  await h.api('POST', 'research/continuous', { enabled: false })
  await h.runTool(sessionId, 'orchestrator_research_checkpoint', checkpoint(h, root))
  await idleWorker(h, sessionId)
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11_000)
  await h.runtime.pump(); await h.runtime.idle()
  expect(h.runtime.research!.continuous.view()).toMatchObject({ status: 'paused', active: null })
  h.runtime.store.saveSettings({ ...h.runtime.store.settings(), paused: true })
  await h.api('POST', 'research/continuous', { enabled: true })
  await h.runtime.pump()
  expect(h.runtime.research!.continuous.view()).toMatchObject({ status: 'system-paused', active: null })
  h.runtime.store.saveSettings({ ...h.runtime.store.settings(), paused: false })
  writeFileSync(join(root, 'sources/main/auth.c'), 'unreviewed drift\n')
  await h.runtime.pump()
  expect(h.runtime.research!.continuous.view()).toMatchObject({ status: 'blocked', active: null })
  expect((await h.api('POST', 'research/continuous', { enabled: false })).status).toBe(200)
})

it('bounds an explicitly timed active round and refuses an idle loop without checkpoints', async () => {
  const root = workspace(), { h, sessionId } = await continuousWorker(root, { timeoutSeconds: 900 })
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11_000)
  for (let i = 0; i < 3; i++) {
    await idleWorker(h, sessionId)
    clock.mockReturnValue(Date.now() + 11_000)
    await h.runtime.pump(); await h.runtime.idle()
  }
  expect(h.runtime.research!.continuous.view()).toMatchObject({ status: 'blocked', totalRounds: 0 })
  expect(h.runtime.research!.continuous.view().error).toContain('without a research checkpoint')
  await h.api('POST', 'research/continuous', { enabled: true })
  await h.runtime.pump(); await h.runtime.idle()
  clock.mockReturnValue(Date.now() + 16 * 60_000)
  await h.runtime.pump(); await h.runtime.idle()
  expect(h.runtime.research!.continuous.view().error).toContain('configured time limit')
  expect(h.agents.get(sessionId)!.cancel).toHaveBeenCalled()
})

it('restores the completed checkpoint and paused scheduling across host restart', async () => {
  const root = workspace()
  const stateDir = mkdtempSync(join(tmpdir(), 'brainafk-continuous-state-')); directories.push(stateDir)
  host = await startRuntime(undefined, { workspace: root, stateDir, keepState: true })
  const h = host
  await h.api('POST', 'research/continuous', { enabled: true }); await h.runtime.idle()
  const ticket = h.runtime.store.tickets.open()[0]!, sessionId = `worker-${ticket.id}`
  await h.runTool(sessionId, 'orchestrator_report', { state: 'ready', summary: '已接管常驻安全研究。', reply_to_trigger_id: ticket.origin.triggerId })
  await idleWorker(h, sessionId); await h.runtime.pump(); await h.runtime.idle()
  const args = checkpoint(h, root)
  await h.runTool(sessionId, 'orchestrator_research_checkpoint', args)
  await h.api('POST', 'research/continuous', { enabled: false })
  await idleWorker(h, sessionId)
  const archive = join(root, 'runs/continuous-research', `${args.round_id}.json`)
  rmSync(archive)
  await h.stop(); host = undefined
  host = await startRuntime(undefined, { workspace: root, stateDir, keepState: true })
  expect(host.runtime.research!.continuous.view()).toMatchObject({ status: 'paused', totalRounds: 1, active: null })
  expect(host.runtime.research!.continuous.view().rounds[0]!.id).toBe(args.round_id)
  await host.api('POST', 'research/continuous', { enabled: true }); await host.runtime.idle()
  await idleWorker(host, sessionId); await host.runtime.pump(); await host.runtime.idle()
  expect(existsSync(archive)).toBe(true)
  expect(host.runtime.research!.continuous.view().totalRounds).toBe(1)
})

it('keeps the same active round through restart and accepts its eventual checkpoint once', async () => {
  const root = workspace(), stateDir = mkdtempSync(join(tmpdir(), 'brainafk-active-state-')); directories.push(stateDir)
  const { h, ticket, sessionId } = await continuousWorker(root, { stateDir, keepState: true })
  const roundId = h.runtime.research!.continuous.view().active!.id
  await h.stop(); host = undefined
  host = await startRuntime(undefined, { workspace: root, stateDir, keepState: true })
  await host.runtime.idle()
  expect(host.runtime.research!.continuous.view().active!.id).toBe(roundId)
  expect(host.runtime.store.tickets.get(ticket.id)!.inputs.filter(input => input.kind === 'note')).toHaveLength(1)
  expect(host.runtime.research!.view().messages).toHaveLength(1)
  await host.runTool(sessionId, 'orchestrator_research_checkpoint', checkpoint(host, root))
  expect(host.runtime.research!.continuous.view()).toMatchObject({ active: null, totalRounds: 1 })
})

it('explicitly resumes a failed worker through the existing retry command without abandoning the round', async () => {
  const root = workspace(), { h, ticket, sessionId } = await continuousWorker(root)
  const round = h.runtime.research!.continuous.view().active!.id
  const assignment = h.runtime.store.tickets.get(ticket.id)!.assignments.at(-1)!.id
  await h.runTool(sessionId, 'orchestrator_report', { state: 'failed', summary: '模拟模型请求失败，等待操作者恢复。' })
  await idleWorker(h, sessionId); await h.runtime.pump()
  expect(h.runtime.research!.continuous.view().status).toBe('blocked')
  expect((await h.api('POST', 'research/continuous', { enabled: true })).status).toBe(200)
  await h.runtime.idle()
  expect(h.runtime.store.tickets.get(ticket.id)!.assignments.at(-1)!.id).not.toBe(assignment)
  expect(h.runtime.research!.continuous.view()).toMatchObject({ status: 'researching', error: undefined })
  expect(h.runtime.research!.continuous.view().active!.id).toBe(round)
})
