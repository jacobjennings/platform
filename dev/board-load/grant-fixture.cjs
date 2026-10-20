'use strict'
const stateFolder = process.env.BOARD_LOAD_STATE || `${__dirname}/state`
const resultsFolder = process.env.BOARD_LOAD_RESULTS || `${__dirname}/results`
// Local snapshot fixture setup. Membership is required even for workspace owners.
const path = require('node:path')
const fs = require('node:fs')
const root = path.resolve(__dirname, '../..')
const { getDBClient } = require(`${root}/foundations/server/packages/postgres/lib`)
async function main() {
  const db = getDBClient('postgresql://root@db:26257/profile?sslmode=disable')
  try {
    const sql = await db.getClient()
    const users = JSON.parse(fs.readFileSync(`${stateFolder}/accounts.json`))
    for (const { account } of users) {
      await sql.unsafe('UPDATE space SET members = array_append(members, $1) WHERE "workspaceId" = $2 AND NOT members @> ARRAY[$1]::text[]',
        [account, '4663bf36-78fb-4c61-b3af-93a577fe844a'])
    }
    console.log('Local fixture memberships granted')
  } finally { db.close() }
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })
