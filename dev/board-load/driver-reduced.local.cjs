'use strict'
// Local, untracked reduced matrix for JH-902491. It runs the read and single-card
// write shapes at one and four clients. It leaves out migrateStageLabelsToStatus,
// which stalled on the local shared-account limiter.
const stateFolder = process.env.BOARD_LOAD_STATE || `${__dirname}/state`
const resultsFolder = process.env.BOARD_LOAD_RESULTS || `${__dirname}/results`
const fs = require('node:fs')
const path = require('node:path')
const { fork } = require('node:child_process')
const { setTimeout: sleep } = require('node:timers/promises')
const folder = resultsFolder
const output = process.argv[2] || 'before'
if (!/^[a-zA-Z0-9_-]+$/.test(output)) throw new Error('Invalid run name')
const samples = path.join(folder, `${output}.jsonl`)
const active = new Set()
async function phase(name) {
  fs.writeFileSync(path.join(folder, 'phase'), name)
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    try { if (fs.readFileSync(path.join(folder, 'phase-ready'), 'utf8') === name) return } catch {}
    await sleep(100)
  }
  throw new Error('Profiler did not acknowledge phase')
}
function launch(options) {
  const child = fork(path.join(__dirname, 'worker.cjs'), [JSON.stringify(options)], {
    stdio: ['ignore', fs.openSync(path.join(folder, `${output}-workers.log`), 'a'), fs.openSync(path.join(folder, `${output}-workers.log`), 'a'), 'ipc'] })
  active.add(child)
  child.once('exit', () => active.delete(child))
  child.queue = []
  child.on('message', row => {
    if (row.operation) fs.appendFileSync(samples, JSON.stringify({ run: output, ...row }) + '\n')
    if (row.ready || row.done) child.queue.shift()?.resolve(row)
  })
  child.on('exit', code => { for (const item of child.queue.splice(0)) item.reject(new Error(`Worker exited ${code}`)) })
  return child
}
function wait(child) { return new Promise((resolve, reject) => child.queue.push({ resolve, reject })) }
async function group(concurrency, separate = false, shared = false, accountIndex = 0, pageSize = 50) {
  const children = Array.from({ length: concurrency }, (_, lane) => launch({ lane, concurrency, separate, shared, accountIndex, pageSize }))
  await Promise.all(children.map(wait))
  return children
}
async function command(children, operation, extra = {}) {
  const waits = children.map(child => { const ready = wait(child); child.send({ operation, ...extra }); return ready })
  const results = await Promise.all(waits)
  if (results.some(row => row.fatal)) throw new Error(`${operation} fixture validation failed, see ${samples}`)
}
async function close(children) {
  await Promise.all(children.map(child => new Promise(resolve => { child.once('exit', resolve); child.send({ stop: true }) })))
}
async function main() {
  if (fs.existsSync(samples) && !process.env.BOARD_LOAD_RESUME) throw new Error('Result file already exists, choose a new run name')
  for (const concurrency of [1, 4]) {
    const children = await group(concurrency, false, false, concurrency === 1 ? 0 : 1, 50)
    const operations = concurrency === 1
      ? ['connect', 'ping', 'resolveTask', 'readProjectTasks', 'readSupervisionBoard', 'setTaskStage', 'postTaskComment']
      : ['readProjectTasks']
    for (const operation of operations) {
      const repeats = operation === 'readSupervisionBoard' ? 1 : 3
      const label = `${output}-${concurrency}-${operation}`
      await phase(label)
      console.log(new Date().toISOString(), label)
      for (let iteration = 0; iteration < repeats; iteration++) await command(children, operation, { iteration })
    }
    await close(children)
    await phase('idle')
    await sleep(31000)
  }
  await phase('idle')
}
const deadline = setTimeout(() => { for (const child of active) child.kill('SIGTERM'); process.exitCode = 124 }, 45 * 60 * 1000)
main().catch(e => { console.error(e.message); process.exitCode = 1 }).finally(() => { for (const child of active) child.kill('SIGTERM'); clearTimeout(deadline) })
