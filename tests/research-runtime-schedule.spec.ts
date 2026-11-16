import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { initializeWorkspace, lockWorkspace } from '../src/security/workspace.ts'
import { startRuntime } from './fixtures/host.ts'

const directories: string[] = []
let host: Awaited<ReturnType<typeof startRuntime>> | undefined

afterEach(async () => {
  await host?.stop()
  host = undefined
  vi.useRealTimers()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'superagent-schedule-'))
  directories.push(root)
  initializeWorkspace({ directory: root, id: 'schedule-test', topic: '调度窗口验收' })
  const source = join(root, 'sources', 'main')
  execFileSync('git', ['init', '--quiet', source])
  execFileSync('git', ['-C', source, 'config', 'user.name', 'Test'])
  execFileSync('git', ['-C', source, 'config', 'user.email', 'test@example.invalid'])
  execFileSync('git', ['-C', source, 'remote', 'add', 'origin', 'https://example.invalid/main.git'])
  writeFileSync(join(source, 'README.md'), '# schedule fixture\n')
  execFileSync('git', ['-C', source, 'add', 'README.md'])
  execFileSync('git', ['-C', source, 'commit', '--quiet', '-m', 'baseline'])
  const configPath = join(root, 'project.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  config.primarySource = 'main'
  config.sources = [{ id: 'main', path: 'sources/main', url: 'https://example.invalid/main.git', ref: 'HEAD', role: 'subject', purpose: 'schedule fixture' }]
  writeFileSync(configPath, JSON.stringify(config))
  lockWorkspace(root)
  return root
}

it('runs a real local runtime through an active window and routes its selected model', async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-15T01:00:00.000Z') })
  const root = workspace()
  host = await startRuntime(store => {
    store.saveSettings({ ...store.settings(), research: { defaultModel: { provider: 'intranet-provider', model: 'intranet-model' }, schedules: [
      { id: 'night', name: 'Night', timezone: 'UTC', start: '00:00', end: '02:00', maxWorkers: 3,
        model: { provider: 'night-provider', model: 'night-model' }, timeoutSeconds: null },
      { id: 'day', name: 'Day', timezone: 'UTC', start: '02:00', end: '00:00', maxWorkers: 1,
        model: { provider: 'day-provider', model: 'day-model' }, timeoutSeconds: null },
    ] } })
  }, { workspace: root })
  const h = host
  const initialResearch = (await h.api('GET', 'research')).body as { continuous: { schedule: unknown } }
  expect(initialResearch.continuous.schedule).toMatchObject({ id: 'night', maxWorkers: 3, model: { model: 'night-model' } })
  expect((await h.api('POST', 'research/continuous', { enabled: true })).status).toBe(200)
  await h.runtime.idle()
  const ticket = h.runtime.store.tickets.open()[0]!
  const sessionId = `worker-${ticket.id}`
  await h.runTool(sessionId, 'orchestrator_report', { state: 'ready', summary: '已接管研究。', reply_to_trigger_id: ticket.origin.triggerId })
  await h.runtime.idle()
  await h.runtime.pump()
  await h.runtime.idle()
  expect((await h.api('GET', 'research')).body).toMatchObject({ continuous: { capacity: 3, workers: expect.any(Array) } })
  expect(((await h.api('GET', 'research')).body as { continuous: { workers: unknown[] } }).continuous.workers).toHaveLength(3)
  const append = (h.agents.get(sessionId) as unknown as { session: { append: ReturnType<typeof vi.fn> } }).session.append
  expect(append.mock.calls.map(([type, value]) => ({ type, value }))).toContainEqual({
    type: 'model/selection', value: { provider: 'night-provider', model: 'night-model' },
  })
  vi.setSystemTime(new Date('2026-11-15T03:00:00.000Z'))
  const daytimeResearch = (await h.api('GET', 'research')).body as { continuous: { schedule: unknown } }
  expect(daytimeResearch.continuous.schedule).toMatchObject({ id: 'day', maxWorkers: 1, model: { model: 'day-model' } })
})

it('backs off a transient autonomous failure before creating the next assignment', async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-15T01:00:00.000Z') })
  const root = workspace()
  host = await startRuntime(store => {
    store.saveSettings({ ...store.settings(), research: { schedules: [
      { id: 'night', name: 'Night', timezone: 'UTC', start: '00:00', end: '02:00', maxWorkers: 1,
        model: null, timeoutSeconds: null },
    ] } })
  }, { workspace: root })
  const h = host
  expect((await h.api('POST', 'research/continuous', { enabled: true })).status).toBe(200)
  await h.runtime.idle()
  const ticket = h.runtime.store.tickets.open()[0]!, sessionId = `worker-${ticket.id}`
  await h.runTool(sessionId, 'orchestrator_report', { state: 'ready', summary: '已接管研究。', reply_to_trigger_id: ticket.origin.triggerId })
  await h.runtime.idle(); await h.runtime.pump(); await h.runtime.idle()
  const before = h.runtime.store.tickets.get(ticket.id)!.assignments.length
  await h.runTool(sessionId, 'orchestrator_report', { state: 'failed', summary: '502 Bad Gateway' })
  await h.runtime.idle(); await h.runtime.pump(); await h.runtime.idle()
  expect(h.runtime.store.tickets.get(ticket.id)!.assignments).toHaveLength(before)
  vi.setSystemTime(new Date('2026-11-15T01:00:16.000Z'))
  await h.runtime.pump(); await h.runtime.idle()
  expect(h.runtime.store.tickets.get(ticket.id)!.assignments.length).toBeGreaterThan(before)
})

it.each(['2026-11-15T01:00:00.000Z', '2026-11-15T03:00:00.000Z'])('uses the all-day custom model inside an inheriting window and outside windows (%s)', async now => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(now) })
  host = await startRuntime(store => {
    store.saveSettings({ ...store.settings(), research: {
      defaultModel: { provider: 'intranet-provider', model: 'intranet-model' },
      schedules: [{ id: 'night', name: 'Night', timezone: 'UTC', start: '00:00', end: '02:00', maxWorkers: 1, model: null, timeoutSeconds: null }],
    } })
  }, { workspace: workspace() })
  const h = host
  await h.api('POST', 'research/continuous', { enabled: true })
  await h.runtime.idle()
  const ticket = h.runtime.store.tickets.open()[0]!, sessionId = `worker-${ticket.id}`
  await h.runTool(sessionId, 'orchestrator_report', { state: 'ready', summary: '已接管研究。', reply_to_trigger_id: ticket.origin.triggerId })
  await h.runtime.idle(); await h.runtime.pump(); await h.runtime.idle()
  const append = (h.agents.get(sessionId) as unknown as { session: { append: ReturnType<typeof vi.fn> } }).session.append
  expect(append.mock.calls.map(([type, value]) => ({ type, value }))).toContainEqual({
    type: 'model/selection', value: { provider: 'intranet-provider', model: 'intranet-model' },
  })
})
