'use strict'
// Exercise the real workspace-attach path on the restored snapshot.
// Measures how long createTables holds the caller, proves a second connection
// works while indexes build, and reports when the build finishes.
const path = require('node:path')
const root = '/home/jakej/gh/huly-platform-worktrees/jh-902544-backlog-c1'
const { getDBClient, createTables } = require(path.join(root, 'foundations/server/packages/postgres/lib'))

const url = 'postgresql://root@127.0.0.1:26299/attach?sslmode=disable'
const domains = process.argv.slice(2)

const ctx = {
  with: async (_name, _params, fn) => await fn(),
  error: (...a) => console.error(...a),
  warn: (...a) => console.warn(...a),
  info: (...a) => console.log(...a)
}

async function countSecondary (sql) {
  const res = await sql.unsafe(`SELECT count(*)::int AS n FROM information_schema.statistics
    WHERE table_schema = 'public' AND index_name NOT LIKE '%pkey'`)
  return res[0].n
}

async function main () {
  const db = getDBClient(url, undefined, 'attach-probe')
  const sql = await db.getClient()
  const before = await countSecondary(sql)
  console.log(JSON.stringify({ stage: 'before', secondaryIndexColumns: before }))
  const t0 = Date.now()
  await createTables(ctx, sql, url, domains)
  const attachMs = Date.now() - t0
  const atReturn = await countSecondary(sql)
  console.log(JSON.stringify({ stage: 'attach-returned', attachMs, secondaryIndexColumns: atReturn }))

  // A second client connects and reads while the build is still running. This is
  // the timeout the rig saw when the build was awaited.
  const t1 = Date.now()
  const probe = getDBClient(url, { connect_timeout: 5 }, 'attach-probe-2')
  const psql = await probe.getClient()
  const first = await psql.unsafe(`SELECT count(*)::int AS n FROM task WHERE "workspaceId" = '4663bf36-78fb-4c61-b3af-93a577fe844a'::uuid`)
  const connectMs = Date.now() - t1
  console.log(JSON.stringify({ stage: 'second-client', connectAndReadMs: connectMs, taskRows: first[0].n }))
  await probe.close()

  // Follow the build to completion.
  let last = atReturn
  let stableSince = null
  const polls = []
  for (let i = 0; i < 400; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const now = await countSecondary(sql)
    polls.push(now)
    if (now !== last) { last = now; stableSince = Date.now() }
    else if (stableSince === null) stableSince = Date.now()
    const buildMs = Date.now() - t0
    if (now > atReturn && Date.now() - stableSince > 5000) {
      console.log(JSON.stringify({ stage: 'build-finished', buildMs, secondaryIndexColumns: now, polls }))
      break
    }
    if (buildMs > 400000) {
      console.log(JSON.stringify({ stage: 'build-timeout', buildMs, secondaryIndexColumns: now, polls }))
      break
    }
  }
  await db.close()
}

main().catch((err) => { console.error(err); process.exitCode = 1 })
