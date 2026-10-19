'use strict'
const stateFolder = process.env.BOARD_LOAD_STATE || `${__dirname}/state`
const resultsFolder = process.env.BOARD_LOAD_RESULTS || `${__dirname}/results`
const path = require('node:path')
const fs = require('node:fs')
const Module = require('node:module')
const { performance } = require('node:perf_hooks')
const root = path.resolve(__dirname, '../..')
const counters = { http: {}, rpc: {}, rateLimited: 0, model: [], markup: { ok: 0, empty: 0, error: 0 }, httpFailed: 0, hello: [] }
const inc = (map, key) => { map[key] = (map[key] || 0) + 1 }
const allowed = new Set(['config', 'account', 'collaborator', 'transactor'])
function assertLocal(value) {
  if (!allowed.has(new URL(value).hostname)) throw new Error('Non-fixture endpoint refused')
}
const originalFetch = global.fetch
// Observe counts only. Never retain authentication headers or document content.
global.fetch = (url, options) => {
  assertLocal(String(url))
  const host = new URL(url).hostname
  let method = ''
  if (host === 'account' && options?.body) { try { method = JSON.parse(options.body).method || '' } catch {} }
  inc(counters.http, host + (method ? ':' + method : ''))
  return originalFetch(url, options).then(response => {
    if (!response.ok) counters.httpFailed++
    return response
  }, error => { counters.httpFailed++; throw error })
}
const { RPCHandler } = require(`${root}/foundations/core/packages/rpc/lib`)
const serialize = RPCHandler.prototype.serialize
const read = RPCHandler.prototype.readResponse
const pendingByHandler = new WeakMap()
function pendingFor(handler) {
  if (!pendingByHandler.has(handler)) pendingByHandler.set(handler, new Map())
  return pendingByHandler.get(handler)
}
RPCHandler.prototype.serialize = function (request, binary) {
  const pending = pendingFor(this)
  if (request.method) {
    inc(counters.rpc, request.method)
    if (request.method === 'loadModel' || request.method === 'hello') {
      const now = performance.now()
      const entry = pending.get(request.id) || { method: request.method, at: now, attempts: 0 }
      entry.lastAt = now
      entry.attempts++
      pending.set(request.id, entry)
    }
  }
  return serialize.call(this, request, binary)
}
RPCHandler.prototype.readResponse = function (data, binary) {
  const response = read.call(this, data, binary)
  const pending = pendingFor(this)
  if (response.rateLimit?.remaining === 0) counters.rateLimited++
  if (pending.has(response.id) && response.result !== undefined) {
    counters[pending.get(response.id).method === 'hello' ? 'hello' : 'model'].push({ ms: performance.now() - pending.get(response.id).at,
      lastAttemptMs: performance.now() - pending.get(response.id).lastAt, attempts: pending.get(response.id).attempts,
      decodedJsonBytes: Buffer.byteLength(JSON.stringify(response.result)),
      wireBytes: data.byteLength ?? Buffer.byteLength(data) })
    pending.delete(response.id)
  }
  return response
}
const { setMetadata } = require(`${root}/foundations/core/packages/platform/lib`)
const clientPlugin = require(`${root}/foundations/core/packages/client/lib`).default
// Keep the normal binary/compression settings and reject other websocket hosts.
const WebSocket = global.WebSocket
setMetadata(clientPlugin.metadata.ClientSocketFactory, url => { assertLocal(url); return new WebSocket(url) })
function loadBoard() {
  const file = path.join(__dirname, 'vendor/huly-board.cjs')
  let source = fs.readFileSync(file, 'utf8')
  const marker = 'const stored = projectSettings()'
  if (source.split(marker).length !== 2) throw new Error('Harness config injection point changed')
  source = source.replace(marker, 'const stored = { offline: false }')
  source += '\nmodule.exports.nativeConnection = nativeConnection\n'
  const compiled = new Module(file, module)
  compiled.filename = file
  compiled.paths = Module._nodeModulePaths(path.dirname(file))
  compiled._compile(source, file)
  return compiled.exports
}
function snapshot() { return structuredClone(counters) }
function diff(before) {
  const result = { http: {}, rpc: {}, rateLimited: counters.rateLimited - before.rateLimited,
    model: counters.model.slice(before.model.length), hello: counters.hello.slice(before.hello.length), httpFailed: counters.httpFailed - before.httpFailed,
    markup: Object.fromEntries(Object.entries(counters.markup).map(([k,v]) => [k, v - before.markup[k]])) }
  for (const kind of ['http', 'rpc']) for (const [key, value] of Object.entries(counters[kind])) {
    if (value !== (before[kind][key] || 0)) result[kind][key] = value - (before[kind][key] || 0)
  }
  return result
}
function wrapConnection(connection) {
  connection.client = new Proxy(connection.client, { get(target, key) {
    const value = target[key]
    if (typeof value !== 'function') return value
    if (key !== 'fetchMarkup') return value.bind(target)
    return async (...args) => {
      try {
        const answer = await value.apply(target, args)
        if (!answer || answer === '{"type":"doc","content":[]}') counters.markup.empty++
        else counters.markup.ok++
        return answer
      } catch (error) { counters.markup.error++; throw error }
    }
  } })
  return connection
}
module.exports = { root, loadBoard, snapshot, diff, wrapConnection }
