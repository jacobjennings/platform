'use strict'
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const folder = process.env.BOARD_LOAD_RESULTS || path.join(__dirname, 'results')
const { getDBClient } = require(`${root}/foundations/server/packages/postgres/lib`)
async function main() {
  const db = getDBClient('postgresql://root@db:26257/profile?sslmode=disable', undefined, 'profile-fixture')
  try {
    const sql = await db.getClient()
    const counts = await sql.unsafe(`SELECT 'issues' AS kind,count(*) AS count FROM task WHERE _class='tracker:class:Issue'
      UNION ALL SELECT 'transactions',count(*) FROM tx
      UNION ALL SELECT 'activity_rows',count(*) FROM activity
      UNION ALL SELECT 'collaborator_documents',count(*) FROM collaborator
      UNION ALL SELECT 'issues_with_description',count(*) FROM task WHERE _class='tracker:class:Issue' AND coalesce(data->>'description','')<>''
      UNION ALL SELECT 'issues_with_labels',count(DISTINCT "attachedTo") FROM tags WHERE _class='tags:class:TagReference' AND data->>'collection'='labels'
      UNION ALL SELECT 'issues_with_comments',count(DISTINCT "attachedTo") FROM activity WHERE _class='chunter:class:ChatMessage' AND data->>'collection'='comments'`)
    const projects = await sql.unsafe(`SELECT s.data->>'identifier' AS project,s.archived,count(*) AS issues
      FROM task t JOIN space s ON t.space=s._id AND t."workspaceId"=s."workspaceId"
      WHERE t._class='tracker:class:Issue' GROUP BY project,s.archived ORDER BY issues DESC`)
    const result = { at: new Date().toISOString(), counts, projects }
    fs.writeFileSync(`${folder}/fixture-scale.json`, JSON.stringify(result,null,2))
    console.log('Saved fixture scale counts')
  } finally { db.close() }
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })
