'use strict'
const fs = require('node:fs')
const path = require('node:path')
const folder = process.env.BOARD_LOAD_RESULTS || path.join(__dirname, 'results')
const root = path.resolve(__dirname, '../..')
const { getDBClient } = require(`${root}/foundations/server/packages/postgres/lib`)
async function main() {
  const db = getDBClient('postgresql://root@db:26257/profile?sslmode=disable', undefined, 'profile-diagnostics')
  try {
    const sql = await db.getClient()
    const statistics = await sql.unsafe(`SELECT metadata->>'query' AS query,
      (statistics->'statistics'->>'cnt')::INT AS calls,
      (statistics->'statistics'->'svcLat'->>'mean')::FLOAT AS mean_seconds,
      statistics, sampled_plan, index_recommendations
      FROM crdb_internal.statement_statistics WHERE app_name='transactor'
      AND metadata->>'query' LIKE 'SELECT %'
      AND metadata->>'query' NOT LIKE '%profile_%'
      ORDER BY mean_seconds DESC`)
    fs.writeFileSync(`${folder}/statement-statistics.json`, JSON.stringify(statistics, null, 2))
    if (!fs.existsSync(`${folder}/sql-selects.jsonl`)) { console.log(`Saved ${statistics.length} fingerprints`); return }
    const captured = fs.readFileSync(`${folder}/sql-selects.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    const selected = captured.filter(r => /^\s*SELECT\b/i.test(r.query) && /\bFROM\s+(?:activity|task|tags)\b/i.test(r.query))
    const plans = []
    const normalize = query => query.toUpperCase()
      .replace(/'([^']|'')*'/g, '_').replace(/\$[0-9]+/g, '_')
      .replace(/\bTEXT\b/g, 'STRING').replace(/["\s()]/g, '')
    const used = new Set()
    for (const fingerprint of statistics) {
      if (!/\bFROM\s+(activity|task|tags)\b/i.test(fingerprint.query)) continue
      const statement = selected.find(candidate => normalize(candidate.query) === normalize(fingerprint.query))
      if (!statement || used.has(statement.query)) continue
      used.add(statement.query)
      const started = performance.now()
      const plan = await sql.unsafe('EXPLAIN ANALYZE ' + statement.query, statement.parameters)
      plans.push({ fingerprint: fingerprint.query, baselineCalls: fingerprint.calls, baselineMeanSeconds: fingerprint.mean_seconds,
        query: statement.query, parameters: statement.parameters, elapsedMs: performance.now() - started, plan })
      if (plans.length === 6) break
    }
    if (!plans.length) throw new Error('No slow fingerprint matched a captured parameterized SELECT')
    fs.writeFileSync(`${folder}/explain-analyze.json`, JSON.stringify(plans, null, 2))
    console.log(`Saved ${statistics.length} fingerprints and ${plans.length} actual-parameter plans`)
  } finally { db.close() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
