'use strict'
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const { getDBClient } = require(`${root}/foundations/server/packages/postgres/lib`)
async function main() {
  const db = getDBClient('postgresql://root@db:26257/profile?sslmode=disable')
  try {
    const sql = await db.getClient()
    await sql.unsafe(`CREATE TABLE IF NOT EXISTS profile_migration_tasks AS SELECT * FROM task
      WHERE space='a051e3b069862241f46ce80d' ORDER BY _id LIMIT 4800`)
    await sql.unsafe(`CREATE TABLE IF NOT EXISTS profile_migration_refs AS SELECT r.* FROM tags r
      WHERE r._class='tags:class:TagReference' AND r.data->>'title'='stage:closed'
      AND r.space='a051e3b069862241f46ce80d' LIMIT 1`)
    const ids = (await sql.unsafe('SELECT _id AS id FROM profile_migration_tasks ORDER BY id')).map(r => r.id)
    if (ids.length !== 4800) throw new Error(`Need 4800 migration fixture cards, have ${ids.length}`)
    if (process.argv[2] === 'reset') {
      await sql.unsafe(`DELETE FROM tags WHERE _class='tags:class:TagReference' AND data->>'title' LIKE 'stage:%'
        AND "attachedTo" IN (SELECT _id FROM profile_migration_tasks)`)
      await sql.unsafe(`INSERT INTO tags SELECT t."workspaceId", 'local-profile-stage-'||t._id, r._class,t.space,
        r."modifiedBy",r."createdBy",r."modifiedOn",r."createdOn",NULL,t._id,r.data
        FROM profile_migration_tasks t CROSS JOIN profile_migration_refs r`)
      await sql.unsafe(`UPDATE task SET data=jsonb_set(task.data, '{status}', '"aafde052fa3d7ce859336b5c"'::jsonb),
        "modifiedOn"=old."modifiedOn" FROM profile_migration_tasks old
        WHERE task._id=old._id AND task."workspaceId"=old."workspaceId"`)
    }
    fs.writeFileSync(`${__dirname}/state/migration-ids.json`, JSON.stringify(ids))
    console.log(`Migration fixture: ${ids.length} disjoint cards, 300 per lane`)
  } finally { db.close() }
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })
