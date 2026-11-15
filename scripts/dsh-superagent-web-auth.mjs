#!/usr/bin/env node
/**
 * Authenticated loopback gateway for one isolated DSH profile.
 *
 * The gateway requires a project access token before it forwards a request. It
 * then adds the DSH browser-session grant for the private backend. The access
 * token is generated in the isolated DSH home and never belongs in Git.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { URL } from 'node:url'

const publicHost = process.env.DSH_SUPERAGENT_WEB_HOST || '127.0.0.1'
const publicPort = Number(process.env.DSH_SUPERAGENT_WEB_PORT || 3184)
const advertisedHost = process.env.DSH_SUPERAGENT_WEB_ADVERTISE_HOST
  || (publicHost === '0.0.0.0' || publicHost === '::' ? '127.0.0.1' : publicHost)
const backendHost = process.env.DSH_SUPERAGENT_BACKEND_HOST || '127.0.0.1'
const backendPort = Number(process.env.DSH_SUPERAGENT_BACKEND_PORT || 3182)
const backendAuthority = `${backendHost}:${backendPort}`
const dshHome = process.env.DSH_HOME || process.env.DSH_SUPERAGENT_HOME || path.join(process.env.HOME || '.', '.dsh-superagent')
const tokenFile = process.env.DSH_SUPERAGENT_ACCESS_TOKEN_FILE || path.join(dshHome, 'web-access-token')
const cookieName = `superagent-access-${crypto.createHash('sha256').update(`${publicHost}:${publicPort}`).digest('hex').slice(0, 16)}`
const browserCookieName = `dsh-auth-${crypto.createHash('sha256').update(backendAuthority).digest('base64url')}`

function readBrowserSecret() {
  const credentials = fs.readFileSync(path.join(dshHome, '.credentials.yaml'), 'utf8')
  const match = credentials.match(/client-connection\/browser-session:[\s\S]*?secret: ([A-Za-z0-9_-]+)/)
  if (!match) throw new Error(`DSH browser-session credential not found in ${dshHome}`)
  return Buffer.from(match[1].replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - match[1].length % 4) % 4), 'base64')
}

function accessToken() {
  const fromEnvironment = process.env.DSH_SUPERAGENT_ACCESS_TOKEN?.trim()
  if (fromEnvironment) return fromEnvironment
  try {
    const value = fs.readFileSync(tokenFile, 'utf8').trim()
    if (value) return value
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const value = crypto.randomBytes(32).toString('base64url')
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true, mode: 0o700 })
  fs.writeFileSync(tokenFile, `${value}\n`, { mode: 0o600, flag: 'wx' })
  return value
}

function sameSecret(left, right) {
  const a = Buffer.from(left || '')
  const b = Buffer.from(right || '')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

const browserSecret = readBrowserSecret()
const projectToken = accessToken()
const accessCookie = crypto.createHmac('sha256', projectToken).update(`${publicHost}:${publicPort}`).digest('base64url')

function cookieValue(headers, name) {
  const cookies = String(headers.cookie || '').split(';').map(value => value.trim())
  return cookies.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) || ''
}

function authenticated(request, url) {
  const bearer = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '')
  return sameSecret(url.searchParams.get('token'), projectToken)
    || sameSecret(bearer, projectToken)
    || sameSecret(cookieValue(request.headers, cookieName), accessCookie)
}

function queryAuthenticated(request, url) {
  return sameSecret(url.searchParams.get('token'), projectToken)
}

function requestPathWithoutToken(rawUrl) {
  const value = rawUrl || '/'
  const question = value.indexOf('?')
  if (question < 0) return value
  const rawQuery = value.slice(question + 1)
  const params = new URLSearchParams(rawQuery)
  // DSH bundles plugin batches in a path containing a second '?', for
  // example /plugins/??@deepseek-ai/dsh-client-modules/client.js. Reusing
  // URL.search after touching searchParams percent-encodes that character and
  // makes the otherwise valid DSH resource return 404.
  if (!params.has('token')) return value
  params.delete('token')
  const query = params.toString()
  return `${value.slice(0, question)}${query ? `?${query}` : ''}`
}

function sessionCookie() {
  const issuedAt = Date.now()
  const expiresAt = issuedAt + 30 * 24 * 60 * 60 * 1000
  const body = Buffer.from(JSON.stringify({ version: 1, authority: backendAuthority, issuedAt, expiresAt })).toString('base64url')
  const signature = crypto.createHmac('sha256', browserSecret).update(body).digest('base64url')
  return `${browserCookieName}=v1.${body}.${signature}`
}

function headersForBackend(headers) {
  const output = { ...headers, host: backendAuthority }
  // Browsers can retain a cookie minted by another DSH process that used the
  // same loopback authority (for example, a normal DSH session on the host).
  // DSH's cookie parser intentionally uses the first matching cookie, so
  // appending our valid grant after a stale value would still produce a 401.
  // Remove the authority-bound DSH cookie before adding this isolated process'
  // freshly signed grant.
  const existingCookies = String(output.cookie || '')
    .split(';')
    .map(value => value.trim())
    .filter(value => value && !value.startsWith(`${browserCookieName}=`))
  output.cookie = [...existingCookies, sessionCookie()].join('; ')
  if (output.origin) output.origin = `http://${backendAuthority}`
  delete output.authorization
  delete output['content-length']
  return output
}

function setAccessCookie(response) {
  response.setHeader('set-cookie', `${cookieName}=${accessCookie}; Path=/; HttpOnly; SameSite=Strict`)
}

function forward(request, response, requestPath) {
  const upstream = http.request({ hostname: backendHost, port: backendPort, method: request.method, path: requestPath, headers: headersForBackend(request.headers) }, upstreamResponse => {
    const headers = { ...upstreamResponse.headers }
    headers['set-cookie'] = [...(upstreamResponse.headers['set-cookie'] || []), `${browserCookieName}=v1.${sessionCookie().split('=v1.')[1]}; Path=/; HttpOnly; SameSite=Strict`, `${cookieName}=${accessCookie}; Path=/; HttpOnly; SameSite=Strict`]
    response.writeHead(upstreamResponse.statusCode || 502, headers)
    upstreamResponse.pipe(response)
  })
  upstream.on('error', error => {
    if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    response.end(`DSH backend unavailable: ${error.message}\n`)
  })
  request.pipe(upstream)
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', `http://${publicHost}:${publicPort}`)
  if (!authenticated(request, url)) {
    response.writeHead(401, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'www-authenticate': 'Bearer' })
    response.end('Superagent access token required.\n')
    return
  }
  if (queryAuthenticated(request, url)) {
    setAccessCookie(response)
    response.writeHead(303, { location: requestPathWithoutToken(request.url), 'cache-control': 'no-store' })
    response.end()
    return
  }
  setAccessCookie(response)
  forward(request, response, requestPathWithoutToken(request.url))
})

server.on('upgrade', (request, clientSocket, head) => {
  const url = new URL(request.url || '/', `http://${publicHost}:${publicPort}`)
  if (!authenticated(request, url)) {
    clientSocket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
    return
  }
  const upstream = net.connect(backendPort, backendHost, () => {
    const headers = headersForBackend(request.headers)
    const lines = [`${request.method} ${requestPathWithoutToken(request.url)} HTTP/${request.httpVersion}`, ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`), '', '']
    upstream.write(lines.join('\r\n'))
    if (head.length) upstream.write(head)
    clientSocket.pipe(upstream).pipe(clientSocket)
  })
  upstream.on('error', () => clientSocket.destroy())
  clientSocket.on('error', () => upstream.destroy())
})

server.listen(publicPort, publicHost, () => {
  const token = process.env.DSH_SUPERAGENT_ACCESS_TOKEN ? '<provided by environment>' : projectToken
  console.log(`Superagent-sec authenticated web: http://${advertisedHost}:${publicPort}/?token=${token}`)
  console.log(`Token file: ${tokenFile}`)
})
