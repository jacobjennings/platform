'use strict'
const fs = require('node:fs')
const path = require('node:path')
const folder = process.env.BOARD_LOAD_RESULTS || path.join(__dirname, 'results')
const parse = file => fs.existsSync(path.join(folder, file)) ? fs.readFileSync(path.join(folder,file),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []
const percentile = (values, p) => {
  values = values.filter(Number.isFinite).sort((a,b) => a-b)
  return values.length ? values[Math.max(0, Math.ceil(values.length * p) - 1)] : null
}
const events = parse('event-loop.jsonl')
const result = {}
for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ['baseline','stall-shared','stall-separate','stall-raised','shared','mixed','pages50','pages1000','diagnostic']) {
  const samples = parse(`${name}.jsonl`)
  if (!samples.length) continue
  const groups = new Map()
  for (const sample of samples) {
    const key = `${sample.concurrency}:${sample.operation}`
    if (!groups.has(key)) groups.set(key,[])
    groups.get(key).push(sample)
  }
  const summary = {}
  for (const [key, rows] of groups) {
    const frames = events.filter(event => rows.some(row => Date.parse(event.at) <= Date.parse(row.at) && Date.parse(event.at) >= Date.parse(row.at) - row.ms))
    const models = rows.flatMap(row => row.model)
    summary[key] = { samples: rows.length, errors: rows.filter(row => !row.ok).length, censored: rows.filter(row => row.censored).length, partial: rows.filter(row => row.qualityOk === false || (row.operation === 'readSupervisionBoard' && row.nonemptyDescriptions !== undefined && row.nonemptyDescriptions < 6913)).length,
      p50Ms: percentile(rows.map(row => row.ms),.5), p95Ms: percentile(rows.map(row => row.ms),.95), maxMs: Math.max(...rows.map(row => row.ms)),
      medianHttp: percentile(rows.map(row => Object.values(row.http).reduce((a,b)=>a+b,0)),.5),
      medianRpc: percentile(rows.map(row => Object.values(row.rpc).reduce((a,b)=>a+b,0)),.5),
      medianCollaborator: percentile(rows.map(row => row.http.collaborator || 0),.5),
      totalRateResponses: rows.reduce((n,row)=>n+row.rateLimited,0),
      modelP50Ms: percentile(models.map(row=>row.ms),.5), modelP95Ms: percentile(models.map(row=>row.ms),.95),
      modelJsonBytes: [...new Set(models.map(row=>row.decodedJsonBytes))],
      clientPacingP50Ms: percentile(rows.map(row=>row.pacingScheduledMs),.5),
      clientPacingMaxMs: Math.max(0,...rows.map(row=>row.pacingScheduledMs || 0)),
      helloP50Ms: percentile(rows.flatMap(row=>row.hello || []).map(row=>row.ms),.5),
      descriptionsP50: percentile(rows.map(row=>row.nonemptyDescriptions),.5),
      markupErrors: rows.reduce((n,row)=>n+(row.markup?.error || 0),0),
      httpFailures: rows.reduce((n,row)=>n+(row.httpFailed || 0),0),
      eventLoopSamples: frames.length,
      meanCpuPercentOfOneCore: frames.length ? frames.reduce((n,row)=>n+(row.cpuUserUs+row.cpuSystemUs)/10000,0)/frames.length : null,
      eventLoopUtilizationP50: percentile(frames.map(row=>row.utilization),.5),
      eventLoopDelayP95Ms: percentile(frames.map(row=>row.delayP95Ms),.95),
      eventLoopDelayMaxMs: frames.length ? Math.max(...frames.map(row=>row.delayMaxMs)) : null }
  }
  result[name] = summary
}
fs.writeFileSync(path.join(folder, 'metrics-summary.json'), JSON.stringify(result,null,2))
console.log(JSON.stringify(result,null,2))
