'use strict'
const stateFolder = process.env.BOARD_LOAD_STATE || `${__dirname}/state`
const resultsFolder = process.env.BOARD_LOAD_RESULTS || `${__dirname}/results`
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '../..')
const { getAccountDB, signUpByEmail } = require(`${root}/server/account/lib`)
const { MeasureMetricsContext, AccountRole } = require(`${root}/foundations/core/packages/core/lib`)
async function main() {
  const [db, close] = await getAccountDB('postgresql://root@db:26257/profile?sslmode=disable')
  try {
    const ctx = new MeasureMetricsContext('local-profile', {})
    const credentials = []
    const workspace = await db.workspace.findOne({ url: 'hulyaccessevaluation' })
    if (!workspace) throw new Error('Snapshot workspace missing')
    for (let i = 0; i < 16; i++) {
      const email = `load-${crypto.randomUUID()}@localhost.invalid`
      const password = crypto.randomBytes(32).toString('hex')
      const { account } = await signUpByEmail(ctx, db, null, email, password, 'Local', `Load ${i}`, true)
      await db.assignWorkspace(account, workspace.uuid, AccountRole.Owner)
      credentials.push({ agent: { email, password }, account })
    }
    fs.writeFileSync(`${stateFolder}/accounts.json`, JSON.stringify(credentials), { mode: 0o600 })
    credentials.forEach((entry, i) => fs.writeFileSync(`${stateFolder}/account-${i}.json`, JSON.stringify(entry), { mode: 0o600 }))
    console.log('Created 16 isolated local load accounts')
  } finally { close() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
