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
  number_floor: 1, pageSize: options.pageSize ?? 50, timeout: 600000, shared: options.shared === true }
const board = createBoard({ ...config, connect: async c => wrapConnection(await nativeConnection(c)) })
async function measure(operation, work) {
  const before = snapshot()
  const start = performance.now()
  const heartbeat = setInterval(() => fs.writeFileSync(`${resultsFolder}/heartbeat-${process.pid}.json`,
    JSON.stringify({ operation, lane: options.lane ?? 0, elapsedMs: performance.now() - start, ...diff(before) })), 5000)
  let error, result, progress, censored
  let deadline
  const boundedWork = ['prime-connect','connect-after-exhaust'].includes(operation) ? () => Promise.race([work(), new Promise((_,reject) => {
    deadline=setTimeout(()=>{const error=new Error('Connect probe exceeded eight minutes'); error.censored=true; reject(error)},480000)
  })]) : work
  try { result = await boundedWork() } catch (e) { error = String(e.message).split('\n')[0]; progress = e.progress; censored=e.censored }
  clearTimeout(deadline)
  clearInterval(heartbeat)
  const row = { at: new Date().toISOString(), operation, lane: options.lane ?? 0,
    concurrency: options.concurrency ?? 1, ...(['prime-connect','connect-after-exhaust'].includes(operation) ? { overlappingWorkload: true } : {}), ms: performance.now() - start, ok: !error,
    ...(error ? { error } : {}), ...(censored ? { censored: true } : {}), ...(progress ? { progress } : {}), ...diff(before) }
  if (result !== undefined) row.resultJsonBytes = Buffer.byteLength(JSON.stringify(result))
  if (result?.rows) {
    row.rows = result.rows.length
    const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value
    row.rowsSha256 = require('node:crypto').createHash('sha256').update(JSON.stringify(canonical(result.rows))).digest('hex')
  }
  if (result?.tasks) {
    row.tasks = result.tasks.length
    row.nonemptyDescriptions = result.tasks.filter(task => task.description.trim()).length
    if (operation === 'readSupervisionBoard') row.qualityOk = row.nonemptyDescriptions === 6913
    row.comments = result.tasks.reduce((n,t) => n + t.comments.length, 0)
  }
  if (result?.applied !== undefined) row.applied = result.applied
  if (result?.pages !== undefined) row.pages = result.pages
  if (result?.counts !== undefined) row.counts = result.counts
  if (result?.changes !== undefined) row.changes = result.changes
  if (result?.failures !== undefined) row.failures = result.failures
  if (process.send) process.send(row)
  else fs.appendFileSync(`${resultsFolder}/smoke.jsonl`, JSON.stringify(row) + '\n')
  if (error) throw new Error(`${operation}: ${error}`)
  return result
}
// The complete client read keeps its card identities, so the snapshot read can
// prove it returned the same set.
let baselineIds = null
let filteredBaselineIds = null
let snapshotState = null
let filteredQuery = null
async function snapshotConnection () {
  if (snapshotState === null) {
    snapshotState = await nativeConnection(config)
    wrapConnection(snapshotState)
  }
  return snapshotState
}

// The expensive client read: an _id cursor walk with exact totals, then a
// catch-up walk for rows written since the read began, then a batched id
// recheck. This is the algorithm in the harness client, repeated here for a
// filtered query the harness does not expose.
async function walkRows (client, cls, query, pageSize) {
  const ids = []
  let cursor
  for (;;) {
    const page = await client.findAll(cls, cursor === undefined ? query : { ...query, _id: { ...(query._id && !Array.isArray(query._id) ? query._id : {}), $gt: cursor } },
      { limit: pageSize, sort: { _id: 1 }, total: true, showArchived: true })
    if (!Array.isArray(page) || !Number.isSafeInteger(page.total)) throw new Error('Huly returned an invalid page or omitted its total')
    for (const row of page) ids.push(row._id)
    if (page.length < pageSize) return ids
    cursor = page.at(-1)._id
  }
}
async function filteredRead (client, cls, query, pageSize) {
  const startedAt = Date.now() - 30000
  const walked = await walkRows(client, cls, query, pageSize)
  if (walked.length < pageSize) return { rows: walked, pages: 1 }
  const changed = await walkRows(client, cls, { ...query, modifiedOn: { $gte: startedAt } }, pageSize)
  const merged = new Set([...walked, ...changed])
  const ids = [...merged].sort()
  const current = new Set()
  for (let start = 0; start < ids.length; start += 500) {
    for (const id of await walkRows(client, cls, { ...query, _id: { $in: ids.slice(start, start + 500) } }, pageSize)) current.add(id)
  }
  return { rows: ids.filter(id => current.has(id)), pages: Math.ceil(walked.length / pageSize) }
}
async function filteredCardsQuery (client, tracker, space) {
  // Pick the two statuses that hold the most cards of this project, so the
  // filtered read is a real multi-page walk rather than a handful of rows.
  if (filteredQuery === null) {
    const statuses = await client.findAll(tracker.class.IssueStatus, {}, { showArchived: true })
    const counts = []
    for (const status of statuses) {
      const rows = await client.findAll(tracker.class.Issue, { space, status: status._id }, { limit: 1, total: true, showArchived: true })
      counts.push({ id: status._id, total: rows.total ?? rows.length })
    }
    counts.sort((a, b) => b.total - a.total)
    filteredQuery = { status: { $in: counts.slice(0, 2).map(count => count.id) } }
  }
  return { space, ...filteredQuery }
}

