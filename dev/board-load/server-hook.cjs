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
