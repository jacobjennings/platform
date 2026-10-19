'use strict'
const fs = require('node:fs')
const path = require('node:path')
const folder = process.env.BOARD_LOAD_RESULTS || path.join(__dirname, 'results')
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['baseline.jsonl']
const groups = new Map()
for (const file of files) {
  for (const line of fs.readFileSync(path.join(folder, file), 'utf8').trim().split('\n')) {
    if (!line) continue
    const row = JSON.parse(line)
    const key = `${row.run}|${row.operation}|${row.concurrency}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
}
const percentile = (rows, p) => rows[Math.max(0, Math.ceil(rows.length * p) - 1)]
console.log('| Run | Operation | Clients | n | p50 ms | p95 ms | Max ms | Errors | Partial | Censored |')
console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
for (const [key, rows] of groups) {
  const [run, operation, concurrency] = key.split('|')
  const times = rows.map(r => r.ms).sort((a,b) => a-b)
  console.log(`| ${run} | ${operation} | ${concurrency} | ${rows.length} | ${percentile(times,.5).toFixed(1)} | ${percentile(times,.95).toFixed(1)} | ${times.at(-1).toFixed(1)} | ${rows.filter(r => !r.ok).length} | ${rows.filter(r => r.qualityOk === false || (r.operation === 'readSupervisionBoard' && r.nonemptyDescriptions !== undefined && r.nonemptyDescriptions < 6913)).length} | ${rows.filter(r => r.censored).length} |`)
}
