'use strict'
const stateFolder = process.env.BOARD_LOAD_STATE || `${__dirname}/state`
const resultsFolder = process.env.BOARD_LOAD_RESULTS || `${__dirname}/results`
const fs = require('node:fs')
const path = require('node:path')
const { fork, execFileSync } = require('node:child_process')
const { setTimeout: sleep } = require('node:timers/promises')
const folder = resultsFolder
const output = process.argv[2] || 'baseline'
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
async function group(concurrency, separate = false, shared = false) {
  const children = Array.from({ length: concurrency }, (_, lane) => launch({ lane, concurrency, separate, shared }))
  await Promise.all(children.map(wait))
  return children
}
async function command(children, operation, extra = {}) {
  const waits = children.map(child => { const ready = wait(child); child.send({ operation, ...extra }); return ready })
  const results = await Promise.all(waits)
  if (results.some(row => row.failed)) throw new Error(`${operation} failed, see ${samples}`)
}
async function close(children) {
  await Promise.all(children.map(child => new Promise(resolve => { child.once('exit', resolve); child.send({ stop: true }) })))
}
async function main() {
  if (fs.existsSync(samples)) throw new Error('Result file already exists, choose a new run name')
  if (output === 'baseline') {
    for (const concurrency of [1, 4, 8, 16]) {
      const children = await group(concurrency)
      for (const operation of ['connect', 'ping', 'resolveTask', 'readProjectTasks', 'readSupervisionBoard', 'setTaskStage', 'postTaskComment', 'migrateStageLabelsToStatus']) {
        const label = `${output}-${concurrency}-${operation}`
        if (operation === 'migrateStageLabelsToStatus') execFileSync(process.execPath, [path.join(__dirname, 'prepare-migration.cjs'), 'reset'])
        await phase(label)
        console.log(new Date().toISOString(), label)
        const repeats = ['readSupervisionBoard', 'migrateStageLabelsToStatus'].includes(operation) ? 1 : 3
        for (let iteration = 0; iteration < repeats; iteration++) await command(children, operation, { iteration })
      }
      await close(children)
      // Avoid carrying a spent account budget into the next concurrency group.
      await sleep(31000)
    }
  } else if (output.startsWith('stall')) {
    const separate = output.includes('separate')
    const children = await group(16, separate, true)
    await phase(output)
    await command(children, 'exhaust')
    await close(children)
  } else if (output.startsWith('shared')) {
    const children = await group(1, false, true)
    await phase(output)
    for (let iteration = 0; iteration < 20; iteration++) await command(children, 'ping', { iteration })
    await close(children)
  } else if (output === 'mixed') {
    const children = await group(5, false, true)
    execFileSync(process.execPath, [path.join(__dirname, 'prepare-migration.cjs'), 'reset'])
    await phase(output)
    // Five minutes, two independent launcher/sweep lanes, two health lanes and one migration.
    const schedule = [
      (async () => { for (let i = 0; i < 3; i++) { await command([children[0]], 'sweep', { project: 'JH' }); if (i < 2) await sleep(120000) } })(),
      (async () => { for (let i = 0; i < 3; i++) { await command([children[1]], 'sweep', { project: 'VK8' }); if (i < 2) await sleep(120000) } })(),
      (async () => { for (let i = 0; i < 5; i++) { await command([children[2]], 'ping'); if (i < 4) await sleep(60000) } })(),
      (async () => { for (let i = 0; i < 5; i++) { await command([children[3]], 'ping'); if (i < 4) await sleep(60000) } })(),
      command([children[4]], 'migrateStageLabelsToStatus', { mixed: true })
    ]
    await Promise.all(schedule)
    await close(children)
  } else throw new Error('Unknown scenario')
  await phase('idle')
}
const deadline = setTimeout(() => { for (const child of active) child.kill('SIGTERM'); process.exitCode = 124 }, 90 * 60 * 1000)
main().catch(e => { console.error(e.message); process.exitCode = 1 }).finally(() => { for (const child of active) child.kill('SIGTERM'); clearTimeout(deadline) })
