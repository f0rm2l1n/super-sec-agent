/** Check the authenticated gateway, backend and Superagent management routes. */
import fs from 'node:fs'

try {
  const token = process.env.DSH_SUPERAGENT_ACCESS_TOKEN?.trim()
    || fs.readFileSync(process.env.DSH_SUPERAGENT_ACCESS_TOKEN_FILE || '/var/lib/superagent/secrets/web-token', 'utf8').trim()
  if (!token) throw new Error('Missing access token')
  const response = await fetch(`http://127.0.0.1:${process.env.DSH_SUPERAGENT_WEB_PORT || '3184'}/orchestrator/api/state`, {
    headers: { authorization: `Bearer ${token}`, 'x-orchestrator-request': '1' },
    signal: AbortSignal.timeout(4000), redirect: 'error',
  })
  if (response.status !== 200) throw new Error(`Management API returned ${response.status}`)
  const state = await response.json()
  if (!state.health?.runtime || !['ready', 'paused'].includes(state.health.runtime.state)) throw new Error('Superagent runtime is not ready')
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
