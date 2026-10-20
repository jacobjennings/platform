'use strict'
// Local, untracked plan runner for JH-902491. It selects one captured statement
// per board query shape, keeps the selection in a file, and runs EXPLAIN
// ANALYZE with the exact captured parameters.
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const { getDBClient } = require(`${root}/foundations/server/packages/postgres/lib`)
const folder = process.env.BOARD_LOAD_RESULTS || path.join(__dirname, 'results')
const mode = process.argv[2] || 'select'
const selectionFile = process.env.PLAN_SELECTION || path.join(folder, 'plan-selection.json')
const outputFile = process.env.PLAN_OUTPUT || path.join(folder, `plans-${mode}.json`)

const shapes = [
  ['task-page', /FROM task WHERE .*task\."space" = \$2::text AND task\."_id" > \$3::text .*ORDER BY task\."_id" ASC LIMIT 50$/],
  ['task-count-page', /SELECT COUNT\(task\._id\).*task\."space" = \$2::text AND task\."_id" > \$3::text/],
  ['task-catchup-page', /FROM task WHERE .*task\."space" = \$2::text AND task\."modifiedOn" >= \$3::numeric .*ORDER BY task\."_id" ASC LIMIT 50$/],
  ['task-catchup-count', /SELECT COUNT\(task\._id\).*task\."space" = \$2::text AND task\."modifiedOn" >= \$3::numeric/],
  ['task-id-set', /FROM task WHERE .*task\."_id" = ANY\(\$3::text\[\]\) .*ORDER BY task\."_id" ASC LIMIT 50$/],
  ['task-space-count', /FROM task WHERE "workspaceId" = \$1::uuid GROUP BY _space/],
  ['tags-page', /FROM tags WHERE .*tags\."space" = \$2::text AND tags\.data#>>'\{collection\}' = \$3::text AND tags\."_id" > \$4::text .*ORDER BY tags\."_id" ASC LIMIT 50$/],
  ['tags-count-page', /SELECT COUNT\(tags\._id\).*tags\."space" = \$2::text AND tags\.data#>>'\{collection\}' = \$3::text AND tags\."_id" > \$4::text/],
  ['tags-catalog-page', /FROM tags WHERE .*tags\.data#>>'\{targetClass\}' = \$2::text AND tags\."_id" > \$3::text .*ORDER BY tags\."_id" ASC LIMIT 50$/],
  ['tags-catalog-count', /SELECT COUNT\(tags\._id\).*tags\.data#>>'\{targetClass\}' = \$2::text AND tags\."_id" > \$3::text/],
  ['activity-page', /FROM activity WHERE .*activity\."attachedTo" = ANY\(\$2::text\[\]\) AND activity\."_id" > \$3::text .*ORDER BY activity\."_id" ASC LIMIT 50$/],
  ['activity-count-page', /SELECT COUNT\(activity\._id\).*activity\."attachedTo" = ANY\(\$2::text\[\]\) AND activity\."_id" > \$3::text/],
  ['activity-catchup-page', /FROM activity WHERE .*activity\."attachedTo" = ANY\(\$2::text\[\]\) AND activity\."modifiedOn" >= \$3::numeric .*ORDER BY activity\."_id" ASC LIMIT 50$/],
  ['activity-catchup-count', /SELECT COUNT\(activity\._id\).*activity\."attachedTo" = ANY\(\$2::text\[\]\) AND activity\."modifiedOn" >= \$3::numeric/],
  ['activity-space-count', /FROM activity WHERE "workspaceId" = \$1::uuid GROUP BY _space/]
]

const literal = value => {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string') return "'" + value.replace(/'/g, "''") + "'"
  if (Array.isArray(value)) return 'ARRAY[' + value.map(literal).join(',') + ']'
  throw new Error('Unsupported captured SQL parameter type')
}
const expand = statement => statement.query.replace(/\$([0-9]+)/g, (_m, i) => literal(statement.parameters[Number(i) - 1]))

async function selectStatements () {
  const captured = fs.readFileSync(path.join(folder, 'sql-selects.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  const statistics = JSON.parse(fs.readFileSync(path.join(folder, 'statement-statistics-before-diagnostic.json'), 'utf8'))
  const calls = new Map(statistics.map(row => [row.query, row.calls]))
  const selected = []
  for (const [name, pattern] of shapes) {
    const matches = captured.filter(row => pattern.test(row.query))
    if (matches.length === 0) { console.log(`no capture for ${name}`); continue }
    matches.sort((a, b) => (calls.get(b.query) ?? 0) - (calls.get(a.query) ?? 0))
    selected.push({ name, query: matches[0].query, parameters: matches[0].parameters, calls: calls.get(matches[0].query) ?? 0 })
  }
  fs.writeFileSync(selectionFile, JSON.stringify(selected, null, 2))
  console.log(`saved ${selected.length} selections`)
}

async function runPlans () {
  const selected = JSON.parse(fs.readFileSync(selectionFile, 'utf8'))
  const db = getDBClient('postgresql://root@db:26257/profile?sslmode=disable', undefined, 'profile-plans')
  const output = []
  try {
    const sql = await db.getClient()
    for (const statement of selected) {
      const started = performance.now()
      const rows = await sql.unsafe('EXPLAIN ANALYZE ' + expand(statement))
      const plan = rows.map(row => Object.values(row)[0]).join('\n')
      const numbers = (pattern) => [...plan.matchAll(pattern)].map(m => Number(m[1].replaceAll(',', '')))
      const scanned = numbers(/rows decoded from KV: ([\d,]+)/g)
      const actual = numbers(/actual row count: ([\d,]+)/g)
      output.push({ name: statement.name, calls: statement.calls, query: statement.query, parameters: statement.parameters,
        elapsedMs: performance.now() - started, kvRowsDecoded: scanned.reduce((a, b) => a + b, 0),
        actualRows: actual.reduce((a, b) => a + b, 0), plan })
      console.log(`${statement.name}: calls=${statement.calls} kvRows=${scanned.reduce((a, b) => a + b, 0)} actualRows=${actual.reduce((a, b) => a + b, 0)} elapsed=${(performance.now() - started).toFixed(0)}ms`)
    }
    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2))
  } finally {
    db.close()
  }
}

if (mode === 'select') selectStatements().catch(error => { console.error(error.message); process.exitCode = 1 })
else runPlans().catch(error => { console.error(error.message); process.exitCode = 1 })
