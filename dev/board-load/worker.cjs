'use strict'
const fs = require('node:fs')
const { performance } = require('node:perf_hooks')
const { root, loadBoard, snapshot, diff } = require('./instrument.cjs')
const { createBoard, nativeConnection } = loadBoard()
const options = JSON.parse(process.argv[2] || '{}')
const config = { native: true, offline: false, url: 'http://config:8080', root,
  accounts: `${__dirname}/state/account-${options.separate ? options.lane : 0}.json`, workspace: 'hulyaccessevaluation',
  project_identifier: 'JH', board_projects: ['JH', 'VK8'], stage_status_projects: ['JH', 'VK8'],
  number_floor: 1, pageSize: 50, timeout: 600000, shared: options.shared === true }
const board = createBoard(config)
async function measure(operation, work) {
  const before = snapshot()
  const start = performance.now()
  let error, result
  try { result = await work() } catch (e) { error = String(e.message).split('\n')[0] }
  const row = { at: new Date().toISOString(), operation, lane: options.lane ?? 0,
    concurrency: options.concurrency ?? 1, ms: performance.now() - start, ok: !error,
    ...(error ? { error } : {}), ...diff(before) }
  if (result?.rows) row.rows = result.rows.length
  if (result?.tasks) row.tasks = result.tasks.length
  if (result?.applied !== undefined) row.applied = result.applied
  if (process.send) process.send(row)
  else fs.appendFileSync(`${__dirname}/results/smoke.jsonl`, JSON.stringify(row) + '\n')
  if (error) throw new Error(`${operation}: ${error}`)
  return result
}
async function main() {
  if (options.mode === 'smoke') {
    await measure('connect', async () => { const c = await nativeConnection(config); await c.client.close() })
    await measure('ping', () => board.ping())
    const catalog = await board.readStatusCatalog()
    console.log(JSON.stringify({ catalog }))
    const tasks = await measure('readProjectTasks', () => board.readProjectTasks('JH'))
    fs.writeFileSync(`${__dirname}/state/tasks.json`, JSON.stringify(tasks.rows.map(t => ({ id: t._id, identifier: t.identifier, stage: t.stage }))))
    return
  }
}
const timer = setTimeout(() => { console.error('Local load worker deadline'); process.exit(124) }, 20 * 60 * 1000)
main().then(() => { board.close(); clearTimeout(timer) }).catch(error => { console.error(error.message); board.close(); clearTimeout(timer); process.exitCode = 1 })
