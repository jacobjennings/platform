'use strict'
// Profiling only. Does not change request handling.
const fs = require('node:fs')
const { monitorEventLoopDelay, performance } = require('node:perf_hooks')
const histogram = monitorEventLoopDelay({ resolution: 10 })
histogram.enable()
let previousCpu = process.cpuUsage()
let previousElu = performance.eventLoopUtilization()
const folder = process.env.PROFILE_DIR
if (!folder) throw new Error('PROFILE_DIR is required')
setInterval(() => {
  let phase = 'startup'
  try { phase = fs.readFileSync(`${folder}/phase`, 'utf8').trim() } catch {}
  const cpu = process.cpuUsage()
  const elu = performance.eventLoopUtilization()
  fs.appendFileSync(`${folder}/event-loop.jsonl`, JSON.stringify({ at: new Date().toISOString(), phase,
    cpuUserUs: cpu.user - previousCpu.user, cpuSystemUs: cpu.system - previousCpu.system,
    utilization: performance.eventLoopUtilization(elu, previousElu).utilization,
    delayP50Ms: histogram.percentile(50) / 1e6, delayP95Ms: histogram.percentile(95) / 1e6,
    delayMaxMs: histogram.max / 1e6, rss: process.memoryUsage().rss }) + '\n')
  previousCpu = cpu
  previousElu = elu
  histogram.reset()
}, 1000).unref()
// Every local service has an explicit upper lifetime.
setTimeout(() => process.exit(124), 4 * 60 * 60 * 1000).unref()
const inspector = require('node:inspector')
const profiler = new inspector.Session()
profiler.connect()
const post = (method, params = {}) => new Promise((resolve, reject) => profiler.post(method, params, (e, r) => e ? reject(e) : resolve(r)))
let currentPhase
let switching = false
setInterval(async () => {
  if (switching) return
  let next
  try { next = fs.readFileSync(`${folder}/phase`, 'utf8').trim() } catch { return }
  if (next === currentPhase || !/^[a-zA-Z0-9_-]+$/.test(next)) return
  switching = true
  try {
    if (currentPhase) {
      const { profile } = await post('Profiler.stop')
      fs.writeFileSync(`${folder}/${currentPhase}.cpuprofile`, JSON.stringify(profile))
    } else {
      await post('Profiler.enable')
      await post('Profiler.setSamplingInterval', { interval: 10000 })
    }
    await post('Profiler.start')
    currentPhase = next
    fs.writeFileSync(`${folder}/phase-ready`, next)
  } catch (error) { fs.appendFileSync(`${folder}/profiler-errors.log`, error.message + '\n') }
  finally { switching = false }
}, 100).unref()
// Enabled only for a separate diagnostic pass, after baseline timing.
if (process.env.PROFILE_SQL === 'true') {
  const seen = new Set()
  globalThis.__boardProfileSql = (_connection, query, parameters) => {
    if (!/^\s*SELECT\b/i.test(query) || seen.has(query)) return
    seen.add(query)
    fs.appendFileSync(`${folder}/sql-selects.jsonl`, JSON.stringify({ query, parameters }) + '\n', { mode: 0o600 })
  }
}
