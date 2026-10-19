'use strict'
const stateFolder = process.env.BOARD_LOAD_STATE || `${__dirname}/state`
const resultsFolder = process.env.BOARD_LOAD_RESULTS || `${__dirname}/results`
const fs = require('node:fs')
const { performance } = require('node:perf_hooks')
const { root, loadBoard, snapshot, diff, wrapConnection } = require('./instrument.cjs')
const { createBoard, nativeConnection } = loadBoard()
const options = JSON.parse(process.argv[2] || '{}')
const config = { native: true, offline: false, url: 'http://config:8080', root,
  accounts: `${stateFolder}/account-${options.separate ? options.lane : (options.accountIndex ?? 0)}.json`, workspace: 'hulyaccessevaluation',
  project_identifier: 'JH', board_projects: ['JH', 'VK8'], stage_status_projects: ['JH', 'VK8'],
  number_floor: 1, pageSize: 50, timeout: 600000, shared: options.shared === true }
const board = createBoard({ ...config, connect: async c => wrapConnection(await nativeConnection(c)) })
async function measure(operation, work) {
  const before = snapshot()
  const start = performance.now()
  const heartbeat = setInterval(() => fs.writeFileSync(`${resultsFolder}/heartbeat-${process.pid}.json`,
    JSON.stringify({ operation, lane: options.lane ?? 0, elapsedMs: performance.now() - start, ...diff(before) })), 5000)
  let error, result, progress
  try { result = await work() } catch (e) { error = String(e.message).split('\n')[0]; progress = e.progress }
  clearInterval(heartbeat)
  const row = { at: new Date().toISOString(), operation, lane: options.lane ?? 0,
    concurrency: options.concurrency ?? 1, ms: performance.now() - start, ok: !error,
    ...(error ? { error } : {}), ...(progress ? { progress } : {}), ...diff(before) }
  if (result !== undefined) row.resultJsonBytes = Buffer.byteLength(JSON.stringify(result))
  if (result?.rows) row.rows = result.rows.length
  if (result?.tasks) {
    row.tasks = result.tasks.length
    row.nonemptyDescriptions = result.tasks.filter(task => task.description.trim()).length
    if (operation === 'readSupervisionBoard') row.qualityOk = row.nonemptyDescriptions === 6913
    row.comments = result.tasks.reduce((n,t) => n + t.comments.length, 0)
  }
  if (result?.applied !== undefined) row.applied = result.applied
  if (process.send) process.send(row)
  else fs.appendFileSync(`${resultsFolder}/smoke.jsonl`, JSON.stringify(row) + '\n')
  if (error) throw new Error(`${operation}: ${error}`)
  return result
}
async function run(operation, request) {
  const tasks = JSON.parse(fs.readFileSync(`${stateFolder}/tasks.json`))
  const task = tasks[(options.lane ?? 0) % tasks.length]
  if (operation === 'connect') return measure(operation, async () => { const c = await nativeConnection(config); await c.client.close() })
  if (operation === 'ping') return measure(operation, () => board.ping())
  if (operation === 'resolveTask') return measure(operation, () => board.resolveTask(task.identifier))
  if (operation === 'readProjectTasks') return measure(operation, async () => {
    const result = await board.readProjectTasks('JH')
    if (result.rows.length !== tasks.length) throw new Error('Incomplete project fixture read')
    return result
  })
  if (operation === 'readSupervisionBoard') return measure(operation, async () => {
    const result = await board.readSupervisionBoard({ projects: ['VK8'] })
    if (result.tasks?.length !== 6914) throw new Error('Incomplete supervision fixture read')
    return result
  })
  if (operation === 'setTaskStage') return measure(operation, () => board.setTaskStage(task.id,
    request.iteration % 2 ? 'stage:Ready for review' : 'stage:implementing'))
  if (operation === 'postTaskComment') return measure(operation, () => board.postTaskComment(task.id, `Local load comment ${Date.now()}`))
  if (operation === 'migrateStageLabelsToStatus') {
    const ids = JSON.parse(fs.readFileSync(`${stateFolder}/migration-ids.json`))
    const lane = request.mixed ? 0 : (options.lane ?? 0)
    const count = request.mixed ? 1000 : 300
    const cards = request.mixed ? ids.slice(0, count) : ids.slice(lane * count, (lane + 1) * count)
    return measure(operation, async () => {
      const result = await board.migrateStageLabelsToStatus(true, [], { cards, batchSize: 25 })
      if (result.applied !== count) throw new Error(`Migration applied ${result.applied}, expected ${count}`)
      return result
    })
  }
  if (operation === 'exhaust') {
    const connection = await nativeConnection(config)
    let pending
    try {
      // More than 2 * 1500 rejects exercises the limiter's future-timestamp branch.
      // Connect while those real queries remain outstanding, then drain them.
      const before = snapshot()
      const started = performance.now()
      pending = Promise.all(Array.from({ length: 400 }, () =>
        connection.client.findAll(connection.tracker.class.Project, {}, { limit: 1, showArchived: true })))
      await new Promise(resolve => setTimeout(resolve, 2000))
      await measure('connect-after-exhaust', async () => { const c = await nativeConnection(config); await c.client.close() })
      await pending
      const row = { at: new Date().toISOString(), operation: 'exhaust-queries', lane: options.lane ?? 0,
        concurrency: options.concurrency ?? 1, ms: performance.now() - started, ok: true, overlappingConnect: true, ...diff(before) }
      process.send(row)
    } finally { await connection.client.close() }
    return
  }
  if (operation === 'sweep') {
    await measure('launcher-read', () => board.readProjectTasks(request.project))
    await measure('sweep-read', () => board.readSupervisionBoard({ projects: [request.project], stages: ['stage:queued', 'stage:implementing', 'stage:Ready for review'] }))
    return
  }
  throw new Error('Unknown load operation')
}
async function main() {
  if (options.mode === 'smoke') {
    await measure('connect', async () => { const c = await nativeConnection(config); await c.client.close() })
    await measure('ping', () => board.ping())
    const catalog = await board.readStatusCatalog()
    console.log(JSON.stringify({ catalog }))
    const tasks = await measure('readProjectTasks', () => board.readProjectTasks('JH'))
    fs.writeFileSync(`${stateFolder}/tasks.json`, JSON.stringify(tasks.rows.map(t => ({ id: t._id, identifier: t.identifier, stage: t.stage }))))
    return
  }
  if (!process.send) throw new Error('Worker requires the local load driver')
  process.on('message', async request => {
    if (request.stop) { board.close(); clearTimeout(timer); process.disconnect(); setTimeout(() => process.exit(0), 100); return }
    timer.refresh()
    try { await run(request.operation, request); process.send({ done: true }) }
    catch (error) { console.error(error.message); process.send({ done: true, failed: true, fatal: /Incomplete .* fixture|Migration applied/.test(error.message) }) }
  })
  process.send({ ready: true })
}
const timer = setTimeout(() => { console.error('Local load worker deadline'); process.exit(124) }, 40 * 60 * 1000)
main().then(() => { if (options.mode === 'smoke') { board.close(); clearTimeout(timer) } }).catch(error => { console.error(error.message); board.close(); clearTimeout(timer); process.exitCode = 1 })