// One page at a time from the server snapshot read. The card identities are
// identical in shape to the complete client read, so the two can be compared.
async function snapshotRead (kind) {
  const { client, tracker, tags, chunter } = await snapshotConnection()
  const project = await client.findOne(tracker.class.Project, { identifier: 'JH' }, { showArchived: true })
  if (!project) throw new Error('Huly project does not exist')
  const cards = kind === 'filtered' ? await filteredCardsQuery(client, tracker, project._id) : { space: project._id }
  const sections = [
    { key: 'cards', _class: tracker.class.Issue, query: cards, limit: 1000 },
    { key: 'labels', _class: tags.class.TagReference, query: { collection: 'labels' }, limit: 1000 },
    { key: 'comments', _class: chunter.class.ChatMessage, query: { collection: 'comments' }, limit: 1000 },
    { key: 'statuses', _class: tracker.class.IssueStatus, query: {}, limit: 500, firstPageOnly: true, scoped: false },
    { key: 'catalog', _class: tags.class.TagElement, query: { targetClass: tracker.class.Issue }, limit: 1000, firstPageOnly: true, scoped: false }
  ]
  const ids = []
  const counts = {}
  let cursor
  let pages = 0
  let changes = 0
  let failures = 0
  for (;;) {
    const page = await client.findSnapshot({ space: project._id, sections, cursor, includeChanges: true })
    pages++
    for (const section of page.sections) counts[section.key] = (counts[section.key] ?? 0) + section.docs.length
    for (const doc of page.sections[0].docs) ids.push(doc._id)
    changes += page.changes?.length ?? 0
    failures += page.failures.length
    cursor = page.next
    if (cursor === undefined) break
  }
  return { rows: ids, pages, counts, changes, failures }
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
  if (operation === 'readProjectTasksIds') return measure(operation, async () => {
    const result = await board.readProjectTasks('JH')
    if (result.rows.length !== tasks.length) throw new Error('Incomplete project fixture read')
    baselineIds = result.rows.map(row => row._id).sort()
    return { rows: baselineIds }
  })
  if (operation === 'readSnapshotFull' || operation === 'readSnapshotFiltered') {
    return measure(operation, async () => {
      const result = await snapshotRead(operation === 'readSnapshotFiltered' ? 'filtered' : 'full')
      if (operation === 'readSnapshotFull') {
        if (result.rows.length !== tasks.length) throw new Error(`Incomplete snapshot fixture read: ${result.rows.length} of ${tasks.length}`)
        result.matchesBaseline = baselineIds !== null && JSON.stringify([...result.rows].sort()) === JSON.stringify(baselineIds)
        if (!result.matchesBaseline) throw new Error('Snapshot card set differs from the complete client read')
      }
      if (result.failures > 0) throw new Error(`Snapshot reported ${result.failures} failed sections`)
      if (operation === 'readSnapshotFiltered' && process.env.BOARD_LOAD_MOVER === '0') {
        if (filteredBaselineIds === null) throw new Error('The filtered walk ran first in a quiet run')
        if (JSON.stringify([...result.rows].sort()) !== JSON.stringify(filteredBaselineIds)) {
          throw new Error('Filtered snapshot card set differs from the filtered client walk')
        }
      }
      return result
    })
  }
  if (operation === 'readFilteredWalk') return measure(operation, async () => {
    const { client, tracker } = await snapshotConnection()
    const project = await client.findOne(tracker.class.Project, { identifier: 'JH' }, { showArchived: true })
    if (!project) throw new Error('Huly project does not exist')
    const query = await filteredCardsQuery(client, tracker, project._id)
    const result = await filteredRead(client, tracker.class.Issue, query, config.pageSize)
    filteredBaselineIds = [...result.rows].sort()
    return { rows: result.rows, pages: result.pages }
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
    let connection
    await measure('prime-connect', async () => { connection = await nativeConnection(config) })
    let pending
    try {
      // More than 2 * 1500 rejects exercises the limiter's future-timestamp branch.
      // Connect while those real queries remain outstanding, then drain them.
      const before = snapshot()
      const started = performance.now()
      pending = Promise.all(Array.from({ length: 400 }, () =>
        connection.client.findAll(connection.tracker.class.Project, {}, { limit: 1, showArchived: true })))
      pending.catch(() => {})
      await new Promise(resolve => setTimeout(resolve, 2000))
      await measure('connect-after-exhaust', async () => { const c = await nativeConnection(config); await c.client.close() })
      await pending
      await measure('read-after-exhaust', () => connection.client.findAll(connection.tracker.class.Project, {}, { limit: 1, showArchived: true }))
      const row = { at: new Date().toISOString(), operation: 'exhaust-queries', lane: options.lane ?? 0,
        concurrency: options.concurrency ?? 1, ...(['prime-connect','connect-after-exhaust'].includes(operation) ? { overlappingWorkload: true } : {}), ms: performance.now() - started, ok: true, overlappingConnect: true, ...diff(before) }
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
