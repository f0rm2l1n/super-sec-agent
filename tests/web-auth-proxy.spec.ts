import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { afterEach, expect, it } from 'vitest'

const children: ChildProcess[] = []
afterEach(() => { for (const child of children.splice(0)) child.kill('SIGTERM') })

async function freePort() {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  await new Promise<void>(resolve => server.close(() => resolve()))
  return port
}

async function waitFor(url: string) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { await fetch(url); return }
    catch { await new Promise(resolve => setTimeout(resolve, 25)) }
  }
  throw new Error(`Timed out waiting for ${url}`)
}

it('requires the project token, then establishes a clean authenticated session', async () => {
  const root = mkdtempSync(join(tmpdir(), 'superagent-web-auth-'))
  writeFileSync(join(root, '.credentials.yaml'), 'version: 1\nrecords:\n  client-connection/browser-session:\n    kind: grant\n    payload:\n      version: 1\n      secret: dGVzdC1icm93c2VyLXNlY3JldA\n')
  writeFileSync(join(root, 'access-token'), 'test-access-token\n')
  const backendPort = await freePort(); const webPort = await freePort()
  const backend = spawn(process.execPath, ['-e', `require('node:http').createServer((req,res)=>{if(req.url?.startsWith('/plugins/??@deepseek-ai/dsh-client-modules/client.js')){res.end(req.url);return}res.end(req.headers.cookie||'')}).listen(${backendPort},'127.0.0.1')`])
  const proxy = spawn(process.execPath, [join(import.meta.dirname, '..', 'scripts', 'dsh-superagent-web-auth.mjs')], {
    env: { ...process.env, DSH_HOME: root, DSH_SUPERAGENT_ACCESS_TOKEN_FILE: join(root, 'access-token'), DSH_SUPERAGENT_BACKEND_PORT: String(backendPort), DSH_SUPERAGENT_WEB_PORT: String(webPort) },
  })
  children.push(backend, proxy)
  await waitFor(`http://127.0.0.1:${webPort}/`)

  const endpoint = `http://127.0.0.1:${webPort}/`
  expect((await fetch(endpoint)).status).toBe(401)
  expect((await fetch(`${endpoint}?token=wrong`)).status).toBe(401)
  const grant = await fetch(`${endpoint}?token=test-access-token`, { redirect: 'manual' })
  expect(grant.status).toBe(303)
  expect(grant.headers.get('location')).toBe('/')
  const cookie = grant.headers.get('set-cookie')?.split(';', 1)[0] || ''
  expect(cookie).toContain('superagent-access-')
  const browserCookieName = `dsh-auth-${createHash('sha256').update(`127.0.0.1:${backendPort}`).digest('base64url')}`
  const staleBrowserCookie = `${browserCookieName}=v1.stale.invalid`
  const authenticated = await fetch(endpoint, { headers: { cookie: `${staleBrowserCookie}; ${cookie}` } })
  expect(authenticated.status).toBe(200)
  const forwardedCookies = await authenticated.text()
  expect(forwardedCookies).toContain('dsh-auth-')
  expect(forwardedCookies).not.toContain('v1.stale.invalid')
  expect(forwardedCookies.match(new RegExp(`${browserCookieName}=`, 'g'))).toHaveLength(1)
  expect((await fetch(endpoint, { headers: { cookie, origin: `http://127.0.0.1:${webPort + 1}` } })).status).toBe(403)
  expect((await fetch(endpoint, { headers: { cookie, origin: endpoint.slice(0, -1) } })).status).toBe(200)
  const clientModules = await fetch(`${endpoint}plugins/??@deepseek-ai/dsh-client-modules/client.js&rev=test`, { headers: { cookie } })
  expect(clientModules.status).toBe(200)
  expect(await clientModules.text()).toContain('/plugins/??@deepseek-ai/dsh-client-modules/client.js&rev=test')
})
