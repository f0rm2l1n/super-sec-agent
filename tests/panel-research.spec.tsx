// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { usePanel, mount, click, type, text } from './fixtures/panel.tsx'
import { server } from './fixtures/panel-server.ts'

usePanel()
it('keeps a failed question editable, retries with the same ID, and opens the research session', async () => {
  const local = { workspace: '/research/sample', id: 'sample', name: 'Sample' }
  server.setup = { ...server.setup, accounts: null, local }
  server.research = { ...local, attention: null, sources: [{ id: 'main', kind: 'git', path: 'sources/main', revision: 'a'.repeat(40), role: 'subject' }],
    continuous: { enabled: false, status: 'paused', active: null, workers: [], activeRounds: [], capacity: 1, error: undefined, attention: null, rounds: [], totalRounds: 0, candidates: [], nextAt: new Date(0).toISOString(),
      schedule: {} },
    inbox: { pending: 0, errors: 0 }, messages: [], sessions: [{ ticketId: 'local-ticket', sessionId: 'worker-local-ticket', title: 'Sample security' }] }
  await mount()
  expect(text()).toContain(zh['research.title'])
  await click(zh['research.start'])
  expect(server.research!.continuous.enabled).toBe(true)
  expect(text()).toContain(zh['research.loop.waiting'])
  await click(zh['research.pause'])
  expect(server.research!.continuous.enabled).toBe(false)
  const editor = document.querySelector<HTMLTextAreaElement>('textarea')!
  await type(editor, '认证在哪一层生效？')
  server.researchError = '模型暂不可用，请重试'
  await click(zh['research.send'])
  expect(editor.value).toBe('认证在哪一层生效？')
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('模型暂不可用')
  server.researchError = undefined
  await click(zh['research.send'])
  const requests = server.requests.filter(request => request.path === 'research/messages')
  expect(requests).toHaveLength(2)
  expect(requests[1]!.body).toEqual(requests[0]!.body)
  expect(editor.value).toBe('')
  expect(text()).toContain(zh['research.sent'])
  expect(text()).toContain('认证在哪一层生效？')
  await type(document.querySelector<HTMLSelectElement>('select')!, 'correction')
  await type(editor, '纠正：内核不负责这一层授权。')
  await click(zh['research.send'])
  expect(server.research!.messages.at(-1)?.kind).toBe('correction')
  await click(zh['research.openSession'])
  expect(server.opened).toContain('worker-local-ticket')
})

it('shows the active special schedule and its host-enforced concurrency in the research panel', async () => {
  const local = { workspace: '/research/sample', id: 'sample', name: 'Sample' }
  server.setup = { ...server.setup, accounts: null, local }
  server.research = { ...local, attention: null, sources: [],
    continuous: { enabled: true, status: 'waiting', active: null, workers: [], activeRounds: [], capacity: 4, error: undefined, attention: null, rounds: [], totalRounds: 0, candidates: [],
      nextAt: new Date(0).toISOString(), schedule: { id: 'night', name: '夜间算力', timezone: 'Asia/Shanghai', localTime: '01:30', maxWorkers: 4,
        model: { provider: 'deepseek', model: 'deepseek-flash' }, nextTransitionAt: '2026-11-15T06:30:00.000Z' } },
    inbox: { pending: 0, errors: 0 }, messages: [], sessions: [] }
  await mount()
  expect(text()).toContain('夜间算力')
  expect(text()).toContain('研究并发 4')
  expect(text()).toContain('当前窗口至')
})
