// The native connection and object classes come from huly-copy.cjs at 14e45df8.
const fs = require('node:fs')
const net = require('node:net')
function movedIdentifier(value, file) {
  if (!file || typeof value !== 'string' || !value.includes('-')) return value
  if (!fs.existsSync(file)) return value
  const links = new Map()
  for (const entry of JSON.parse(fs.readFileSync(file, 'utf8')).entries) {
    if (links.has(entry.old_identifier) && links.get(entry.old_identifier) !== entry.new_identifier) {
      throw new Error('Conflicting project-move mapping entries')
    }
    links.set(entry.old_identifier, entry.new_identifier)
  }
  const seen = new Set()
  while (links.has(value)) {
    const mapped = links.get(value)
    // A card moved into the project it was already in gets a receipt entry that
    // maps its identifier to itself. That is not a cycle: it resolves to the
    // identifier it already has. Only a real loop of two or more refuses.
    if (mapped === value) return value
    if (seen.has(value)) throw new Error('Cyclic project-move mapping')
    seen.add(value)
    value = mapped
  }
  return value
}

const { spawn } = require('node:child_process')
const { createHash, randomUUID } = require('node:crypto')
const assert = require('node:assert/strict')

// read_retry_ms is the first wait before a read is retried on a fresh session. Each later wait doubles.
const defaults = { pageSize: 50, timeout: 120000, board_export_timeout: 600000, move_timeout: 600000, number_floor: 900000, read_retry_ms: 1000, description_pool: 0 }
// Cards per host call in a bulk card write. 25 cards at CARD_COST_MS take about 2.5 s for a repair and 7.5 s for a migration, under the launch gate's 30 s board deadline (launch/huly-launch-gate.mjs MAX_BOARD_TIMEOUT_MS).
const CARD_BATCH_SIZE = 25
// Repair is measured: 2,816 cards in 242 s on the source board, 16 Oct 2026, about 86 ms each. Migration is estimated, not measured.
const CARD_COST_MS = { repairCardKinds: 100, migrateStageLabelsToStatus: 300 }
// Pause between batches, so a launch's board read is served between them.
const CARD_BATCH_PAUSE_MS = 1000

// A whole board export runs for minutes, so it takes board_export_timeout. A move
// reads or writes one card and its whole descendant tree in a single request, so
// moveTask and its read-only planning form planMoveTask take move_timeout. Every
// other operation keeps the ordinary per-request timeout.
const MOVE_OPERATIONS = new Set(['moveTask', 'planMoveTask'])
const requestLimit = (config, operation) => {
  if (operation === 'readBoardExport') return config.board_export_timeout
  if (MOVE_OPERATIONS.has(operation)) return config.move_timeout
  return config.timeout
}

// A read call's deadline is this many of its request limits. supervision/board_process.py call_limit reserves the same two.
const READ_CALL_ATTEMPTS = 2

function attachmentFileLink(config, client, blob) {
  const workspace = encodeURIComponent(client.workspace)
  const file = encodeURIComponent(blob)
  return `${config.url.replace(/\/$/, '')}/files/${workspace}/${file}?file=${file}&workspace=${workspace}`
}

function projectSettings() {
  const { spawnSync } = require('node:child_process')
  const path = require('node:path')
  const result = spawnSync('python3', [path.join(__dirname, '../lib/harness_config.py')], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`Cannot read harness.toml: ${result.stderr}`)
  const settings = JSON.parse(result.stdout)
  // The projects a board read covers live in [supervision]. The card repair walks the same list.
  return { ...settings.board, board_projects: settings.supervision?.board_projects }
}

// Operations that change the board. A timed out write may already have taken
// effect, so retrying it could commit the same change twice. The guard reads
// this list, not a message, so the rule is mechanical. Review the list as a
// whole, because a misclassified write is the one way this change can harm.
// The read-only planning form of a move is planMoveTask, below, so a slow plan
// reads a card tree without being refused as a possible write.
const WRITE_OPERATIONS = new Set([
  'attachTaskFile',
  'createTask',
  'createProject',
  'addProjectMember',
  'moveTask',
  'archiveProject',
  'renameProject',
  'registerStageLabel',
  'registerPlainLabel',
  'allowProjectStageStatuses',
  'repairCardKinds',
  'repairMovedNumbers',
  'repairTaskStageStatus',
  'migrateStageLabelsToStatus',
  'setTaskDescription',
  'setTaskDescriptionMarkup',
  'setTaskTitle',
  'setTaskPriority',
  'setTaskLabels',
  'setTaskStage',
  'addTaskLabel',
  'setTaskAssignee',
  'clearTaskAssignee',
  'addTaskBlockedBy',
  'removeTaskBlockedBy',
  'postTaskComment',
  'postTaskCommentOnce',
  'upsertTaskComment',
])

// Every other operation is a read. A read commits nothing on the board, so a
// lost or timed out read is retried on a fresh session, after a delay, until
// its deadline.
const READ_OPERATIONS = new Set([
  'ping',
  'resolveTask',
  'taskRelations',
  'readProjectTasks',
  'readSupervisionBoard',
  'readSelectedBoard',
  'readPreparerBoard',
  'readKnowledgeBoard',
  'readLabelCatalog',
  'readStatusCatalog',
  'readStatusSetPlan',
  'readBoardExport',
  'planMoveTask',
  'readStageStatusInventory',
  'readTaskComments',
  'readTaskDescription',
  'readTaskAttachmentLinks',
  'readTaskActivity',
  'readTaskState',
  'readLandedDoc',
  'readProjectState',
  'readWriteState',
  'findTaskComment',
  'agentPersonStatus',
  'resolvePersonByEmail',
  'verifyAgentEmailPerson',
])

// Writes that have a read-back. A lost connection, or a deadline expiry, is
// answered by reading the card's end state back on a fresh session. The write
// is sent again only when that read-back shows it did not land. A write with
// no read-back key is never repeated after a lost reply: it refuses, and the
// caller reads the board first. Each write here has a branch in readBackLanded.
const READBACK_WRITES = new Set([
  'setTaskDescription',
  'setTaskTitle',
  'setTaskPriority',
  'setTaskStage',
  'setTaskLabels',
  'addTaskLabel',
  'postTaskCommentOnce',
  'postTaskComment',
  'createProject',
  'addProjectMember',
  'setTaskAssignee',
  'clearTaskAssignee',
  'addTaskBlockedBy',
  'removeTaskBlockedBy',
  'registerPlainLabel',
  'registerStageLabel',
  'upsertTaskComment',
  'setTaskDescriptionMarkup',
  'repairTaskStageStatus',
  'repairCardKinds',
  'migrateStageLabelsToStatus',
  'allowProjectStageStatuses',
  'createTask',
])
const LOST_WRITE_RISK = 'the connection was lost during this write. It may already have taken effect. ' +
  'Do not retry it. Read the card on the board first, then decide whether to reapply the change.'

// Huly's tracker priority values, by the names the board tools take. The card
// shows the same four names. Any other name is refused before a write, so a
// typo cannot land as a card with no priority.
const PRIORITY_VALUES = new Map([['Urgent', 1], ['High', 2], ['Medium', 3], ['Low', 4]])
function priorityValue(name) {
  assert(PRIORITY_VALUES.has(name), 'A priority must be one of Urgent, High, Medium or Low')
  return PRIORITY_VALUES.get(name)
}

// The social identity type of a login email. It is SocialIdType.EMAIL in the
// @hcengineering/core package at 0.7.423, the Huly client version this harness
// reads. The live board's own Huly version is not read here.
const EMAIL_SOCIAL_TYPE = 'email'

// One named check so a test can prove every exported operation is registered.
// A connect-stubbed test bypasses call() entirely, so an unregistered
// operation otherwise passes every test and fails only on a real board.
function assertRegisteredOperation(operation) {
  assert(WRITE_OPERATIONS.has(operation) || READ_OPERATIONS.has(operation),
    `Unknown board operation ${operation}`)
}

// Native cards created through this module take numbers at or above this floor.
// The low range holds Vikunja ids that a final delta run still has to copy, so
// a native card must never enter that range.
// The allocation floor is configurable for projects with imported task numbers.

// A full identifier is letters, digits and single hyphens, then -<number>,
// such as TASK-630 or OWNER-PICK-5. Its trailing number need not be the
// card's number, so a full identifier is found by the identifier alone, and
// a bare number by the number.
const FULL_IDENTIFIER = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*-\d+$/
function issueQuery(input) {
  if (FULL_IDENTIFIER.test(input)) return { whole: true, number: null, query: { identifier: input } }
  const number = Number(input)
  assert(Number.isSafeInteger(number) && number >= 0, 'A task number must be an integer')
  return { whole: false, number, query: { number } }
}

// A stable document identity derived from its parts, shaped as a UUID. Two
// calls that mean the same document name the same identity, so the store's
// refusal of a duplicate keeps a retried or concurrent write to one document.
function stableId(...parts) {
  const hex = createHash('sha256').update(parts.join('\u0000')).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

// Add a collection document once. A document already at `id`, including one a
// concurrent call created a moment earlier, counts as present.
async function addOnce(client, cls, id, add) {
  if (await client.findOne(cls, { _id: id })) return 'present'
  try {
    await add()
  } catch (error) {
    if (await client.findOne(cls, { _id: id })) return 'present'
    throw error
  }
  return 'added'
}

// setTaskLabels reads a card's label set, removes, adds, moves the status and
// reads back. Two calls on one card at once interleave those steps, and the
// card can keep two stage labels. Each call holds that card's lock from its
// read to its read-back. The lock is a Linux abstract Unix socket named by the
// card's id, so every board process on the board host sees it. The kernel frees
// the name when the holder closes it or dies, so no lock is left behind and no
// age ever decides that a holder is gone. A live holder that stalls keeps the
// lock, and a waiter refuses by name when its bounded wait ends.
const LABEL_LOCK_POLL_MS = 10
const LABEL_LOCK_NAME_BYTES = 108

// Half the request timeout. The wait stays inside the caller's limit, and the
// refusal comes before any write, so the caller may retry it.
function labelLockWait(timeout) {
  return Math.floor(timeout / 2)
}

// Bind the card's name. A name already bound means a live process holds it.
function bindLabelLock(name) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.once('listening', () => resolve(server))
    server.listen(name)
  })
}

// Take the card's lock and return its release. A live holder keeps the lock.
// A waiter retries for the bounded wait, then refuses by name before it writes.
async function lockLabels(taskId, identifier, waitMs) {
  const name = `\0jake-harness-label-${taskId}`
  assert(Buffer.byteLength(name) <= LABEL_LOCK_NAME_BYTES, 'A card id is too long for a label lock')
  const deadline = performance.now() + waitMs
  for (;;) {
    try {
      const server = await bindLabelLock(name)
      return () => { server.close() }
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error
    }
    if (performance.now() >= deadline) {
      throw new Error(`${identifier ?? taskId} label lock busy: another stage write holds this card. ` +
        'This write was refused before any change, so a retry is safe.')
    }
    await new Promise(resolve => setTimeout(resolve, LABEL_LOCK_POLL_MS))
  }
}

// Holds are Huly blocked-by relations, so a blocked label needs no Hold-until line. Writes
// refuse the retired paused label.
const retiredLabelRefusal = (subject, titles) => titles.includes('paused')
  ? `${subject} cannot take the paused label: it is retired. Use a blocked-by relation or an owner decision card.`
  : null

// Conversion and structural comparison stay here so the SSH program is self-contained.
const MARKDOWN = /(^|\n)\s*(#{1,6} |[-*] |\d+\. |\| |```)|\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]+\)/
const TAG = /<[a-zA-Z][^>]*>/

function classify(text) {
  if (!text || !text.trim()) return 'empty'
  const html = TAG.test(text)
  const markdown = MARKDOWN.test(text)
  if (html && markdown) return 'mixed'
  if (html) return 'html'
  return markdown ? 'markdown' : 'plain'
}

const asObject = markup => typeof markup === 'string' ? JSON.parse(markup) : markup

// Huly returns a comment's markup as its JSON string or as the object itself.
// A legacy comment stored as plain text stays readable as plain text.
function commentMarkdown(message, text) {
  const raw = message ?? ''
  try {
    return String(text.markupToMarkdown(asObject(raw)) ?? '').trim()
  } catch (error) {
    return (typeof raw === 'string' ? raw : JSON.stringify(raw)).trim()
  }
}

// Stored markup compares by content, because a read may give the string or the object.
function sameStoredMarkup(saved, wanted) {
  try {
    return stable(normalizeMarkup(asObject(saved))) === stable(normalizeMarkup(asObject(wanted)))
  } catch (error) {
    return false
  }
}

function stripEmptyMarks(node) {
  if (Array.isArray(node)) return node.map(stripEmptyMarks)
  if (!node || typeof node !== 'object') return node
  const copy = {}
  for (const [key, value] of Object.entries(node)) {
    if (key === 'marks' && Array.isArray(value) && value.length === 0) continue
    copy[key] = stripEmptyMarks(value)
  }
  return copy
}

function sourceToMarkup(text, lib) {
  const { htmlToMarkup, markdownToMarkup, markupToMarkdown } = lib
  const form = classify(text ?? '')
  const previous = htmlToMarkup(text ?? '')
  if (form === 'empty' || form === 'html') return { markup: previous, form, converted: false }
  let markup
  if (form === 'mixed') {
    markup = JSON.stringify(stripEmptyMarks(asObject(markdownToMarkup(markupToMarkdown(asObject(previous))))))
  } else {
    markup = JSON.stringify(stripEmptyMarks(asObject(markdownToMarkup(text))))
  }
  // Compare the parsed source with the saved document, never with literal Markdown text.
  return { markup, form, converted: true }
}

function normalizeMarkup(value) {
  if (Array.isArray(value)) return value.map(normalizeMarkup)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key, item]) => !(key === 'attrs' && item && Object.keys(item).length === 0)
        && !(['content', 'marks'].includes(key) && Array.isArray(item) && item.length === 0))
      .map(([key, item]) => [key, normalizeMarkup(item)]))
  }
  return value
}

function stable(value) {
  return JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
}

// Board status is the source of truth for done and pickup. A card is done when
// its status category is Won (Completed) or Lost (Canceled). The stage labels
// are a mirror for old readers and no longer decide done. Mirrors status_done
// in supervision/supervision_board.py.
const DONE_STATUS_CATEGORIES = new Set(['Won', 'Lost'])
const statusDone = category => DONE_STATUS_CATEGORIES.has(category)
// The short category name of a status row, such as Won or UnStarted, or null.
const statusCategoryName = category => typeof category === 'string' ? category.split(':').pop() : null
// A card's stage is its Huly status, not a label. The stage: label is retired:
// no write adds one, and no read takes its stage from one. A label write clears
// the card's legacy stage rows (clearLegacyStage), and every read that returns
// labels drops them with plainLabelRows.
const isStageTitle = title => typeof title === 'string' && title.startsWith('stage:')
const plainLabelRows = rows => rows.filter(row => !isStageTitle(row.title))
// The status set the harness uses. Each stage is a native Huly status with this
// name and category, in the Director's order: queued, implementing, Ready for
// review, review_merge, merged, deployed, then the closed statuses. implementing
// replaces running. review_merge is the review stage, and the card's assignee
// follows it. The retired names below map to their replacement, and no harness
// writer uses them. Only the Director's migration removes them from a task type.
const harnessStatusSet = [
  { name: 'queued', category: 'UnStarted' },
  { name: 'implementing', category: 'Active' },
  { name: 'Ready for review', category: 'Active' },
  { name: 'review_merge', category: 'Active' },
  { name: 'merged', category: 'Won' },
  { name: 'deployed', category: 'Won' },
  { name: 'closed', category: 'Lost' },
  { name: 'closed obsolete', category: 'Lost' },
  { name: 'closed superseded', category: 'Lost' },
  { name: 'closed by owner decision', category: 'Lost' },
]
const reviewStages = new Set(['stage:Ready for review', 'stage:review_merge'])
// The migration map: the one place a retired stage name is written. A migration moves a card on a
// retired stage to its replacement when applied. Retired stages need
// local ancestry evidence from the migration caller before they can become
// merged. Otherwise they return to review. The retirement covers only the cards
// of stage_status_projects. The statuses stay in the workspace, because other
// projects still use them.
const retiredStages = {
  'stage:running': 'stage:implementing',
  'stage:In review': 'stage:review_merge',
  'stage:review queued': 'stage:Ready for review',
  'stage:review running': 'stage:review_merge',
  'stage:train ready': 'stage:Ready for review',
  'stage:code complete': 'stage:Ready for review',
  'stage:merge queued': 'stage:Ready for review',
}

async function bounded(name, work) {
  let timer
  try {
    return await Promise.race([work(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Huly ${name} exceeded 30 seconds. A write may have taken effect. Read before retrying`)), 30000)
    })])
  } finally { clearTimeout(timer) }
}

async function nativeConnection(config) {
  const api = require(config.root + '/foundations/core/packages/api-client/lib')
  const settings = JSON.parse(fs.readFileSync(config.accounts, 'utf8'))
  const client = await api.connect(config.url, {
    email: settings.agent.email, password: settings.agent.password,
    workspace: config.workspace, connectionTimeout: 30000,
  })
  const plugin = name => require(config.root + '/plugins/' + name + '/lib').default
  const coreLib = require(config.root + '/foundations/core/packages/core/lib')
  const { htmlToMarkup } = require(config.root + '/foundations/core/packages/text/lib')
  const { markdownToMarkup, markupToMarkdown } = require(config.root + '/foundations/core/packages/text-markdown/lib')
  const { getClient: getCollaboratorClient } = require(config.root + '/foundations/core/packages/collaborator-client/lib')
  let collaborator
  return {
    client,
    // The agent account's own login email, from the accounts file above. It
    // is read by the known-answer check and is never printed or returned.
    agentEmail: settings.agent.email,
    tracker: plugin('tracker'),
    tags: plugin('tags'),
    chunter: plugin('chunter'),
    attachment: plugin('attachment'),
    contact: plugin('contact'),
    activity: plugin('activity'),
    text: { htmlToMarkup, markdownToMarkup, markupToMarkdown },
    core: coreLib,
    // File storage behind an attachment. The web app uploads with a multipart
    // POST to the same endpoint, where the storage key is the multipart file
    // name, so this connection is the board's own and needs no Vikunja write.
    files: {
      link(blob) {
        return attachmentFileLink(config, client, blob)
      },
      async upload(bytes, contentType) {
        const key = randomUUID()
        const formData = new FormData()
        formData.append('file', new Blob([bytes], { type: contentType }), key)
        const response = await bounded('file upload', () => fetch(`${config.url}/files/${client.workspace}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${client.token}` },
          body: formData,
        }))
        assert(response.ok, `Huly file upload failed with status ${response.status}`)
        const listed = await response.json()
        assert(Array.isArray(listed) && listed.length === 1 && listed[0]?.id === key,
          'Huly file upload returned no stored blob id')
        assert.equal(listed[0]?.metadata?.size, bytes.length, 'Huly stored file size differs')
        return key
      },
      async remove(blob) {
        const endpoint = `${config.url}/files/${client.workspace}/${encodeURIComponent(blob)}?file=${encodeURIComponent(blob)}&workspace=${encodeURIComponent(client.workspace)}`
        const response = await bounded('file delete', () => fetch(endpoint, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${client.token}` },
        }))
        assert(response.ok, `Huly file delete failed with status ${response.status}`)
      },
    },
    getCollaborator: async () => {
      if (!collaborator) {
        const serverConfig = await bounded('configuration', () => api.loadServerConfig(config.url))
        const access = await bounded('workspace token', () => api.getWorkspaceToken(config.url, {
          email: settings.agent.email, password: settings.agent.password,
          workspace: config.workspace, connectionTimeout: 30000,
        }, serverConfig))
        collaborator = getCollaboratorClient(access.workspaceId, access.token, serverConfig.COLLABORATOR_URL)
      }
      return collaborator
    },
  }
}

// A cursor page must keep any _id predicate the caller already set, such as a
// batched _id: { $in } fetch. The predicates combine, so the page stays inside
// the requested identities and the whole store is never pulled mid-paging.
function cursorQuery(query, cursor) {
  return cursor
    ? { ...query, _id: { ...(query._id && !Array.isArray(query._id) ? query._id : {}), $gt: cursor } }
    : query
}

// Each row must be new and must follow the rows before it in _id order. A
// repeated or unordered identity means a broken server, whatever the writes.
function takeRows(result, seen, rows) {
  for (const row of rows) {
    assert(typeof row._id === 'string' && !seen.has(row._id), 'Huly repeated or omitted a row identity')
    assert(!result.length || row._id > result.at(-1)._id, 'Huly did not order page identities')
    seen.add(row._id)
    result.push(row)
  }
}

// Walks every row that matches one query in _id order, a page at a time. A
// short or empty page ends the walk. A writer can move rows while the walk
// runs, so the caller repairs the answer (see pageAll).
async function walkRows(client, cls, query, pageSize) {
  const result = []
  const seen = new Set()
  let pageCount = 0
  for (;;) {
    const rows = await client.findAll(cls, cursorQuery(query, result.at(-1)?._id), {
      limit: pageSize, sort: { _id: 1 }, total: true, showArchived: true,
    })
    pageCount++
    assert(Array.isArray(rows) && Number.isSafeInteger(rows.total) && rows.total >= 0,
      'Huly returned an invalid page or omitted its total')
    takeRows(result, seen, rows)
    if (rows.length < pageSize) return { rows: result, pages: pageCount }
  }
}

// Reads every row that matches the query, without restarting when the board
// changes under the read. The newest row read for a card decides it:
//   1. The walk reads the matching rows in _id order.
//   2. Catch-up: the rows that changed since the read began and match now
//      replace the walk's copy with the same _id. This finds a card that
//      moved in behind the walk's cursor.
//   3. Recheck: every id the walk or the catch-up holds is read again in one
//      batched _id $in pass with the same query. A card that moved out, or
//      was removed, is absent from that pass and is dropped. A card that still
//      matches takes its newest copy.
// A read that fits one page is a single query, so that answer is already a
// snapshot and skips the repairs. A move after the recheck is left for the
// next read.
const CATCH_UP_CLOCK_MARGIN_MS = 30000
async function pageAll(client, cls, query, pageSize, options = {}) {
  if (options.strictTotal) return pageAllStrict(client, cls, query, pageSize)
  // The window starts before the read does. If this host's clock runs ahead of
  // Huly's, the margin keeps a change made just before the read from falling
  // outside the window.
  const startedAt = Date.now() - CATCH_UP_CLOCK_MARGIN_MS
  const walked = await walkRows(client, cls, query, pageSize)
  if (walked.pages === 1) return { rows: walked.rows, total: walked.rows.length, pages: 1, complete: true }
  const changed = await walkRows(client, cls, { ...query, modifiedOn: { $gte: startedAt } }, pageSize)
  const merged = new Map(walked.rows.map(row => [row._id, row]))
  for (const row of changed.rows) merged.set(row._id, row)
  const ids = [...merged.keys()].sort()
  const current = new Map()
  for (let start = 0; start < ids.length; start += 500) {
    const batch = await walkRows(client, cls, { ...query, _id: { $in: ids.slice(start, start + 500) } }, pageSize)
    for (const row of batch.rows) current.set(row._id, row)
  }
  const rows = ids.filter(id => current.has(id)).map(id => current.get(id))
  // pages counts the cursor walk, as it did before the catch-up reads.
  return { rows, total: rows.length, pages: walked.pages, complete: true }
}

// The whole-board export keeps the count check. Its per-project card lists
// must match the whole-board list (see readBoardExport), so a read that saw
// the count move has to start again rather than be repaired.
async function pageAllStrict(client, cls, query, pageSize) {
  const result = []
  const seen = new Set()
  let total
  let pageCount = 0
  for (;;) {
    const rows = await client.findAll(cls, cursorQuery(query, result.at(-1)?._id), {
      limit: pageSize, sort: { _id: 1 }, total: true, showArchived: true,
    })
    pageCount++
    assert(Array.isArray(rows) && Number.isSafeInteger(rows.total) && rows.total >= 0,
      'Huly returned an invalid page or omitted its total')
    total ??= rows.total
    assert.equal(rows.total, total - result.length, `Huly count changed during paging. Retry the read (expected ${total - result.length}, received ${rows.total})`)
    takeRows(result, seen, rows)
    assert(result.length <= total, 'Huly page exceeded its declared total')
    if (result.length === total) return { rows: result, total, pages: pageCount, complete: true }
    assert(rows.length > 0, 'Huly ended paging before its declared total')
  }
}

// Run independent async jobs through a bounded pool. The results array keeps
// the input order even though the jobs overlap, and one failing job leaves its
// own slot settled by that job's answer instead of failing the whole pool.
async function pooled(size, items, work) {
  // Zero explicitly selects the unrestricted Promise.all comparison.
  if (size === 0) return Promise.all(items.map(work))
  const results = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await work(items[index])
    }
  })
  await Promise.all(runners)
  return results
}

// One native connection cached for the lifetime of one remote process, used
// when the SSH session keeps that process alive across several operations.
// A launch gate opens several operations against the same board, and each
// fresh connection repeats the loadModel handshake that wedged on
// 2026-09-16. Sharing one connection removes the repeated handshake entirely.
let sharedConn = null
let sharedConnecting = null
// All board objects using this process's native shared connection use one
// write queue. Separate connections and separate processes have their own turns.
let sharedWriteTail = Promise.resolve()
// The emitted SSH loop sets this to a stderr logger, so each server call on
// the host is named before it is made and a stalled request shows where it
// stopped. Everywhere else it stays null and nothing is logged.
let remoteStep = null
function closeConnection(connection) {
  // Do not let a rejected or stalled close hide the original board failure.
  try { Promise.resolve(connection.client.close()).catch(() => {}) } catch {}
}
async function sharedConnection(config, connect) {
  if (sharedConn !== null) return sharedConn
  if (sharedConnecting === null) {
    sharedConnecting = bounded('connection', () => connect(config)).then(connection => {
      sharedConn = connection
      connection.retired = false
      return connection
    }).finally(() => { sharedConnecting = null })
  }
  return sharedConnecting
}
// A call counts itself on the shared connection before it uses it, so a call
// that fails cannot close the socket under the calls still running on it. A
// connection retired in the gap before the count is taken is replaced.
async function acquireShared(config, connect) {
  for (;;) {
    const connection = await sharedConnection(config, connect)
    if (!connection.retired) {
      connection.inFlight = (connection.inFlight ?? 0) + 1
      return connection
    }
  }
}
// The last call to end on a retired connection closes it. The failed call that
// retired it still holds its count until its own finally runs.
function endSharedCall(connection) {
  connection.inFlight -= 1
  if (connection.retired && connection.inFlight === 0) closeConnection(connection)
}
function retireSharedConnection(connection) {
  if (sharedConn === connection) sharedConn = null
  connection.retired = true
}

// Huly has no atomic add-to-set: PushOptions has only $push and $pull. Two
// overlapping attempts can each read the list before the other pushes, so an
// entry can read back twice. The entry is pulled, which removes every copy and
// leaves other entries alone, pushed once, and read back again. Each round
// waits a random delay, so two attempts that retry together do not repeat the
// same steps in step. No lock is taken across connections. A list that still
// does not hold exactly one copy after the last round fails with a named
// error that gives the count. Zero copies can be a snapshot between another
// writer's pull and push, so that snapshot retries within the same budget.
const CONVERGE_ROUNDS = 5
const CONVERGE_DELAY_MS = 200
async function convergeEntry(client, { cls, space, id, field, entry, pull, matches }) {
  const read = async () => {
    const saved = await client.findOne(cls, { _id: id }, { showArchived: true })
    assert(saved, `Huly ${field} read-back is missing the document`)
    const list = Array.isArray(saved[field]) ? saved[field] : []
    return { saved, count: list.filter(matches).length }
  }
  let state = await read()
  for (let round = 1; state.count !== 1; round += 1) {
    if (round > CONVERGE_ROUNDS) {
      // The name is in the message too, because a call that crosses the SSH
      // session keeps only the message.
      throw Object.assign(new Error(`HulyEntryConvergenceError: Huly ${field} still holds ${state.count} copies of one entry after ${CONVERGE_ROUNDS} rounds`),
        { name: 'HulyEntryConvergenceError', count: state.count })
    }
    await new Promise(resolve => setTimeout(resolve, Math.round(CONVERGE_DELAY_MS * (1 + Math.random()))))
    if (state.count > 1) await client.updateDoc(cls, space, id, { $pull: { [field]: pull } })
    await client.updateDoc(cls, space, id, { $push: { [field]: entry } })
    state = await read()
  }
  return state
}

// The apply flag a dry run turns off: true unless options.dryRun is true.
function applyFlag(options) {
  assert(options !== null && typeof options === 'object' && !Array.isArray(options), 'The options must be an object')
  assert(options.dryRun === undefined || typeof options.dryRun === 'boolean', 'dryRun must be true or false')
  return options.dryRun !== true
}

// The board host runs the emitted program, where REMOTE_BOARD_CODE is true. The
// move receipt named by board.move_mapping lives on the controller, so the same
// path on the board host names a different machine's file. No board host read or
// write of that path is allowed, so a host write is impossible rather than unused.
const ON_BOARD_HOST = typeof REMOTE_BOARD_CODE !== 'undefined' && REMOTE_BOARD_CODE === true
function refuseReceiptOnHost(action) {
  assert(!ON_BOARD_HOST,
    `The board host must never ${action} board.move_mapping, because the controller owns the move receipt`)
}

// The mapping file a project move writes: one entry per moved card, with the card's
// old identifier, its new identifier and its task id. A rerun skips each card it names.
function readMoveMapping(file, source, target) {
  refuseReceiptOnHost('read')
  if (!fs.existsSync(file)) return { source, target, entries: [] }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert(Array.isArray(data.entries), `The mapping file ${file} has no entries list`)
  return data
}

// Written whole to a temporary file, then renamed, so a cut write never leaves half a file.
function writeMoveMapping(file, data) {
  refuseReceiptOnHost('write')
  const temp = `${file}.tmp`
  fs.mkdirSync(require('node:path').dirname(file), { recursive: true })
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temp, file)
}

// Merge the entries the board host changed into the controller's receipt. A card
// the receipt already names keeps its entry and takes the new identifier; a card
// it does not name gets one. A self-mapping that became a real move is replaced.
function mergeReceiptEntries(receipt, changed) {
  for (const item of changed) {
    const entry = receipt.entries.find(row => row.task_id === item.task_id
      || row.old_identifier === item.old_identifier || row.new_identifier === item.old_identifier)
    if (entry) entry.new_identifier = item.new_identifier
    if (!entry || entry.old_identifier !== item.old_identifier) {
      receipt.entries.push({ old_identifier: item.old_identifier, new_identifier: item.new_identifier, task_id: item.task_id })
    }
  }
}

// The project a move, archive or rename names: one project by its identifier, or by its id.
async function projectForMove(all, tracker, key) {
  assert(typeof key === 'string' && key.length, 'A Huly project identifier is required')
  const byIdentifier = (await all(tracker.class.Project, { identifier: key })).rows
  const found = byIdentifier.length ? byIdentifier : (await all(tracker.class.Project, { _id: key })).rows
  assert.equal(found.length, 1, `Huly project ${key} is missing or ambiguous`)
  return found[0]
}

// Every doc a card's move carries with it, as { cls, row }, read down from the card
// through its comments, their replies and attachments, its attachments and its labels.
// A sub-issue is not here: it moves as a card of its own, with its own number.
async function movedDocs(all, classes, card) {
  // One batched query per class per document level, not one query per document,
  // so a card with many comments, replies, attachments and labels is read in a
  // handful of round trips instead of one query each.
  const found = []
  const seen = new Set([card._id])
  let frontier = [card._id]
  while (frontier.length) {
    const next = []
    for (const cls of classes) {
      for (const row of (await all(cls, { attachedTo: { $in: frontier } })).rows) {
        if (seen.has(row._id)) continue
        seen.add(row._id)
        found.push({ cls, row })
        next.push(row._id)
      }
    }
    frontier = next
  }
  return found
}

// The fields a move must keep, read from the board. Ids stand for the linked
// docs, so a read-back compares what is linked, not a cached identifier.
async function cardSnapshot(all, { tags, chunter, attachment }, card) {
  const ids = async (cls, collection) => (await all(cls, { attachedTo: card._id, collection })).rows.map(row => row._id).sort()
  return {
    title: card.title, description: card.description ?? null, status: card.status, priority: card.priority ?? null,
    blockedBy: (card.blockedBy ?? []).map(ref => ref._id).sort(),
    parents: (card.parents ?? []).map(ref => ref.parentId).sort(),
    attachedTo: card.attachedTo ?? null,
    labels: await ids(tags.class.TagReference, 'labels'),
    comments: await ids(chunter.class.ChatMessage, 'comments'),
    attachments: await ids(attachment.class.Attachment, 'attachments'),
  }
}

// The fields that differ between a card's snapshot before its move and after it.
// A comment added by the move is allowed; every comment that was there must stay.
function moveMismatches(before, after, expected) {
  const differs = []
  for (const field of ['title', 'description', 'priority', 'blockedBy', 'parents', 'attachedTo', 'labels', 'attachments']) {
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) differs.push(field)
  }
  if (after.status !== expected.status) differs.push('status')
  if (!before.comments.every(id => after.comments.includes(id))) differs.push('comments')
  return differs
}

async function perform(config, operation, args, connect, writeId, recheck) {
  let readOnlyCreate = false
  if (operation === 'planMoveTask') {
    // The planning form of a move reads the card, its descendants and their
    // documents, and writes nothing. The transport classifies it as a read, so a
    // timed-out plan is retried like any other read and never takes the write
    // refusal. It shares one moveTask implementation with apply false, the way
    // readWriteState below shares a write's planning path.
    const [source, target, taskId] = args
    operation = 'moveTask'
    args = [source, target, taskId, false]
  }
  if (operation === 'readWriteState') {
    // Only the existing planning paths can be reached through this read.
    // Counts describe the current snapshot, never the lost attempt's work.
    const [write, originalArgs, originalWriteId] = args
    assert(['repairCardKinds', 'migrateStageLabelsToStatus', 'allowProjectStageStatuses', 'createTask'].includes(write),
      'No read-only write-state probe for this operation')
    operation = write
    readOnlyCreate = write === 'createTask'
    args = readOnlyCreate ? originalArgs : [false, ...originalArgs.slice(1)]
    if (readOnlyCreate) writeId = originalWriteId
  }
  const renew = async phase => { if (recheck) await recheck(`Huly ${operation}: ${phase}`) }
  let connection
  if (config.shared === true) connection = await acquireShared(config, connect ?? nativeConnection)
  else connection = await bounded('connection', () => connect(config))
  const { tracker, tags, chunter, attachment, text, core, contact, activity, files } = connection
  const client = new Proxy(connection.client, { get(target, key) {
    const value = target[key]
    if (typeof value !== 'function') return value
    if (key === 'close') return (...args) => bounded(String(key), () => value.apply(target, args))
    return async (...args) => {
      if (remoteStep) remoteStep(config.requestTag, operation, `client.${String(key)}`)
      await renew(`before client.${String(key)}`)
      const answer = await bounded(String(key), () => value.apply(target, args))
      await renew(`after client.${String(key)}`)
      return answer
    }
  } })
  const all = (cls, query) => pageAll(client, cls, query, config.pageSize)
  // The board's own status catalog is the single stage-to-status table. A
  // registered stage has the same name as its status, with the stage: prefix
  // on the label, so no project names a mapping of its own.
  const stageStatusTable = async () => {
    const table = new Map()
    for (const status of (await all(tracker.class.IssueStatus, {})).rows) {
      const key = `stage:${status.name}`
      table.set(key, table.has(key) ? null : status)
    }
    return table
  }
  // The project ids of stage_status_projects, or of the configured board project when unset.
  // A list that matches no project refuses.
  const stageScopeSpaces = async () => {
    const scope = config.stage_status_projects ?? [config.project_identifier]
    assert(Array.isArray(scope) && scope.length > 0 && scope.every(identifier => typeof identifier === 'string' && identifier),
      'stage_status_projects must be a nonempty list of project identifiers')
    const projects = (await all(tracker.class.Project, {})).rows
    for (const identifier of scope) {
      assert.equal(projects.filter(project => project.identifier === identifier).length, 1,
        `Covered project ${identifier} is missing or ambiguous`)
    }
    const spaces = new Set(projects.filter(project => scope.includes(project.identifier)).map(project => project._id))
    return spaces
  }
  // A retired stage is refused on a card in stage_status_projects. Other projects keep it.
  const refuseRetiredStage = async (stage, space) => {
    if (!Object.hasOwn(retiredStages, stage)) return
    assert(typeof space === 'string' && space.length, 'The card project is required to check a retired stage')
    assert(!(await stageScopeSpaces()).has(space), `The stage ${stage} is retired`)
  }
  // The Huly web client resets a card whose status its task type does not list to
  // the type's first status, as soon as the card is drawn. So a write of such a
  // status is refused before it is made, and the refusal names both.
  const refuseStatusOutsideType = async (status, issue) => {
    const type = (await all('task:class:TaskType', {})).rows.find(row => row._id === issue.kind)
    assert(type, `Huly card ${issue.identifier} has no task type on its kind, so ${status.name} cannot be written`)
    assert((type.statuses ?? []).includes(status._id),
      `Huly status ${status.name} is not in task type ${type._id} of card ${issue.identifier}. Allow it with allowProjectStageStatuses before the write`)
  }
  // The one task type a project's cards take: the type whose parent is the
  // project's type. Zero or several refuses, so no card takes a guessed kind.
  const ownTaskType = async project => {
    assert(typeof project.type === 'string' && project.type.length, `Huly project ${project.identifier} has no type`)
    const types = (await all('task:class:TaskType', {})).rows.filter(row => row.parent === project.type)
    assert.equal(types.length, 1, `Huly project ${project.identifier} must have exactly one task type of its own, found ${types.length}`)
    return types[0]
  }
  // One card's stage and status facts, for the inventory read and the status
  // repair. The repair refuses unless its before-state equals this exactly.
  const stageStatusDetails = (issue, references, table, messages) => {
    const titles = references.map(row => row.title).sort()
    const stages = titles.filter(title => title.startsWith('stage:'))
    const expected = stages.length === 1 ? table.get(stages[0]) : null
    const current = [...table.values()].find(row => row?._id === issue.status)
    const changes = messages.filter(row => row.attributeUpdates?.attrKey === 'status')
      .sort((a, b) => (b.createdOn ?? b.modifiedOn) - (a.createdOn ?? a.modifiedOn))
    const last = changes[0]
    return {
      taskId: issue._id, identifier: issue.identifier, labels: titles,
      stage: stages.length === 1 ? stages[0] : null,
      status: issue.status ?? null, statusName: current?.name ?? null,
      expectedStatus: expected?._id ?? null, expectedStatusName: expected?.name ?? null,
      lastStatusAccount: last ? (last.createdBy ?? last.modifiedBy ?? null) : (issue.createdBy ?? null),
      statusEvidence: last ? { id: last._id, time: last.createdOn ?? last.modifiedOn, source: 'status activity' }
        : { source: 'issue creation', time: issue.createdOn ?? null },
      assignee: issue.assignee ?? null,
      mismatch: stages.length > 0 && (!expected || issue.status !== expected._id),
    }
  }
  const applyStageAssignee = async (task, titles, alreadyLocked = false) => {
    const taskId = task._id
    const release = alreadyLocked ? () => {} : await lockLabels(taskId, task.identifier, labelLockWait(config.timeout))
    try {
      // An additive writer can have lost its stage race. Use the current labels
      // under the card lock so its assignee never follows an obsolete snapshot.
      if (!alreadyLocked) titles = (await labels(taskId)).map(row => row.title)
      if (titles.includes('owner-decision')) return
      // The stage a caller just set is in titles. Otherwise the card's status is the stage.
      const stage = await stageOfStatus((await client.findOne(tracker.class.Issue, { _id: taskId }, { showArchived: true }))?.status)
      let assignee
      if (stage === 'stage:queued') assignee = null
      else if (stage === 'stage:implementing' || reviewStages.has(stage)) {
        if (!config.agent_account) return
        const person = await client.findOne(contact.class.Person, { personUuid: config.agent_account }, { showArchived: true })
        assert(person, 'No contact person document resolves from the account uuid')
        assignee = person._id
      } else return
      const before = await client.findOne(tracker.class.Issue, { _id: taskId }, { showArchived: true })
      if ((before?.assignee ?? null) !== assignee) {
        await client.updateDoc(tracker.class.Issue, task.space, taskId, { assignee })
      }
      const saved = await client.findOne(tracker.class.Issue, { _id: taskId }, { showArchived: true })
      assert(saved && (saved.assignee ?? null) === assignee, 'Huly assignee read-back differs')
    } finally { release() }
  }
  const statusForLabels = async (titles, space) => {
    const stages = titles.filter(isStageTitle)
    assert(stages.length <= 1, 'Only one stage label is allowed')
    if (!stages.length) return null
    const status = (await stageStatusTable()).get(stages[0])
    assert(status, `Huly status is unknown or ambiguous for ${stages[0]}`)
    await refuseRetiredStage(stages[0], space)
    return status
  }
  // The stage of a card is the stage: name of its status. Null when the status
  // is missing, so a card with no status has no stage.
  const stageOfStatus = async statusId => {
    const status = await client.findOne(tracker.class.IssueStatus, { _id: statusId }, { showArchived: true })
    return status?.name ? `stage:${status.name}` : null
  }
  const labels = async id => (await all(tags.class.TagReference, { attachedTo: id, collection: 'labels' })).rows
  // A label write clears the card's legacy stage label. Otherwise a stale stage
  // label would outlive a status write, and the stage migration would move the
  // card back to it.
  const clearLegacyStage = async taskId => {
    for (const row of (await labels(taskId)).filter(row => isStageTitle(row.title))) {
      await client.removeCollection(tags.class.TagReference, row.space, row._id, taskId, tracker.class.Issue, 'labels')
    }
    assert.equal((await labels(taskId)).filter(row => isStageTitle(row.title)).length, 0,
      'Legacy stage label removal read-back differs')
  }
  async function writeDescription(task, markup) {
    const collabId = core.makeCollabId(tracker.class.Issue, task._id, 'description')
    if (!task.description || task.description.startsWith('{')) {
      const reference = await client.uploadMarkup(tracker.class.Issue, task._id, 'description', markup, 'markup')
      assert(typeof reference === 'string' && reference && !reference.startsWith('{'),
        'Huly returned no storage reference for the description upload')
      await client.updateDoc(tracker.class.Issue, task.space, task._id, { description: reference })
    }
    const collaborator = await connection.getCollaborator()
    await renew('before collaborator update')
    await bounded('description update', () => collaborator.updateMarkup(collabId, markup))
    await renew('after collaborator update')
    const savedTask = await client.findOne(tracker.class.Issue, { _id: task._id }, { showArchived: true })
    assert(savedTask?.description, 'Huly description reference is missing after write')
    const saved = await client.fetchMarkup(tracker.class.Issue, task._id, 'description', savedTask.description, 'markup')
    assert.equal(stable(normalizeMarkup(asObject(saved))), stable(normalizeMarkup(asObject(markup))),
      'Huly description read-back differs')
    return savedTask.description
  }
  // The contact persons that carry a login address. A contact channel and an
  // email social identity both carry it, because a Huly login is a social
  // identity on the person. A deleted identity, or one attached to something
  // other than a person, is no match. One person that both carry counts once.
  const personsWithEmail = async address => {
    const channels = (await all(contact.class.Channel, { value: address })).rows
    const identities = (await all(contact.class.SocialIdentity, { type: EMAIL_SOCIAL_TYPE, value: address })).rows
      .filter(identity => identity.isDeleted !== true)
    const people = new Map()
    for (const carrier of [...channels, ...identities]) {
      const person = await client.findOne(contact.class.Person, { _id: carrier.attachedTo }, { showArchived: true })
      if (person) people.set(person._id, person)
    }
    return [...people.values()]
  }
  try {
    if (operation === 'readStageStatusInventory') {
      assert.equal(args.length, 0, 'A stage status inventory read takes no arguments')
      const issues = await all(tracker.class.Issue, {})
      const references = (await all(tags.class.TagReference, { collection: 'labels' })).rows
      const messages = (await all(activity.class.DocUpdateMessage, {})).rows
      const table = await stageStatusTable()
      return { total: issues.total, pages: issues.pages,
        tasks: issues.rows.map(issue => stageStatusDetails(issue,
          references.filter(row => row.attachedTo === issue._id), table,
          messages.filter(row => row.attachedTo === issue._id))), verified: true }
    }
    if (operation === 'migrateStageLabelsToStatus') {
      // One-time move from the retired stage labels to the status. Each card
      // with a stage label gets that stage's status, then loses its stage
      // labels. A dry run is the default and writes nothing. apply true
      // writes. A card whose stage cannot be resolved is reported as blocked
      // and left as it is.
      assert(args.length <= 3 && (args.length === 0 || typeof args[0] === 'boolean'),
        'A stage migration takes an apply flag, optional merged identifiers and an optional list of card ids')
      const merged = args[1] ?? []
      assert(Array.isArray(merged) && merged.every(id => typeof id === 'string' && FULL_IDENTIFIER.test(id)),
        'Merged identifiers must be verified against local origin/main by the migration caller')
      const ids = args[2]
      assert(ids === undefined || (Array.isArray(ids) && ids.length > 0 && ids.every(id => typeof id === 'string' && id.length > 0)),
        'A stage migration takes an optional nonempty list of card ids after the merged identifiers')
      const apply = args[0] === true
      // The migration covers stage_status_projects, or the configured board project when unset.
      // It writes only the cards' statuses and labels. It writes no task type, no project and no status.
      const spaces = await stageScopeSpaces()
      const issues = (await all(tracker.class.Issue, ids === undefined ? {} : { _id: { $in: ids } })).rows.filter(row => spaces.has(row.space))
      const references = (await all(tags.class.TagReference, ids === undefined
        ? { collection: 'labels' } : { collection: 'labels', attachedTo: { $in: ids } })).rows
      const table = await stageStatusTable()
      const stageRefsByCard = new Map()
      for (const row of references) {
        if (!isStageTitle(row.title)) continue
        stageRefsByCard.set(row.attachedTo, [...(stageRefsByCard.get(row.attachedTo) ?? []), row])
      }
      const cards = []
      for (const issue of issues) {
        const stageRefs = stageRefsByCard.get(issue._id)
        const nativeStage = [...table].find(([, row]) => row?._id === issue.status)?.[0]
        if (!stageRefs && !Object.hasOwn(retiredStages, nativeStage ?? '')) continue
        const titles = stageRefs ? [...new Set(stageRefs.map(row => row.title))] : [nativeStage]
        // A retired stage moves to its replacement. One with no replacement stays blocked.
        const retiredTitle = titles.length === 1 && Object.hasOwn(retiredStages, titles[0])
        const wanted = titles.length === 1 ? (retiredTitle && merged.includes(issue.identifier)
          ? 'stage:merged' : retiredTitle ? retiredStages[titles[0]] : titles[0]) : null
        const target = wanted ? table.get(wanted) : null
        const card = { identifier: issue.identifier, taskId: issue._id, stage: titles.join(', '), from: issue.status ?? null, to: target?._id ?? null }
        if (titles.length > 1) {
          card.state = 'blocked'
          card.reason = 'The card carries more than one stage label'
        } else if (retiredTitle && !wanted) {
          card.state = 'blocked'
          card.reason = `The stage ${titles[0]} is retired and has no replacement`
        } else if (!target) {
          card.state = 'blocked'
          card.reason = `Huly status is unknown or ambiguous for ${wanted ?? titles[0]}`
        } else {
          card.state = apply ? 'applied' : 'planned'
          card.statusChange = issue.status !== target._id
        }
        cards.push(card)
      }
      if (apply) {
        for (const card of cards.filter(row => row.state === 'applied')) {
          const issue = issues.find(row => row._id === card.taskId)
          const unlock = await lockLabels(issue._id, issue.identifier, labelLockWait(config.timeout))
          try {
            const fresh = await client.findOne(tracker.class.Issue, { _id: issue._id }, { showArchived: true })
            const currentRefs = (await labels(issue._id)).filter(row => isStageTitle(row.title))
            const expectedRefs = stageRefsByCard.get(issue._id) ?? []
            const signature = refs => refs.map(row => [row._id, row.tag, row.title, row.space]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))
            if (!fresh || fresh.space !== issue.space || (fresh.status ?? null) !== card.from
                || JSON.stringify(signature(currentRefs)) !== JSON.stringify(signature(expectedRefs))) {
              card.state = 'blocked'
              card.reason = 'The card changed after the migration plan was read'
              card.statusChange = false
              continue
            }
            if (card.statusChange) await client.updateDoc(tracker.class.Issue, fresh.space, fresh._id, { status: card.to })
            const saved = await client.findOne(tracker.class.Issue, { _id: fresh._id }, { showArchived: true })
            assert.equal(saved?.status, card.to, `Huly status read-back differs for ${issue.identifier}`)
            for (const row of currentRefs) {
              await client.removeCollection(tags.class.TagReference, row.space, row._id, fresh._id, tracker.class.Issue, 'labels')
            }
            const left = (await labels(fresh._id)).filter(row => isStageTitle(row.title))
            assert.equal(left.length, 0, `Stage labels remain on ${issue.identifier} after the migration`)
          } finally { unlock() }
        }
      }
      // The headline counts come first: cards whose status changes, then cards
      // that only lose their stage labels. A blocked card is counted in blocked
      // only, because the migration writes nothing on it. planned and applied
      // follow the two headline counts.
      return {
        apply,
        statusChanges: cards.filter(row => row.statusChange).length,
        labelRemovals: cards.filter(row => row.state !== 'blocked' && row.statusChange === false).length,
        planned: cards.filter(row => row.state === 'planned').length,
        applied: cards.filter(row => row.state === 'applied').length,
        blocked: cards.filter(row => row.state === 'blocked').length,
        cards,
        verified: true,
      }
    }
    if (operation === 'readStatusCatalog') {
      return (await all(tracker.class.IssueStatus, {})).rows.map(row => ({
        id: row._id, name: row.name, category: statusCategoryName(row.category),
      }))
    }
    if (operation === 'readStatusSetPlan') {
      // Reads each status of the harness set and its category, so a caller can
      // check the set before and after registering the missing statuses. A status
      // is ok when exactly one status has its name and that status has its category.
      // Retired stages are listed with whether a status of that name still exists,
      // and how many cards of stage_status_projects sit on it. Only such a card
      // makes the plan not ok. The read writes nothing.
      assert.equal(args.length, 0, 'A status set plan read takes no arguments')
      const statuses = (await all(tracker.class.IssueStatus, {})).rows
      const planned = harnessStatusSet.map(target => {
        const found = statuses.filter(row => row.name === target.name)
        const status = found.length === 1 ? found[0] : null
        const category = statusCategoryName(status?.category)
        return { name: target.name, category: target.category, id: status?._id ?? null, readCategory: category,
          ok: category === target.category, count: found.length }
      })
      const spaces = await stageScopeSpaces()
      const cards = (await all(tracker.class.Issue, {})).rows.filter(row => spaces.has(row.space))
      const retired = Object.keys(retiredStages).map(stage => {
        const ids = statuses.filter(row => row.name === stage.slice('stage:'.length)).map(row => row._id)
        return { stage, replacement: retiredStages[stage], present: ids.length > 0, cards: cards.filter(row => ids.includes(row.status)).length }
      })
      // A harness stage missing from a covered project's own task type is the case the web client
      // undoes, so each type lists the harness statuses it lacks. The standing check reads this.
      const types = []
      for (const project of (await all(tracker.class.Project, {})).rows.filter(row => spaces.has(row._id))) {
        const type = await ownTaskType(project)
        const missing = planned.filter(row => row.id === null || !(type.statuses ?? []).includes(row.id)).map(row => row.name)
        types.push({ project: project.identifier, type: type._id, missing })
      }
      return { statuses: planned, retired, types, ok: planned.every(row => row.ok) && !retired.some(row => row.cards > 0)
        && types.every(row => row.missing.length === 0), verified: true }
    }
    if (operation === 'allowProjectStageStatuses') {
      // Allows only the harness stage statuses, on the harness card type: the own
      // task type of each covered project. No other status or type is changed.
      // apply false reads the answer only.
      const apply = args[0] !== false
      // [board] stage_status_projects names the covered projects. Unset, only the configured
      // board project is covered, so no other project is touched until the list names it.
      // A named list that matches no project refuses.
      const spaces = await stageScopeSpaces()
      const projects = (await all(tracker.class.Project, {})).rows.filter(project => spaces.has(project._id))
      const types = (await all('task:class:TaskType', {})).rows
      const table = await stageStatusTable()
      const required = harnessStatusSet.map(target => {
        const status = table.get(`stage:${target.name}`)
        assert(status, `Huly status is unknown or ambiguous for stage:${target.name}`)
        return status._id
      })
      const before = new Map(types.map(type => [type._id, [...type.statuses]]))
      const results = []
      for (const project of projects) {
        const type = await ownTaskType(project)
        const expected = [...new Set([...before.get(type._id), ...required])]
        if (apply) await client.updateDoc(type._class, type.space, type._id, { statuses: expected })
        const saved = await client.findOne(type._class, { _id: type._id }, { showArchived: true })
        if (apply) assert.deepEqual(saved?.statuses, expected, 'Allowed status list read-back differs')
        results.push({ project: project._id, identifier: project.identifier,
          lists: [{ kind: type._id, before: before.get(type._id), after: [...saved.statuses] }] })
      }
      return { observedAt: new Date().toISOString(), required, projects: results, verified: true }
    }
    if (operation === 'repairCardKinds') {
      // Moves each card filed under a kind other than its project's own task
      // type. A dry run, the default, lists the cards and writes nothing. apply
      // true moves each card whose status the own type allows and reads the
      // kind back. It skips, and never forces, a card with another status. A
      // read-back that differs stops the run at that card.
      //
      // A status name as the second argument repairs the cards that have no
      // status instead. Each gets its kind and that status in one update. The
      // name must be the one status of the own type of each covered project that
      // has such a card, or the run refuses before any write. Cards that have a
      // status are not listed and not changed in this form.
      assert(args.length <= 3 && (args.length === 0 || typeof args[0] === 'boolean'),
        'repairCardKinds takes one optional boolean, apply, an optional status name and an optional list of card ids')
      const statusName = args[1] ?? undefined
      assert(statusName === undefined || (typeof statusName === 'string' && statusName.length > 0),
        'repairCardKinds takes an optional status name after apply')
      const ids = args[2]
      assert(ids === undefined || (Array.isArray(ids) && ids.length > 0 && ids.every(id => typeof id === 'string' && id.length > 0)),
        'repairCardKinds takes an optional nonempty list of card ids after the status name')
      const apply = args[0] === true
      const statuses = (await all(tracker.class.IssueStatus, {})).rows
      const names = new Map(statuses.map(row => [row._id, row.name]))
      const projectIds = config.board_projects ?? [config.project_identifier]
      const projectNamed = async identifier => {
        const matches = (await all(tracker.class.Project, { identifier })).rows
        assert.equal(matches.length, 1, `Huly project ${identifier} is missing or ambiguous`)
        return matches[0]
      }
      // The one status of a project's own type that has the given name. Zero or
      // several refuses, so no card takes a guessed status.
      const ownStatus = (target, identifier) => {
        const found = statuses.filter(row => row.name === statusName && (target.statuses ?? []).includes(row._id))
        assert.equal(found.length, 1, `Huly status ${statusName} must be exactly one status of the own task type of ${identifier}, found ${found.length}`)
        return found[0]
      }
      // Every refusal is decided here, before the first write. A status name is
      // needed only in a project that has a misfiled card with no status.
      const plans = []
      for (const identifier of projectIds) {
        const project = await projectNamed(identifier)
        const target = await ownTaskType(project)
        const query = ids === undefined ? { space: project._id } : { space: project._id, _id: { $in: ids } }
        const issues = (await all(tracker.class.Issue, query)).rows.filter(row => row.kind !== target._id)
        const give = statusName !== undefined && issues.some(row => !row.status) ? ownStatus(target, identifier) : null
        plans.push({ project, identifier, target, issues, give })
      }
      const projects = []
      const moved = []
      const skipped = []
      for (const { project, identifier, target, issues, give } of plans) {
        const allowed = new Set(target.statuses ?? [])
        const cards = []
        for (const issue of issues.filter(row => statusName === undefined || !row.status)) {
          const card = {
            taskId: issue._id, identifier: issue.identifier, kind: issue.kind ?? null, targetKind: target._id,
            status: issue.status ?? null, statusName: names.get(issue.status) ?? null,
            statusAllowed: statusName !== undefined || allowed.has(issue.status), setStatus: give?.name ?? null,
          }
          cards.push(card)
          if (!card.statusAllowed) { skipped.push(card); continue }
          if (!apply) continue
          await client.updateDoc(tracker.class.Issue, issue.space, issue._id,
            give ? { kind: target._id, status: give._id } : { kind: target._id })
          const saved = await client.findOne(tracker.class.Issue, { _id: issue._id }, { showArchived: true })
          assert.equal(saved?.kind, target._id, `Huly card ${issue.identifier} kind read-back differs`)
          if (give) assert.equal(saved?.status, give._id, `Huly card ${issue.identifier} status read-back differs`)
          moved.push(card)
        }
        projects.push({ project: project._id, identifier, targetKind: target._id, cards })
      }
      return { apply, setStatus: statusName ?? null, projects, misfiled: projects.reduce((sum, row) => sum + row.cards.length, 0),
        moved: moved.map(card => card.taskId), skipped: skipped.map(card => card.taskId), verified: true }
    }
    if (operation === 'readBoardExport') {
      // The whole board as one document: native fields, the description as
      // stored markup and as readable text, and comments with readable text.
      // A stored description that cannot be converted keeps its markup and
      // names the failure. A transport failure refuses the whole export.
      assert.equal(args.length, 0, 'A board export takes no arguments')
      const deadline = Date.now() + config.board_export_timeout
      let lastCountError
      let timer
      let stopped = false
      const expired = () => lastCountError ?? new Error('Huly board export exceeded board_export_timeout')
      // Counts are per exported class and cursor predicate, never workspace-wide.
      // Session and activity documents are not among these exported classes.
      const exportClient = { findAll: async (...query) => {
        if (stopped || Date.now() >= deadline) throw expired()
        return client.findAll(...query)
      } }
      // The export keeps the strict count check, so a count that moves restarts it below.
      const exportAll = (cls, query) => pageAll(exportClient, cls, query, config.pageSize, { strictTotal: true })
      const exportOnce = async () => {
        const result = { schemaVersion: 1 }
        const catalog = {
          projects: tracker.class.Project, cards: tracker.class.Issue,
          stages: tracker.class.IssueStatus, labels: tags.class.TagElement,
          labelReferences: tags.class.TagReference, comments: chunter.class.ChatMessage,
        }
        for (const [name, cls] of Object.entries(catalog)) result[name] = (await exportAll(cls, {})).rows
        const projectIds = new Set(result.projects.map(row => row._id))
        const cardsByProject = []
        for (const project of result.projects) cardsByProject.push(...(await exportAll(tracker.class.Issue, { space: project._id })).rows)
        assert.deepEqual(cardsByProject.map(row => row._id).sort(), result.cards.map(row => row._id).sort(),
          'The project card lists differ from the whole board')
        for (const card of result.cards) {
          assert(projectIds.has(card.space), 'A card has no exported project')
          card.descriptionMarkdown = ''
          if (!card.description) continue
          let markup
          try {
            markup = await client.fetchMarkup(tracker.class.Issue, card._id, 'description', card.description, 'markup')
          } catch (error) {
            throw new Error(`Cannot export description for ${card.identifier || card._id}: ${error.message}`)
          }
          assert.equal(typeof markup, 'string', 'Huly returned non-text description markup')
          card.descriptionMarkup = markup
          try {
            card.descriptionMarkdown = String(text.markupToMarkdown(JSON.parse(markup)) ?? '')
          } catch {
            delete card.descriptionMarkdown
            card.descriptionReadError = 'The stored markup could not be converted to readable text.'
          }
        }
        for (const comment of result.comments) {
          try { comment.markdown = String(text.markupToMarkdown(JSON.parse(comment.message)) ?? '') }
          catch { comment.markdown = comment.message ?? '' }
        }
        return result
      }
      try {
        return await Promise.race([
          (async () => {
            for (;;) {
              if (stopped || Date.now() >= deadline) throw expired()
              try { return await exportOnce() }
              catch (error) {
                if (!/Huly count changed during paging/.test(error.message)) throw error
                lastCountError = error
                const remaining = deadline - Date.now()
                if (stopped || remaining <= 0) throw lastCountError
                await new Promise(resolve => setTimeout(resolve, Math.min(100, remaining)))
              }
            }
          })(),
          new Promise((_, reject) => {
            timer = setTimeout(() => { stopped = true; reject(expired()) }, Math.max(0, deadline - Date.now()))
          }),
        ])
      } finally { stopped = true; clearTimeout(timer) }

    }
    if (operation === 'readLandedDoc') {
      // Whether a document exists at a write's own id. A keyed retry of a write
      // that made its document under that id checks this before it sends again.
      const [kind, id] = args
      const cls = { comment: chunter.class.ChatMessage, label: tags.class.TagElement,
        status: tracker.class.IssueStatus }[kind]
      assert(cls, 'A landed document kind must be comment, label or status')
      assert(typeof id === 'string' && id.length, 'A write id is required')
      const doc = await client.findOne(cls, { _id: id }, { showArchived: true })
      return { kind, id, present: doc !== undefined, message: doc?.message ?? null, verified: true }
    }
    if (operation === 'readProjectState') {
      // A project as the board holds it now, with the member state of one
      // account uuid when one is asked for. A keyed retry of a project write
      // reads this before it sends the write again.
      const [identifier, accountUuid = null] = args
      assert(typeof identifier === 'string' && identifier.length, 'A Huly project identifier is required')
      const projects = (await all(tracker.class.Project, { identifier })).rows
      assert(projects.length <= 1, 'Huly project identifier is ambiguous')
      const project = projects[0] ?? null
      const person = accountUuid === null ? null
        : await client.findOne(contact.class.Person, { personUuid: accountUuid }, { showArchived: true })
      const members = Array.isArray(project?.members) ? project.members : []
      return { identifier, exists: project !== null, project: project?._id ?? null, name: project?.name ?? null,
        person: person?._id ?? null, member: project && person ? members.includes(person._id) : null,
        members: members.length, verified: true }
    }
    if (operation === 'readLabelCatalog') {
      assert.equal(args.length, 0, 'A label catalog read takes no arguments')
      return (await all(tags.class.TagElement, { targetClass: tracker.class.Issue })).rows
        .map(row => ({ id: row._id, title: row.title }))
    }
    if (operation === 'readProjectTasks') {
      const [projectKey] = args
      assert(typeof projectKey === 'string' && projectKey.length, 'A Huly project id is required')
      const found = await client.findOne(tracker.class.Project, { _id: projectKey }, { showArchived: true })
        ?? await client.findOne(tracker.class.Project, { identifier: projectKey }, { showArchived: true })
      assert(found, 'Huly project does not exist')
      const project = found._id
      const result = await all(tracker.class.Issue, { space: project })
      const references = (await all(tags.class.TagReference, { space: project, collection: 'labels' })).rows
      const statuses = new Map((await all(tracker.class.IssueStatus, {})).rows.map(row => [row._id, row]))
      for (const row of result.rows) {
        row.labels = plainLabelRows(references.filter(r => r.attachedTo === row._id)).map(r => ({ id: r.tag, title: r.title }))
        row.stage = statuses.get(row.status)?.name ? `stage:${statuses.get(row.status).name}` : null
        row.status_category = statusCategoryName(statuses.get(row.status)?.category)
        row.done = statusDone(row.status_category)
      }
      return result
    }
    if (operation === 'readKnowledgeBoard') {
      // Everything the knowledge search indexes from the board, in one round
      // trip: the named projects (every board project when none are named),
      // every card of those projects, each card's description as Markdown and
      // its comment text. A description reference with no collaborative
      // document behind it is an ordinary state, so the card keeps its title
      // and comments and the failure is named in unreadableDescriptions.
      const options = args[0] ?? {}
      assert(options === null || (typeof options === 'object' && !Array.isArray(options)),
        'readKnowledgeBoard options must be an object')
      const projectFilter = options.projects ?? null
      if (projectFilter !== null && (!Array.isArray(projectFilter) || !projectFilter.length
          || projectFilter.some(name => typeof name !== 'string' || !name))) {
        throw new Error('readKnowledgeBoard options.projects must be a nonempty array of project identifiers')
      }
      const projects = (await all(tracker.class.Project, {})).rows
      for (const name of projectFilter ?? []) {
        if (!projects.some(row => row.identifier === name)) {
          throw new Error(`The board read asked for project ${name}, which the board does not have`)
        }
      }
      const kept = projectFilter === null ? null : new Set(projectFilter)
      const spaces = new Set(projects.filter(row => kept === null || kept.has(row.identifier)).map(row => row._id))
      const issues = (await all(tracker.class.Issue, {})).rows.filter(row => spaces.has(row.space))
      const comments = (await all(chunter.class.ChatMessage, { collection: 'comments' })).rows
      const tasks = []
      const unreadableDescriptions = []
      for (const issue of issues) {
        let description = ''
        if (issue.description) {
          try {
            const markup = await client.fetchMarkup(tracker.class.Issue, issue._id, 'description', issue.description, 'markup')
            description = String(text.markupToMarkdown(JSON.parse(markup)) ?? '')
          } catch (error) {
            // A card keeps its title and comments when its description will
            // not read; the failure is named so the index can say so too.
            unreadableDescriptions.push({ identifier: issue.identifier || issue._id, error: String(error.message) })
          }
        }
        const issueComments = comments.filter(row => row.attachedTo === issue._id).map(row => {
          let comment = row.message ?? ''
          try {
            comment = String(text.markupToMarkdown(JSON.parse(comment)) ?? '')
          } catch (error) {
            // Legacy plain text comments remain readable.
          }
          return { id: row._id, comment: comment.trim() }
        })
        tasks.push({ identifier: issue.identifier, project: issue.space,
          title: issue.title,
          description, comments: issueComments })
      }
      return { projects: projects.filter(row => kept === null || kept.has(row.identifier)),
        tasks, unreadableDescriptions, verified: true }
    }
    if (operation === 'readSupervisionBoard' || operation === 'readSelectedBoard' || operation === 'readPreparerBoard') {
      // Everything the Python supervision client needs to read the board in
      // one round trip: the projects, the label catalog, and every issue with
      // labels, its actual description text, blocking relations expressed as
      // card numbers, comment text and attachment times. The descriptions are
      // collaborative documents, so fetching their text here keeps the caller
      // from making one remote round trip per card.
      // The caller may pass options {projects, stages} to name only the
      // cards it can act on. A whole-board read costs one document fetch per
      // card, so an optioned read fetches descriptions, comments and
      // attachments only for the cards it keeps. Without options the read
      // covers the whole board, exactly as before.
      // The preparer read takes no options. Its projects come from the board
      // options, never from a name in this file, and it keeps no card whose
      // stage is finished.
      const preparer = operation === 'readPreparerBoard'
      if (preparer) {
        assert.equal(args.length, 0, 'A preparer board read takes no arguments')
        assert(Array.isArray(config.preparerProjects) && config.preparerProjects.length > 0
          && config.preparerProjects.every(value => typeof value === 'string' && value),
        'readPreparerBoard needs preparerProjects in the board options')
      }
      // readSelectedBoard takes the selection the Python supervision client
      // sends: an object with an optional project, an optional stage, and
      // openOnly, which drops every card in a finished stage. It is this read
      // scoped to that project or stage.
      const selection = operation === 'readSelectedBoard' ? args[0]?.selection : undefined
      if (operation === 'readSelectedBoard') {
        assert(selection && typeof selection === 'object' && !Array.isArray(selection),
          'A selected board read requires a selection object')
      }
      const options = preparer ? { projects: config.preparerProjects }
        : selection ? { projects: selection.project == null ? null : [selection.project],
          stages: selection.stage == null ? null : [selection.stage] }
          : (args[0] ?? {})
      assert(options === null || (typeof options === 'object' && !Array.isArray(options)),
        'readSupervisionBoard options must be an object')
      const stageFilter = options.stages ?? null
      const projectFilter = options.projects ?? null
      const dropFinished = preparer || selection?.openOnly === true
      // openOnly keeps only the cards whose status is not finished, and drops the finished ones before
      // any description, comment or attachment is fetched. It applies to an optioned read only.
      const openOnly = options.openOnly === true
      if (options.openOnly !== undefined && typeof options.openOnly !== 'boolean') {
        throw new Error('readSupervisionBoard options.openOnly must be a boolean')
      }
      for (const [name, value] of [['stages', stageFilter], ['projects', projectFilter]]) {
        if (value !== null && (!Array.isArray(value) || !value.length
            || value.some(title => typeof title !== 'string' || !title))) {
          throw new Error(`readSupervisionBoard options.${name} must be a nonempty array of strings`)
        }
      }
      const projects = (await all(tracker.class.Project, {})).rows
      const projectBySpace = new Map(projects.map(row => [row._id, row]))
      const scoped = projectFilter === null ? null : projects.filter(row => projectFilter.includes(row.identifier))
      if (scoped !== null) {
        for (const name of projectFilter) {
          if (!projects.some(row => row.identifier === name)) {
            throw new Error(`The board read asked for project ${name}, which the board does not have`)
          }
        }
      }
      const wholeBoard = scoped === null && stageFilter === null && !openOnly
      let issues
      let references
      if (stageFilter !== null || openOnly) {
        // A card's stage is its status, so a stage read asks the server for the
        // issues in the wanted stage statuses. An openOnly read asks for the
        // issues in every status that is not finished. Only those issues are then
        // fetched, and their labels by card id, so the cost follows the kept
        // cards, not the size of the whole project. A server that rejects
        // the status query may use the legacy fallback for staged reads.
        // Open-only reads propagate errors instead of fetching the whole board.
        const spaceNames = scoped === null ? null : scoped.map(project => project._id)
        const stageStatuses = stageFilter === null ? null : await stageStatusTable()
        const openStatuses = openOnly
          ? new Set((await all(tracker.class.IssueStatus, {})).rows
            .filter(row => !statusDone(statusCategoryName(row.category))).map(row => row._id))
          : null
        const statusIds = stageFilter === null ? openStatuses
          : new Set(stageFilter.map(title => stageStatuses.get(title)?._id)
            .filter(id => id && (!openOnly || openStatuses.has(id))))
        try {
          issues = []
          if (statusIds.size) {
            const statusQuery = { status: { $in: [...statusIds] } }
            const queries = spaceNames === null ? [statusQuery] : spaceNames.map(space => ({ ...statusQuery, space }))
            for (const query of queries) issues.push(...(await all(tracker.class.Issue, query)).rows)
          }
          // A label reference has no identity of its own. It is keyed by tag,
          // attached card and collection, so its batched fetch goes by the
          // card ids rather than by document identities.
          references = []
          const issueIds = issues.map(row => row._id)
          for (let start = 0; start < issueIds.length; start += 500) {
            references.push(...(await all(tags.class.TagReference,
              { attachedTo: { $in: issueIds.slice(start, start + 500) }, collection: 'labels' })).rows)
          }
        } catch (error) {
          if (openOnly) throw error
          issues = (await all(tracker.class.Issue, {})).rows
          // The whole fetch crosses every space, so the project filter is
          // still owed. A card is kept only inside the requested spaces.
          if (spaceNames !== null) issues = issues.filter(row => spaceNames.includes(row.space))
          const inSpaces = new Set(issues.map(row => row._id))
          references = (await all(tags.class.TagReference, { collection: 'labels' })).rows
            .filter(reference => inSpaces.has(reference.attachedTo) && (spaceNames === null || spaceNames.includes(reference.space)))
        }
        // A card's status can change while issues are fetched. Apply the
        // requested stages again to the fetched cards.
        issues = issues.filter(row => statusIds.has(row.status))
        const keptIds = new Set(issues.map(row => row._id))
        references = references.filter(reference => keptIds.has(reference.attachedTo))
      } else if (scoped === null) {
        issues = (await all(tracker.class.Issue, {})).rows
        references = (await all(tags.class.TagReference, { collection: 'labels' })).rows
      } else {
        issues = []
        references = []
        for (const project of scoped) {
          issues.push(...(await all(tracker.class.Issue, { space: project._id })).rows)
          references.push(...(await all(tags.class.TagReference, { space: project._id, collection: 'labels' })).rows)
        }
      }
      const issueById = new Map(issues.map(row => [row._id, row]))
      let comments
      let attachments
      if (wholeBoard) {
        comments = (await all(chunter.class.ChatMessage, {})).rows
        attachments = (await all(attachment.class.Attachment, {})).rows
      } else {
        // Issues outside the kept stages never appear in the returned tasks,
        // so their comments and attachments are fetched by reference instead
        // of read whole. A server that rejects the batched query falls back
        // to the whole-board fetch: the answer stays correct, only slower.
        const kept = new Set(issues.map(row => row._id))
        const byAttached = async cls => {
          const ids = [...kept]
          const rows = []
          for (let start = 0; start < ids.length; start += 500) {
            rows.push(...(await all(cls, { attachedTo: { $in: ids.slice(start, start + 500) } })).rows)
          }
          if (rows.length !== new Set(rows.map(row => row._id)).size) throw new Error('Batched read repeated a row')
          return rows
        }
        try {
          comments = await byAttached(chunter.class.ChatMessage)
          attachments = await byAttached(attachment.class.Attachment)
        } catch (error) {
          if (openOnly) throw error
          comments = (await all(chunter.class.ChatMessage, {})).rows.filter(row => kept.has(row.attachedTo))
          attachments = (await all(attachment.class.Attachment, {})).rows.filter(row => kept.has(row.attachedTo))
        }
      }
      const labels = (await all(tags.class.TagElement, { targetClass: tracker.class.Issue })).rows
      // The snapshot carries each card's assignee so the evidence check can
      // read an owner decision from assignment. The Issue field holds the
      // contact Person document id; the caller compares the account uuid, so
      // resolve Person here and never by display name.
      const people = (await all(contact.class.Person, {})).rows
      // The document fetch is the cost of this read, and the calls wait on
      // each other. Run them through a bounded pool instead of one at a
      // time: the pool adds only the parallelism a serial loop lacked, it
      // changes no check, and each call keeps its own deadline. A card whose
      // description is unreadable stays empty exactly as before.
      const fetchDescription = async issue => {
        try {
          const markup = await client.fetchMarkup(tracker.class.Issue, issue._id, 'description', issue.description, 'markup')
          return String(text.markupToMarkdown(JSON.parse(markup)) ?? '')
        } catch (error) {
          // A description reference without a readable collaborative
          // document must not fail the whole board read.
          return ''
        }
      }
      const withDescription = issues.filter(issue => issue.description)
      const fetched = await pooled(config.description_pool, withDescription, fetchDescription)
      const descriptionById = new Map(withDescription.map((issue, index) => [issue._id, fetched[index]]))
      const statusById = new Map((await all(tracker.class.IssueStatus, {})).rows.map(row => [row._id, row]))
      const tasks = []
      for (const issue of issues) {
        const issueLabels = plainLabelRows(references.filter(reference => reference.attachedTo === issue._id))
          .map(reference => ({ id: reference.tag, title: reference.title }))
        const status = statusById.get(issue.status)
        const category = statusCategoryName(status?.category)
        // A preparer read keeps no card whose status is finished.
        if (dropFinished && statusDone(category)) continue
        const description = descriptionById.get(issue._id) ?? ''
        const blocked = []
        for (const ref of issue.blockedBy ?? []) {
          let other = issueById.get(ref._id)
          if (!other && !wholeBoard) {
            // A blocker outside the kept cards is still part of the kept
            // card's readiness answer, so resolve its number directly.
            other = await client.findOne(tracker.class.Issue, { _id: ref._id }, { showArchived: true })
            if (other) issueById.set(ref._id, other)
          }
          if (!other) throw new Error(`A blocking relation on ${issue.identifier} points outside the read board`)
          // done comes from the blocker's Board status, so a caller can tell an open blocked-by.
          blocked.push({ id: other.number >= config.number_floor ? other.identifier : other.number,
            done: statusDone(statusCategoryName(statusById.get(other.status)?.category)) })
        }
        const issueComments = comments.filter(row => row.attachedTo === issue._id && row.collection === 'comments')
          .map(row => ({ id: row._id, created: new Date(row.createdOn || 0).toISOString(), comment: commentMarkdown(row.message, text) }))
          .sort((a, b) => a.created < b.created ? -1 : a.created > b.created ? 1 : 0)
        const issueAttachments = attachments
          .filter(row => row.attachedTo === issue._id && row.collection === 'attachments'
            && !String(row.name ?? '').startsWith('Vikunja original task '))
          .map(row => {
            const created = row.lastModified || row.createdOn
            return { id: row._id, created: new Date(created).toISOString() }
          })
        const person = issue.assignee ? people.find(row => row._id === issue.assignee) : null
        if (issue.assignee && !person) {
          throw new Error(`A card assignee on ${issue.identifier} names no contact person document`)
        }
        tasks.push({
          project: issue.space,
          project_id: projectBySpace.get(issue.space)?.identifier ?? issue.space,
          number: issue.number,
          identifier: issue.identifier,
          title: issue.title,
          priority: issue.priority ?? 0,
          status_name: status?.name ?? null,
          stage: status?.name ? `stage:${status.name}` : null,
          status_category: category,
          done: statusDone(category),
          description,
          labels: issueLabels,
          assignee: person ? { id: person._id, account: person.personUuid ?? null } : null,
          related_tasks: { blocked },
          comments: issueComments,
          attachments: issueAttachments,
        })
      }
      return {
        projects: projects.map(row => ({ _id: row._id, identifier: row.identifier, name: row.title, archived: row.archived })),
        labels: labels.map(row => ({ id: row._id, title: row.title })),
        tasks,
        verified: true,
        ...(preparer ? { snapshotAt: new Date().toISOString(), complete: true, total: tasks.length } : {}),
      }
    }
    if (operation === 'resolveTask') {
      const input = args[0]
      assert(typeof input === 'string' && input.length, 'A task number or identifier such as TASK-630 is required')
      const { whole, number, query } = issueQuery(input)
      const issues = await all(tracker.class.Issue, query)
      const byNumber = issues.rows
      const matches = whole ? byNumber.filter(row => row.identifier === input) : byNumber
      assert(matches.length <= 1, `Task number ${whole ? input : number} is ambiguous. Pass the full identifier`)
      const task = matches[0]
      assert(task, `Huly task ${input} was not found`)
      const project = await client.findOne(tracker.class.Project, { _id: task.space }, { showArchived: true })
      assert(project, 'Huly task project is missing')
      const labelRows = await labels(task._id)
      const stage = await stageOfStatus(task.status)
      const statusCategoryOf = async id => statusCategoryName((await client.findOne(tracker.class.IssueStatus, { _id: id }, { showArchived: true }))?.category)
      const category = await statusCategoryOf(task.status)
      let parent = null
      if (typeof task.attachedTo === 'string' && task.attachedTo && task.attachedTo !== tracker.ids.NoParent) {
        const parentTask = await client.findOne(tracker.class.Issue, { _id: task.attachedTo }, { showArchived: true })
        if (parentTask) parent = { _id: parentTask._id, number: parentTask.number, identifier: parentTask.identifier, title: parentTask.title }
      }
      // An unreadable blocker counts as not done, so the launch stays refused.
      const blocked = []
      for (const ref of task.blockedBy ?? []) {
        const other = await client.findOne(tracker.class.Issue, { _id: ref._id }, { showArchived: true })
        const done = other ? statusDone(await statusCategoryOf(other.status)) : false
        blocked.push({ id: other?.identifier ?? ref._id, identifier: other?.identifier ?? null, done })
      }
      return {
        _id: task._id, number: task.number, identifier: task.identifier, title: task.title, description: task.description,
        statusName: [...(await stageStatusTable()).values()].find(row => row?._id === task.status)?.name ?? null,
        expectedStatus: (await stageStatusTable()).get(stage)?._id ?? null,
        priority: task.priority ?? 0,
        status: task.status, stage, status_category: category, done: statusDone(category),
        assignee: task.assignee ?? null,
        project: { _id: project._id, identifier: project.identifier, name: project.title },
        labels: plainLabelRows(labelRows).map(label => ({ id: label.tag, title: label.title })), parent,
        related_tasks: { blocked }, verified: true,
      }
    }
    if (operation === 'taskRelations') {
      // The follow-up relation read. A task that sits under a parent reports
      // that parent, and a task's children are its direct sub-issues listed by
      // their stored identities. The parent chain is the UI field, and the
      // child list comes from the sub-issue collection.
      const [taskId] = args
      assert(typeof taskId === 'string' && taskId.length, 'A Huly task id is required')
      let issue = await client.findOne(tracker.class.Issue, { _id: taskId }, { showArchived: true })
      if (!issue) {
        // A number or identifier names the same card the launcher routes on.
        const { whole, number, query } = issueQuery(taskId)
        const candidates = (await all(tracker.class.Issue, query)).rows
        const matches = whole ? candidates.filter(row => row.identifier === taskId) : candidates
        assert(matches.length <= 1, `Task number ${whole ? taskId : number} is ambiguous. Pass the full identifier`)
        issue = matches[0]
      }
      assert(issue, 'Huly task does not exist')
      let parent = null
      if (typeof issue.attachedTo === 'string' && issue.attachedTo && issue.attachedTo !== tracker.ids.NoParent) {
        const parentTask = await client.findOne(tracker.class.Issue, { _id: issue.attachedTo }, { showArchived: true })
        parent = parentTask
          ? { _id: parentTask._id, number: parentTask.number, identifier: parentTask.identifier, title: parentTask.title }
          : { _id: issue.attachedTo }
      }
      const children = (await all(tracker.class.Issue, { attachedTo: issue._id })).rows
        .map(row => ({ _id: row._id, number: row.number, identifier: row.identifier, title: row.title }))
      return {
        _id: issue._id, number: issue.number, identifier: issue.identifier,
        attachedTo: parent?._id ?? (typeof issue.attachedTo === 'string' ? issue.attachedTo : null),
        parent, children, verified: true,
      }
    }
    if (operation === 'createProject') {
      const [identifier, name, description] = args
      assert(typeof identifier === 'string' && /^[A-Z][A-Z0-9]{1,4}$/.test(identifier),
        'A project identifier must be 2 to 5 uppercase letters or digits starting with a letter')
      assert(typeof name === 'string' && name.trim(), 'A project name is required')
      assert(typeof description === 'string', 'A project description is required and may be empty')
      const existing = (await all(tracker.class.Project, { identifier })).rows
      assert(existing.length <= 1, 'Huly project identifier is ambiguous')
      if (existing.length) {
        assert.equal(existing[0].name, name.trim(), 'Huly project identifier already exists with a different name')
        return { project: existing[0], existing: true, verified: true }
      }
      assert(typeof config.project_template_identifier === 'string' && config.project_template_identifier.length,
        'A project_template_identifier setting is required')
      const templates = (await all(tracker.class.Project, { identifier: config.project_template_identifier })).rows
      assert.equal(templates.length, 1, 'Huly template project is missing or ambiguous')
      const template = templates[0]
      assert(typeof template.type === 'string' && template.type.length, 'Huly template project has no type')
      assert(Array.isArray(template.members) && Array.isArray(template.owners), 'Huly template project has no people lists')
      assert(typeof template.defaultIssueStatus === 'string' && template.defaultIssueStatus.length,
        'Huly template project has no default issue status')
      assert(Number.isSafeInteger(config.number_floor) && config.number_floor > 0, 'number_floor must be a positive integer')
      const attrs = {
        identifier, name: name.trim(), description, private: false, archived: false,
        type: template.type, members: [...template.members], owners: [...template.owners],
        defaultIssueStatus: template.defaultIssueStatus, autoJoin: true,
        // createTask increments the sequence before using it as the number.
        sequence: config.number_floor - 1, defaultTimeReportDay: 'PreviousWorkDay',
      }
      // A fixed identity prevents two retrying harness callers from minting
      // different project documents for the same identifier.
      const id = stableId('harness-project', config.workspace, identifier)
      const outcome = await addOnce(client, tracker.class.Project, id,
        () => client.createDoc(tracker.class.Project, core.default.space.Space, attrs, id))
      const saved = await client.findOne(tracker.class.Project, { _id: id }, { showArchived: true })
      assert(saved, 'Created Huly project is missing')
      assert.equal(saved.space, core.default.space.Space, 'Huly project space read-back differs')
      for (const [field, value] of Object.entries(attrs)) {
        assert.deepEqual(saved[field], value, `Huly project ${field} read-back differs`)
      }
      const matches = (await all(tracker.class.Project, { identifier })).rows
      assert.equal(matches.length, 1, 'Huly project identifier is not unique')
      assert.equal(matches[0]._id, id, 'Huly project identifier resolves to the wrong project')
      return { project: saved, existing: outcome === 'present', verified: true }
    }
    if (operation === 'addProjectMember') {
      // Adds one person to a project's member list, so the person sees the
      // project's cards. The person comes from the account uuid, resolved as
      // setTaskAssignee resolves it, never from a name. A person already on
      // the list is reported without a write. The read-back requires the
      // person on the list, so a write that did not take effect fails.
      assert.equal(args.length, 2, 'A project identifier and an account uuid are the only arguments')
      const [identifier, accountUuid] = args
      assert(typeof identifier === 'string' && identifier.length, 'A Huly project identifier is required')
      assert(typeof accountUuid === 'string' && accountUuid.length, 'An account uuid is required')
      const projects = (await all(tracker.class.Project, { identifier })).rows
      assert.equal(projects.length, 1, `Huly project ${identifier} is missing or ambiguous`)
      const [project] = projects
      const person = await client.findOne(contact.class.Person, { personUuid: accountUuid }, { showArchived: true })
      assert(person, 'No contact person document resolves from the account uuid')
      const members = Array.isArray(project.members) ? project.members : []
      if (members.includes(person._id)) return { project: identifier, person: person._id, members: members.length, added: false, verified: true }
      await client.updateDoc(tracker.class.Project, project.space, project._id, { $push: { members: person._id } })
      const { saved, count } = await convergeEntry(client, { cls: tracker.class.Project, space: project.space, id: project._id, field: 'members', entry: person._id, pull: person._id, matches: member => member === person._id })
      assert.equal(count, 1, 'Huly project member read-back differs')
      return { project: identifier, person: person._id, members: saved.members.length, added: true, verified: true }
    }
    if (operation === 'moveTask') {
      // One top-level card and its sub-issues move from one project to another, as
      // Huly's own move does. Each takes the target's next number, so its identifier
      // changes. Its comments, replies, attachments and labels take the target space,
      // and each moved card gets one comment that names its old identifier. The status
      // is the target's status of the same name, or the move is refused before any
      // write. With apply false nothing is written and the plan is returned.
      const [sourceKey, targetKey, taskId, apply = true, oldIdentifiers = {}, resume = null] = args
      assert(typeof apply === 'boolean', 'moveTask apply must be true or false')
      assert(oldIdentifiers !== null && typeof oldIdentifiers === 'object' && !Array.isArray(oldIdentifiers),
        'moveTask oldIdentifiers must be an object')
      const source = await projectForMove(all, tracker, sourceKey)
      const target = await projectForMove(all, tracker, targetKey)
      assert(source._id !== target._id, 'The source and target projects are the same')
      assert(!target.archived, `Huly project ${target.identifier} is archived, so cards cannot move into it`)
      const issue = await client.findOne(tracker.class.Issue, { _id: taskId }, { showArchived: true })
      assert(issue, 'Huly card to move is missing')
      const moveComment = async (card, space, oldIdentifier) => {
        const commentId = stableId('move-comment', card._id, oldIdentifier)
        const message = JSON.stringify(asObject(text.markdownToMarkup(
          `Moved from ${oldIdentifier} to ${card.identifier} by a board project move.`)))
        await addOnce(client, chunter.class.ChatMessage, commentId, () => client.addCollection(
          chunter.class.ChatMessage, space, card._id, tracker.class.Issue, 'comments',
          { message, attachments: 0, replies: 0 }, commentId))
        const saved = await client.findOne(chunter.class.ChatMessage, { _id: commentId }, { showArchived: true })
        assert(saved && saved.attachedTo === card._id && saved.space === space && saved.message === message,
          `Huly move comment read-back differs for ${oldIdentifier}`)
      }
      const descendantIssues = async card => {
        // One batched query per tree level, not one query per card, so a card a
        // few hundred descendants wide is planned in a few round trips.
        const found = []
        const seen = new Set([card._id])
        let frontier = [card._id]
        while (frontier.length) {
          const children = (await all(tracker.class.Issue, { attachedTo: { $in: frontier } })).rows
            .filter(row => !seen.has(row._id))
          for (const row of children) seen.add(row._id)
          found.push(...children)
          frontier = children.map(row => row._id)
        }
        return found
      }
      if (issue.space === target._id && !resume) {
        // A lost reply or a rerun finds the card in the target already, so it is not
        // moved again. Its comments are made sure of, from the old identifiers the
        // caller read before the move.
        const cards = [issue, ...(await descendantIssues(issue))]
        const moved = cards.map(card => ({ task_id: card._id, old_identifier: oldIdentifiers[card._id] ?? null, new_identifier: card.identifier }))
        if (apply) {
          for (const card of cards) {
            if (oldIdentifiers[card._id]) await moveComment(card, target._id, oldIdentifiers[card._id])
          }
        }
        return { taskId, subIssue: false, alreadyMoved: true, moved, mismatches: [], verified: true }
      }
      if (!resume && issue.attachedTo && issue.attachedTo !== tracker.ids.NoParent) {
        if (!apply) return { taskId, identifier: issue.identifier, subIssue: true, parent: issue.attachedTo, cards: [], verified: true }
        throw new Error(`Huly card ${issue.identifier} is a sub-issue and moves with its parent`)
      }
      if (!resume) assert.equal(issue.space, source._id, `Huly card ${issue.identifier} is not in project ${source.identifier}`)
      const type = await ownTaskType(target)
      const statuses = new Map((await all(tracker.class.IssueStatus, {})).rows.map(row => [row._id, row]))
      const targetStatusOf = card => {
        const current = statuses.get(card.status)
        assert(current, `Huly card ${card.identifier} has no known status, so it cannot move`)
        const matched = (type.statuses ?? []).map(id => statuses.get(id)).filter(row => row?.name === current.name)
        assert.equal(matched.length, 1, `Huly card ${card.identifier} has status ${current.name}, which project ${target.identifier} lacks. Allow that status on the target before the move`)
        return matched[0]._id
      }
      const classes = [chunter.class.ChatMessage, attachment.class.Attachment, tags.class.TagReference]
      const plan = resume ?? []
      for (const card of resume ? [] : [issue, ...(await descendantIssues(issue))]) {
        assert.equal(card.space, source._id, `Huly sub-issue ${card.identifier} is not in project ${source.identifier}`)
        plan.push({ card, status: targetStatusOf(card), before: await cardSnapshot(all, { tags, chunter, attachment }, card),
          docs: await movedDocs(all, classes, card) })
      }
      if (!apply) {
        return { taskId, identifier: issue.identifier, subIssue: false, kind: type._id, verified: true,
          resume: plan,
          cards: plan.map(entry => ({ task_id: entry.card._id, identifier: entry.card.identifier, title: entry.card.title,
            status: statuses.get(entry.status)?.name ?? null, attached: entry.docs.length })) }
      }
      const floor = config.number_floor
      assert(Number.isSafeInteger(floor) && floor > 0, 'number_floor must be a positive integer')
      let sequence = Number(target.sequence ?? 0)
      if (sequence < floor) {
        const raised = await client.updateDoc(tracker.class.Project, core.default.space.Space, target._id,
          { $inc: { sequence: floor - sequence } }, true)
        sequence = raised?.object?.sequence ?? floor
      }
      const moved = []
      for (const entry of plan) {
        const current = await client.findOne(tracker.class.Issue, { _id: entry.card._id }, { showArchived: true })
        assert(current && [source._id, target._id].includes(current.space), `Card ${entry.card.identifier} left both move projects`)
        const oldIdentifier = entry.card.identifier
        // Every card takes the target's next number, whatever its space is at
        // this moment. A partial move can carry a card's sub-issues along, so a
        // sub-issue may already sit in the target before its own turn while it
        // still carries its old number and identifier. The saved original
        // identifier, from the plan or the pending record, is what tells a card
        // that already took a target number apart from one the cascade moved.
        const numbered = current.identifier !== oldIdentifier
        const taken = numbered ? { object: { sequence: current.number } } : await client.updateDoc(tracker.class.Project, core.default.space.Space, target._id,
          { $inc: { sequence: 1 } }, true)
        const number = taken?.object?.sequence
        assert.equal(typeof number, 'number', 'Huly did not return the incremented project sequence')
        const identifier = numbered ? current.identifier : `${target.identifier}-${number}`
        await client.updateDoc(tracker.class.Issue, current.space, entry.card._id, {
          space: target._id, number, identifier, rank: `0|${number.toString(36).padStart(6, '0')}:`,
          kind: type._id, status: entry.status,
        })
        for (const { cls, row } of entry.docs) {
          const currentDoc = await client.findOne(cls, { _id: row._id }, { showArchived: true })
          assert(currentDoc, `Attached document ${row._id} is missing`)
          await client.updateDoc(cls, currentDoc.space, row._id, { space: target._id })
        }
        await moveComment({ _id: entry.card._id, identifier }, target._id, oldIdentifier)
        moved.push({ task_id: entry.card._id, old_identifier: oldIdentifier, new_identifier: identifier })
      }
      // Parent links retain their document ids while their display references follow
      // the new identifiers and space of ancestors in this move.
      const movedById = new Map(moved.map(row => [row.task_id, row]))
      for (const entry of plan) {
        const parents = (entry.card.parents ?? []).map(parent => movedById.has(parent.parentId)
          ? { ...parent, identifier: movedById.get(parent.parentId).new_identifier, space: target._id } : parent)
        if (parents.some((parent, index) => parent !== entry.card.parents[index])) {
          await client.updateDoc(tracker.class.Issue, target._id, entry.card._id, { parents })
        }
      }
      // Each card is read back from the board, and each kept field is compared with
      // its state before the move. A mismatch is reported on its card.
      const mismatches = []
      for (const [index, entry] of plan.entries()) {
        const saved = await client.findOne(tracker.class.Issue, { _id: entry.card._id }, { showArchived: true })
        assert(saved, 'Huly moved card is missing')
        const after = await cardSnapshot(all, { tags, chunter, attachment }, saved)
        const differs = moveMismatches(entry.before, after, { status: entry.status })
        if (saved.space !== target._id) differs.push('space')
        if (saved.identifier !== moved[index].new_identifier) differs.push('identifier')
        if (saved.kind !== type._id) differs.push('kind')
        for (const { cls, row } of entry.docs) {
          const docAfter = await client.findOne(cls, { _id: row._id }, { showArchived: true })
          if (docAfter?.space !== target._id) differs.push(`${cls} space`)
          const content = doc => Object.fromEntries(Object.entries(doc ?? {}).filter(([key]) => !['space', 'modifiedOn', 'modifiedBy'].includes(key)).sort(([a], [b]) => a.localeCompare(b)))
          if (JSON.stringify(content(row)) !== JSON.stringify(content(docAfter))) differs.push(`${cls} content`)
        }
        if (differs.length) mismatches.push({ task_id: entry.card._id, identifier: saved.identifier, fields: [...new Set(differs)] })
      }
      return { taskId, subIssue: false, alreadyMoved: false, moved, mismatches, verified: mismatches.length === 0 }
    }
    if (operation === 'repairMovedNumbers') {
      // A move gives every card, sub-issues included, the target's next number and
      // identifier. A card a move left behind, because a space change cascaded to it
      // before its own turn, keeps an identifier that does not carry its project's
      // prefix, or shares its number with another card. This repair finds those cards
      // in one project, gives each one the project's next number and the prefixed
      // identifier built from it, writes one comment that names the old identifier,
      // and updates the receipt so the old identifier resolves to the new one. A card
      // the receipt does not name gets an entry. Every card is read back.
      //
      // dryRun true lists each card with its planned identifier and
      // writes nothing. A named single card limits the run to that card, so the
      // one-card trial before a batch is one command.
      const [projectKey, options = {}] = args
      assert(options !== null && typeof options === 'object' && !Array.isArray(options),
        'repairMovedNumbers takes a project and an options object')
      assert(options.dryRun === undefined || typeof options.dryRun === 'boolean', 'repairMovedNumbers dryRun must be true or false')
      const named = options.tasks
      assert(named === undefined || (Array.isArray(named) && named.length > 0 && named.every(key => typeof key === 'string' && key.length > 0)),
        'repairMovedNumbers takes an optional nonempty list of card identifiers')
      const apply = options.dryRun !== true
      const project = await projectForMove(all, tracker, projectKey)
      const prefix = `${project.identifier}-`
      const cards = (await all(tracker.class.Issue, { space: project._id })).rows
      // Keep the prefixed card when a number is shared. Otherwise keep the
      // oldest card, with document identity breaking equal creation times.
      const keeper = new Map()
      const counts = new Map()
      for (const card of cards) {
        counts.set(card.number, (counts.get(card.number) ?? 0) + 1)
        const previous = keeper.get(card.number)
        const prefixed = row => String(row.identifier ?? '').startsWith(prefix)
        if (!previous || (prefixed(card) && !prefixed(previous))
          || (prefixed(card) === prefixed(previous)
            && ((card.createdOn ?? 0) < (previous.createdOn ?? 0)
              || ((card.createdOn ?? 0) === (previous.createdOn ?? 0)
                && String(card._id) < String(previous._id))))) keeper.set(card.number, card)
      }
      const damaged = cards.filter(card => counts.get(card.number) > 1
        ? keeper.get(card.number)._id !== card._id
        : !String(card.identifier ?? '').startsWith(prefix))
      const skipped = []
      let selected = damaged
      if (named !== undefined) {
        for (const key of named) {
          assert(cards.some(card => card.identifier === key || card._id === key),
            `Card ${key} is not in project ${project.identifier}`)
        }
        selected = damaged.filter(card => named.includes(card.identifier) || named.includes(card._id))
        skipped.push(...named.filter(key => !selected.some(card => card.identifier === key || card._id === key))
          .map(key => ({ identifier: key, reason: 'it keeps its number under the repair selection rule' })))
      }
      const floor = config.number_floor
      assert(Number.isSafeInteger(floor) && floor > 0, 'number_floor must be a positive integer')
      let sequence = Math.max(Number(project.sequence ?? 0), floor)
      // The receipt stays on the controller. This body runs on the board host, so
      // it only returns the entries it changed and never touches board.move_mapping.
      // The sequence is raised to the floor before the first number, exactly as a move does.
      if (apply && Number(project.sequence ?? 0) < floor) {
        const raised = await client.updateDoc(tracker.class.Project, core.default.space.Space, project._id,
          { $inc: { sequence: floor - Number(project.sequence ?? 0) } }, true)
        sequence = raised?.object?.sequence ?? floor
      }
      const commentOn = async (card, oldIdentifier, identifier) => {
        const commentId = stableId('number-repair-comment', card._id, oldIdentifier)
        const message = JSON.stringify(asObject(text.markdownToMarkup(
          `Renumbered from ${oldIdentifier} to ${identifier} by a board number repair.`)))
        await addOnce(client, chunter.class.ChatMessage, commentId, () => client.addCollection(
          chunter.class.ChatMessage, project._id, card._id, tracker.class.Issue, 'comments',
          { message, attachments: 0, replies: 0 }, commentId))
        const saved = await client.findOne(chunter.class.ChatMessage, { _id: commentId }, { showArchived: true })
        assert(saved && saved.attachedTo === card._id && saved.space === project._id && saved.message === message,
          `Huly number-repair comment read-back differs for ${oldIdentifier}`)
        return commentId
      }
      const planned = []
      const repaired = []
      const changed = []
      for (const card of selected) {
        const oldIdentifier = card.identifier
        if (!apply) {
          sequence += 1
          planned.push({ task_id: card._id, old_identifier: oldIdentifier, number: card.number, new_identifier: `${prefix}${sequence}` })
          continue
        }
        const taken = await client.updateDoc(tracker.class.Project, core.default.space.Space, project._id,
          { $inc: { sequence: 1 } }, true)
        const number = taken?.object?.sequence
        assert.equal(typeof number, 'number', 'Huly did not return the incremented project sequence')
        const identifier = `${prefix}${number}`
        await client.updateDoc(tracker.class.Issue, card.space, card._id, { number, identifier })
        const commentId = await commentOn(card, oldIdentifier, identifier)
        // The controller merges this entry into board.move_mapping. A self-mapping
        // becomes the new identifier, and a card the receipt never named gets one.
        changed.push({ old_identifier: oldIdentifier, new_identifier: identifier, task_id: card._id })
        const saved = await client.findOne(tracker.class.Issue, { _id: card._id }, { showArchived: true })
        assert(saved && saved.number === number && saved.identifier === identifier,
          `Huly card ${oldIdentifier} number read-back differs`)
        repaired.push({ task_id: card._id, old_identifier: oldIdentifier, number, new_identifier: identifier, comment_id: commentId })
      }
      return { project: project.identifier, apply,
        cards: apply ? repaired : planned,
        repaired: repaired.map(row => row.task_id),
        // The entries the board host changed, for the controller to merge into the
        // receipt it owns. Empty on a dry run, which writes nothing.
        changed_entries: changed,
        skipped,
        // A card listed in the dry run takes the next number at the time of the apply.
        planned: planned.length,
        verified: true }
    }
    if (operation === 'archiveProject') {
      // A project with an open card does not archive. Open means a status whose
      // category is not Won or Lost, the same test the project read uses.
      const [key, apply = true] = args
      assert(typeof apply === 'boolean', 'archiveProject apply must be true or false')
      const project = await projectForMove(all, tracker, key)
      if (project.archived === true) return { project: project.identifier, archived: true, alreadyArchived: true, verified: true }
      const statuses = new Map((await all(tracker.class.IssueStatus, {})).rows.map(row => [row._id, row]))
      const open = (await all(tracker.class.Issue, { space: project._id })).rows
        .filter(row => !statusDone(statusCategoryName(statuses.get(row.status)?.category)))
      assert.equal(open.length, 0, `Huly project ${project.identifier} has ${open.length} open cards and cannot be archived: ${open.slice(0, 10).map(row => row.identifier).join(', ')}`)
      if (!apply) return { project: project.identifier, archived: false, wouldArchive: true, verified: true }
      await client.updateDoc(tracker.class.Project, project.space, project._id, { archived: true })
      const saved = await client.findOne(tracker.class.Project, { _id: project._id }, { showArchived: true })
      assert.equal(saved?.archived, true, 'Huly project archived read-back differs')
      return { project: project.identifier, archived: true, alreadyArchived: false, verified: true }
    }
    if (operation === 'renameProject') {
      // Only the display name changes. The identifier, which every card's identifier
      // is built from, is never written here.
      const [key, name, apply = true] = args
      assert(typeof apply === 'boolean', 'renameProject apply must be true or false')
      assert(typeof name === 'string' && name.trim(), 'A new project name is required')
      const project = await projectForMove(all, tracker, key)
      const next = name.trim()
      const changed = project.name !== next
      if (!apply) return { project: project.identifier, from: project.name, to: next, wouldChange: changed, verified: true }
      if (changed) await client.updateDoc(tracker.class.Project, project.space, project._id, { name: next })
      const saved = await client.findOne(tracker.class.Project, { _id: project._id }, { showArchived: true })
      assert.equal(saved?.name, next, 'Huly project name read-back differs')
      assert.equal(saved.identifier, project.identifier, 'Huly project identifier changed on rename')
      return { project: saved.identifier, name: saved.name, identifier: saved.identifier, changed, verified: true }
    }
    if (operation === 'createTask') {
      const [projectId, title, markdown, labelTitles, parentKey, priorityName, nativeStage] = args
      assert(typeof projectId === 'string' && projectId.length, 'A Huly project id is required')
      assert(typeof title === 'string' && title.trim(), 'A task title is required')
      assert(typeof markdown === 'string', 'A description source is required and may be empty')
      assert(Array.isArray(labelTitles) && labelTitles.every(value => typeof value === 'string' && value.length), 'Labels must be an array of titles')
      assert.equal(new Set(labelTitles).size, labelTitles.length, 'Label titles must be unique')
      const retired = retiredLabelRefusal('The new card', labelTitles)
      if (retired) throw new Error(retired)
      if (parentKey !== undefined && parentKey !== null) {
        assert(typeof parentKey === 'string' && parentKey.length, 'A parent task id is required')
      }
      // The priority is optional. A card without one keeps Huly's no-priority value, 0.
      const priority = priorityName === undefined || priorityName === null ? 0 : priorityValue(priorityName)
      // The project key is an internal id or a project identifier such as TASK.
      let project = await client.findOne(tracker.class.Project, { _id: projectId }, { showArchived: true })
      if (!project) project = await client.findOne(tracker.class.Project, { identifier: projectId }, { showArchived: true })
      assert(project, 'Huly project does not exist')
      const spaceId = project._id
      // The card takes its project's own task type. Refusing here, before any
      // write, keeps a project without exactly one such type from taking a
      // copied or fallback kind.
      const kind = (await ownTaskType(project))._id
      // An optional parent attaches the new task under an existing issue. The
      // parent may live in an older project, and the relation is verified against
      // the stored parent and sub-issue collections after the write.
      let parent = null
      let beforeSubIssues = null
      if (parentKey !== undefined && parentKey !== null) {
        parent = await client.findOne(tracker.class.Issue, { _id: parentKey }, { showArchived: true })
        if (!parent && /^[0-9]+$/.test(parentKey)) {
          parent = await client.findOne(tracker.class.Issue, { number: Number(parentKey), space: spaceId }, { showArchived: true })
        }
        if (!parent) parent = await client.findOne(tracker.class.Issue, { identifier: parentKey }, { showArchived: true })
        assert(parent, 'Huly parent task does not exist')
        beforeSubIssues = typeof parent.subIssues === 'number' ? parent.subIssues : null
      }
      const catalog = (await all(tags.class.TagElement, { targetClass: tracker.class.Issue })).rows
      // A stage title sets the status, so it attaches no label reference.
      const wanted = labelTitles.filter(label => !isStageTitle(label)).map(label => {
        const matches = catalog.filter(row => row.title === label)
        assert.equal(matches.length, 1, `Huly label is unknown or ambiguous: ${label}`)
        return matches[0]
      })
      assert(nativeStage == null || (isStageTitle(nativeStage) && !labelTitles.some(isStageTitle)),
        'An explicit native stage cannot be combined with stage label arguments')
      const status = (await statusForLabels(nativeStage == null ? labelTitles : [nativeStage], spaceId))?._id ?? null
      if (status === null) {
        const defaultStatus = (await all(tracker.class.IssueStatus, {})).rows.find(row => row._id === project.defaultIssueStatus)
        if (defaultStatus) await refuseRetiredStage('stage:' + defaultStatus.name, spaceId)
      }
      // A retried write reuses this call's identity. Ask the board whether a
      // card already exists at that id. If it does, the earlier attempt
      // landed before its session died, so the number and description come
      // from the landed card and the read-backs below verify it. If it does
      // not, this attempt is the first and runs the whole creation.
      const id = writeId ?? randomUUID()
      const landed = await client.findOne(tracker.class.Issue, { _id: id }, { showArchived: true })
      if (readOnlyCreate && !landed) return null
      const markup = markdown.trim() ? sourceToMarkup(markdown, text) : null
      let createdHere = false
      let number
      let description = null
      if (!landed) {
        const existing = await all(tracker.class.Issue, { space: spaceId })
        const maxNumber = Math.max(0, ...existing.rows.map(row => row.number ?? 0))
        // Take the number atomically. Huly's server applies $inc to the project
        // sequence under a row lock and, with retrieve true, returns the updated
        // project with the incremented sequence. The sequence only ever moves
        // forward, so two callers cannot take the same number. Meet the band
        // floor first with another forward-only $inc when the sequence is below it.
        let sequence = Number(project.sequence ?? 0)
        const floor = Math.max(maxNumber, config.number_floor - 1)
        if (sequence < floor) {
          const raised = await client.updateDoc(tracker.class.Project, core.default.space.Space, spaceId,
            { $inc: { sequence: floor - sequence } }, true)
          sequence = raised?.object?.sequence ?? floor
        }
        const taken = await client.updateDoc(tracker.class.Project, core.default.space.Space, spaceId,
          { $inc: { sequence: 1 } }, true)
        number = taken?.object?.sequence
        assert.equal(typeof number, 'number', 'Huly did not return the incremented project sequence')
        description = markup
          ? await client.uploadMarkup(tracker.class.Issue, id, 'description', markup.markup, 'markup')
          : null
        const attrs = {
          title: title.trim(), description, status, number, identifier: `${project.identifier}-${number}`,
          kind, priority,
          rank: `0|${number.toString(36).padStart(6, '0')}:`,
          comments: 0, subIssues: 0, estimation: 0, remainingTime: 0, reportedTime: 0,
          assignee: null, component: null, milestone: null, dueDate: null,
          // Give every new issue a parent list, empty for a top-level card.
          // This avoids sending an absent list. Its connection to the reported
          // parent-estimation error still needs server-side evidence.
          parents: [],
        }
        if (parent) {
          // The UI reads the parent chain from this field, exactly as the copy
          // engine writes it for the cards it imported from Vikunja.
          attrs.parents = [{ parentId: parent._id, identifier: parent.identifier, parentTitle: parent.title, space: parent.space }]
        }
        const outcome = await addOnce(client, tracker.class.Issue, id, () => client.addCollection(
          tracker.class.Issue, spaceId, parent ? parent._id : tracker.ids.NoParent,
          tracker.class.Issue, 'subIssues', attrs, id))
        createdHere = outcome === 'added'
        const created = await client.findOne(tracker.class.Issue, { _id: id }, { showArchived: true })
        number = created.number
        description = created.description
      } else {
        number = landed.number
        description = landed.description
      }
      if (markup && !readOnlyCreate) {
        description = await writeDescription({ _id: id, space: spaceId, description }, markup.markup)
      }
      const identifier = `${project.identifier}-${number}`
      const saved = await client.findOne(tracker.class.Issue, { _id: id }, { showArchived: true })
      assert(saved, 'Created Huly task is missing')
      assert.equal(saved.number, number, 'Huly task number read-back differs')
      assert.equal(saved.identifier, identifier, 'Huly task identifier read-back differs')
      assert.equal(saved.title, title.trim(), 'Huly task title read-back differs')
      assert.equal(saved.priority, priority, 'Huly task priority read-back differs')
      if (readOnlyCreate) {
        const held = plainLabelRows(await labels(id)).map(row => row.tag).sort()
        if (JSON.stringify(held) !== JSON.stringify(wanted.map(row => row._id).sort())) return null
        if (markup) {
          if (!description) return null
          const body = await client.fetchMarkup(tracker.class.Issue, id, 'description', description, 'markup')
          if (!sameStoredMarkup(body, markup.markup)) return null
        }
      }
      if (description) {
        assert.equal(saved.description, description, 'Huly task description read-back differs')
        const savedMarkup = await client.fetchMarkup(tracker.class.Issue, id, 'description', description, 'markup')
        const sameMarkup = stable(normalizeMarkup(JSON.parse(savedMarkup))) === stable(normalizeMarkup(JSON.parse(markup.markup)))
        assert(sameMarkup, 'Huly created task description differs')
      }
      if (!readOnlyCreate) {
        // A partial first attempt can have created the issue before its labels.
        // Reconcile every attempt with stable label identities, including a late
        // first attempt that overlaps its retry.
        const held = await labels(id)
        for (const row of wanted.filter(row => !held.some(ref => ref.tag === row._id))) {
          const refId = stableId('created-label', id, row._id)
          await addOnce(client, tags.class.TagReference, refId, () => client.addCollection(
            tags.class.TagReference, spaceId, id, tracker.class.Issue, 'labels',
            { tag: row._id, title: row.title, color: row.color }, refId))
        }
      }
      const savedLabels = await labels(id)
      const savedWithLabels = await client.findOne(tracker.class.Issue, { _id: id }, { showArchived: true })
      assert.equal(savedWithLabels?.status, status, 'Huly status read-back differs')
      assert.deepEqual(plainLabelRows(savedLabels).map(row => row.title).sort(), labelTitles.filter(label => !isStageTitle(label)).sort(), 'Huly created task labels differ')
      assert.deepEqual(plainLabelRows(savedLabels).map(row => row.tag).sort(), wanted.map(row => row._id).sort(), 'Huly created task label ids differ')
      // The number must be unique in the project. If a concurrent caller ever
      // reused it, this converts the race into a reported failure instead of
      // two cards sharing an identifier.
      const byNumber = await all(tracker.class.Issue, { space: spaceId, number })
      assert.equal(byNumber.rows.length, 1, `Huly task number ${number} is not unique in its project`)
      assert.equal(byNumber.rows[0]._id, id, 'Huly task number resolves to the wrong card')
      // The parent relation reads back in both directions when an issue was
      // created under a parent: the child stores the parent identity, and the
      // parent's sub-issue collection lists the child.
      let parentInfo = null
      if (parent) {
        assert.equal(saved.attachedTo, parent._id, 'Huly created task is not attached to its parent')
        assert.equal(saved.parents?.[0]?.parentId, parent._id, 'Huly created task does not carry its parent id')
        assert.equal(saved.parents?.[0]?.identifier, parent.identifier, 'Huly created task parent identifier differs')
        assert.equal(saved.parents?.[0]?.space, parent.space, 'Huly created task parent project differs')
        const parentReadback = await client.findOne(tracker.class.Issue, { _id: parent._id }, { showArchived: true })
        if (createdHere && beforeSubIssues !== null && typeof parentReadback?.subIssues === 'number') {
          assert.equal(parentReadback.subIssues, beforeSubIssues + 1, 'Huly parent sub-issue count did not grow by one')
        }
        const children = (await all(tracker.class.Issue, { attachedTo: parent._id })).rows
        assert(children.some(row => row._id === id), 'Huly parent does not list the created child')
        parentInfo = { _id: parent._id, number: parent.number, identifier: parent.identifier }
      }
      return {
        taskId: id, number, identifier, title: saved.title, project: { _id: spaceId, identifier: project.identifier },
        labels: plainLabelRows(savedLabels).map(row => ({ id: row.tag, title: row.title })), description, parent: parentInfo, verified: true,
      }
    }
    if (operation === 'registerPlainLabel') {
      // Adds one plain label to the card label catalog, with no status. The
      // title is one lowercase line that is not a stage, and it must be new.
      assert(args.length === 1 && typeof args[0] === 'string', 'One lowercase label title is required')
      const title = args[0]
      assert(title.length && title === title.trim() && title === title.toLowerCase() && !/[\r\n]/.test(title),
        'One lowercase label title without surrounding whitespace or line breaks is required')
      assert(!title.startsWith('stage:'), 'A plain label title must not start with stage:')
      // A retried write reuses this call's identity. A label already under that
      // id is the earlier attempt's, so it is reported and not added again.
      const landedLabel = await client.findOne(tags.class.TagElement, { _id: writeId }, { showArchived: true })
      if (landedLabel) return { label: { id: landedLabel._id, title: landedLabel.title }, verified: true }
      const catalog = (await all(tags.class.TagElement, { targetClass: tracker.class.Issue })).rows
      assert.equal(catalog.filter(row => row.title === title).length, 0, `Huly label already exists: ${title}`)
      const category = await client.findOne(tags.class.TagCategory,
        { targetClass: tracker.class.Issue, default: true }, { showArchived: true })
      assert(category, 'Tracker label category is missing')
      const labelId = writeId
      await addOnce(client, tags.class.TagElement, labelId, () => client.createDoc(
        tags.class.TagElement, core.default.space.Workspace,
        { title, description: '', color: 0, targetClass: tracker.class.Issue, category: category._id }, labelId))
      const savedLabel = await client.findOne(tags.class.TagElement, { _id: labelId }, { showArchived: true })
      assert(savedLabel, 'Registered plain label is missing')
      assert.equal(savedLabel.title, title, 'Registered plain label title read-back differs')
      assert.equal(savedLabel.targetClass, tracker.class.Issue, 'Registered plain label target class read-back differs')
      assert.equal(savedLabel.category, category._id, 'Registered plain label category read-back differs')
      return { label: { id: savedLabel._id, title: savedLabel.title }, verified: true }
    }
    if (operation === 'registerStageLabel') {
      // Add one stage to the board. A stage is a Huly status, so registering
      // a stage creates that status and no label. A card's stage is its
      // status, so a new stage is registered here and read back before any
      // card can move to it. The name must be new: registering an existing
      // stage is a defect, not an edit.
      assert(args.length === 1 && typeof args[0] === 'string' && /^stage:/.test(args[0]),
        'A stage label title starting with stage: is required')
      const title = args[0]
      assert(!Object.hasOwn(retiredStages, title), `The stage ${title} is retired`)
      const name = title.slice(6)
      assert(name.length && !/[:\n]/.test(name), 'A stage label must name one plain status')
      // As for a plain label, a status already under this call's write id is the earlier attempt's.
      const landedStatus = await client.findOne(tracker.class.IssueStatus, { _id: writeId }, { showArchived: true })
      if (landedStatus) return { status: { id: landedStatus._id, name: landedStatus.name }, verified: true }
      const statuses = (await all(tracker.class.IssueStatus, { name })).rows
      assert.equal(statuses.length, 0, `Huly stage already exists: ${title}`)
      const statusCategory = name.startsWith('closed') ? 'Lost'
        : ['merged', 'deployed'].includes(name) ? 'Won'
        : name === 'queued' ? 'UnStarted' : 'Active'
      const statusId = writeId
      await addOnce(client, tracker.class.IssueStatus, statusId, () => client.createDoc(tracker.class.IssueStatus, core.default.space.Model,
        { name, category: `task:statusCategory:${statusCategory}`,
          ofAttribute: tracker.attribute.IssueStatus,
          color: statusCategory === 'Won' ? 17 : statusCategory === 'Lost' ? 22 : 11 }, statusId))
      const savedStatus = await client.findOne(tracker.class.IssueStatus, { _id: statusId }, { showArchived: true })
      assert(savedStatus, 'Registered stage status is missing')
      assert.equal(savedStatus.name, name, 'Registered stage status name read-back differs')
      return {
        status: { id: savedStatus._id, name: savedStatus.name }, verified: true,
      }
    }
    if (operation === 'ping') {
      // The health probe. Connecting already runs the loadModel handshake that
      // wedged the board host on 2026-09-16, and one tiny project read proves a
      // server round trip resolves. Nothing is written and no task is needed.
      assert.equal(args.length, 0, 'A ping takes no arguments')
      const project = await client.findOne(tracker.class.Project, {}, { showArchived: true })
      return { ok: true, project: project?._id ?? null, verified: true }
    }
    if (operation === 'agentPersonStatus') {
      // The dry run for the agent account's contact person. It reports whether a
      // person document carries the account uuid and never creates one, because
      // a new contact on the live board is the owner's decision. Nothing is written.
      assert.equal(args.length, 1, 'An account uuid is the only argument')
      const [accountUuid] = args
      assert(typeof accountUuid === 'string' && accountUuid.length, 'An account uuid is required')
      const person = await client.findOne(contact.class.Person, { personUuid: accountUuid }, { showArchived: true })
      return { accountUuid, present: Boolean(person), person: person?._id ?? null, verified: true }
    }
    if (operation === 'resolvePersonByEmail') {
      // The read behind the owner's board account. It finds the contact person
      // whose channel or email social identity carries the address and returns
      // that person's account uuid. It never creates a person and writes
      // nothing. Two persons on one address refuse, because the caller would
      // otherwise pick one of them.
      assert.equal(args.length, 1, 'An email address is the only argument')
      const [email] = args
      assert(typeof email === 'string' && email.trim().length, 'An email address is required')
      const address = email.trim()
      const people = await personsWithEmail(address)
      assert(people.length <= 1, `Email ${address} matches ${people.length} persons. Resolve the duplicate on the board first`)
      const [person] = people
      if (!person) return { email: address, present: false, personUuid: null, person: null, verified: true }
      assert(typeof person.personUuid === 'string' && person.personUuid.length, `Person ${person._id} has no account uuid`)
      return { email: address, present: true, personUuid: person.personUuid, person: person._id, verified: true }
    }
    if (operation === 'verifyAgentEmailPerson') {
      // The known-answer check for the lookup. The agent account's own login
      // email comes from the accounts file the native connection already loads,
      // so no address is an argument, and the address is never printed or
      // returned. A match means that email resolves to the person whose account
      // uuid is the configured agent account. Nothing is written.
      assert.equal(args.length, 0, 'The check takes no arguments')
      assert(typeof connection.agentEmail === 'string' && connection.agentEmail.trim().length,
        'The agent account has no login email in its accounts file')
      assert(typeof config.agent_account === 'string' && config.agent_account.length, 'An agent account uuid is required')
      const people = await personsWithEmail(connection.agentEmail.trim())
      assert(people.length <= 1, `The agent login email matches ${people.length} persons. Resolve the duplicate on the board first`)
      const [person] = people
      return { present: Boolean(person), matches: Boolean(person) && person.personUuid === config.agent_account, verified: true }
    }
    if (operation === 'readTaskActivity') {
      // The audit read behind scripts/scan-card-activity.cjs. It never writes.
      // It returns the board's own activity records, one DocUpdateMessage per
      // change, for a named set of cards, or for the whole store when the set
      // is empty. A card that does not exist is reported with exists false
      // instead of throwing, and a card that exists without activity returns
      // an empty message list.
      const [identifiers] = args
      assert(Array.isArray(identifiers) && identifiers.every(value => typeof value === 'string' && value.length),
        'Card identifiers are required, and an empty array reads the whole store')
      const issues = (await all(tracker.class.Issue, {})).rows
      const issuesTotal = issues.length
      const tasks = []
      let storeMessages = 0
      let storePages = 0
      if (identifiers.length === 0) {
        const messages = await all(activity.class.DocUpdateMessage, {})
        storeMessages = messages.total
        storePages = messages.pages
        const grouped = new Map()
        for (const row of messages.rows) {
          const list = grouped.get(row.attachedTo) ?? []
          list.push(row)
          grouped.set(row.attachedTo, list)
        }
        const issuesById = new Map(issues.map(row => [row._id, row]))
        for (const [taskId, rows] of grouped) {
          const issue = issuesById.get(taskId)
          tasks.push({
            _id: taskId,
            number: issue?.number ?? null,
            identifier: issue?.identifier ?? taskId,
            title: issue?.title ?? null,
            exists: issue !== undefined,
            messageCount: rows.length,
            messages: rows,
          })
        }
        tasks.sort((a, b) => {
          const byId = String(a.identifier).localeCompare(String(b.identifier))
          return byId !== 0 ? byId : (a.number ?? 0) - (b.number ?? 0)
        })
      } else {
        for (const input of identifiers) {
          const whole = FULL_IDENTIFIER.test(input)
          const number = whole ? Number(/-(\d+)$/.exec(input)[1]) : Number(input)
          const matches = whole
            ? issues.filter(row => row.identifier === input)
            : Number.isSafeInteger(number) && number >= 0 ? issues.filter(row => row.number === number) : []
          if (matches.length !== 1) {
            tasks.push({
              number: Number.isSafeInteger(number) ? number : null,
              identifier: input, title: null, exists: false,
              messageCount: 0, messages: [],
            })
            continue
          }
          const issue = matches[0]
          const messages = await all(activity.class.DocUpdateMessage, { attachedTo: issue._id })
          tasks.push({
            _id: issue._id,
            number: issue.number,
            identifier: issue.identifier,
            title: issue.title,
            exists: true,
            messageCount: messages.total,
            pages: messages.pages,
            messages: messages.rows,
          })
        }
      }
      return {
        source: {
          recordClass: 'activity:class:DocUpdateMessage',
          issueClass: 'tracker:class:Issue',
          host: config.host,
          url: config.url,
          operation: 'readTaskActivity',
          pageSize: config.pageSize,
          paging: 'A request returns at most 50 rows. The client pages with an _id cursor, then re-reads the matching rows so a card that moved during the read is judged by its newest row, so the 50 row cap cannot truncate a read.',
        },
        issuesTotal,
        store: { messages: storeMessages, pages: storePages },
        tasks,
        verified: true,
      }
    }
    const [taskId, value] = args
    assert(typeof taskId === 'string' && taskId.length, 'A Huly task id is required')
    const task = await client.findOne(tracker.class.Issue, { _id: taskId }, { showArchived: true })
    assert(task, 'Huly task does not exist')
    if (operation === 'repairTaskStageStatus') {
      // Sets a card's status to its stage's status, but only when the card is
      // still in the state the committed inventory recorded. The last status
      // change must not be by the owner, so the owner's own change is never
      // overwritten. The status and assignee are read back.
      assert(value && typeof value.ownerAccount === 'string' && value.ownerAccount.length, 'Owner account is required')
      const beforeLabels = await labels(taskId)
      const messages = (await all(activity.class.DocUpdateMessage, { attachedTo: taskId })).rows
      const before = stageStatusDetails(task, beforeLabels, await stageStatusTable(), messages)
      assert.deepEqual(before, value.before, 'Card changed since the committed inventory')
      assert(before.expectedStatus, 'Stage status is unknown or ambiguous')
      await refuseRetiredStage(before.stage, task.space)
      assert(before.lastStatusAccount, 'The last status account is unknown')
      assert(typeof value.ownerSocialId === 'string' && value.ownerSocialId.length, 'Owner social identity is required')
      assert(![value.ownerAccount, value.ownerSocialId].includes(before.lastStatusAccount), 'Owner status must not be changed')
      await client.updateDoc(tracker.class.Issue, task.space, taskId, { status: before.expectedStatus })
      const saved = await client.findOne(tracker.class.Issue, { _id: taskId }, { showArchived: true })
      assert.equal(saved?.status, before.expectedStatus, 'Huly status read-back differs')
      assert.equal(saved?.assignee ?? null, before.assignee, 'Huly assignee changed during status repair')
      assert.deepEqual((await labels(taskId)).map(row => row.title).sort(), before.labels, 'Labels changed during status repair')
      return { taskId, status: saved.status, verified: true }
    }
    if (operation === 'readTaskComments') {
      return (await all(chunter.class.ChatMessage, { attachedTo: taskId, collection: 'comments' })).rows
        .map(row => {
          // createdBy is the author's id, so a caller can tell whose comment each one is.
          return { id: row._id, created: new Date(row.createdOn || 0).toISOString(), comment: commentMarkdown(row.message, text), createdBy: row.createdBy ?? null }
        })
        .sort((a, b) => a.created < b.created ? -1 : a.created > b.created ? 1 : 0)
    }
    if (operation === 'readTaskAttachmentLinks') {
      assert(Array.isArray(value) && value.every(id => typeof id === 'string' && id.length),
        'Attachment identifiers must be nonempty strings')
      const wanted = new Set(value)
      const attached = (await all(attachment.class.Attachment, { attachedTo: taskId })).rows
      return { taskId, verified: true, files: attached
        .filter(row => row.collection === 'attachments' && wanted.has(row._id) && typeof row.file === 'string')
        .map(row => ({ attachmentId: row._id, url: files.link(row.file) })) }
    }
    if (operation === 'readTaskDescription') {
      // Returns the description serialized back to Markdown text, so a caller
      // can strip and rebuild a block by the same text conventions it wrote.
      // An empty markdown means the card has no description yet.
      assert(typeof taskId === 'string' && taskId.length, 'A Huly task id is required')
      const attachments = (await all(attachment.class.Attachment, { attachedTo: taskId })).rows
      if (!task.description) return { taskId, markdown: '', markup: { type: 'doc', content: [] }, attachments, verified: true }
      const saved = await client.fetchMarkup(tracker.class.Issue, taskId, 'description', task.description, 'markup')
      const markdown = text.markupToMarkdown(JSON.parse(saved))
      assert(typeof markdown === 'string', 'Huly description read-back is not text')
      return { taskId, markdown, markup: asObject(saved), attachments, verified: true }
    }
    if (operation === 'readTaskState') {
      // The end state a write asks for, read back from the board. A write that
      // lost its connection is checked against this before it is sent again.
      const references = await labels(taskId)
      const rows = plainLabelRows(references)
      const stage = await stageOfStatus(task.status)
      // Stage and label writes also clear old stage references and reconcile
      // the assignee. A saved status alone cannot prove that work finished.
      let stageComplete = !references.some(row => isStageTitle(row.title))
      if (!rows.some(row => row.title === 'owner-decision')) {
        if (stage === 'stage:queued') stageComplete &&= task.assignee == null
        else if ((stage === 'stage:implementing' || reviewStages.has(stage)) && config.agent_account) {
          const person = await client.findOne(contact.class.Person, { personUuid: config.agent_account }, { showArchived: true })
          stageComplete &&= Boolean(person) && task.assignee === person._id
        }
      }
      // The assignee is read both ways: the Person id a write stores, and the
      // account uuid a caller names. Blocked-by is the list resolveTask reads.
      const holder = task.assignee == null ? null
        : await client.findOne(contact.class.Person, { _id: task.assignee }, { showArchived: true })
      return { taskId, identifier: task.identifier, number: task.number ?? null, title: task.title,
        priority: task.priority, status: task.status,
        stage, stageComplete, labels: rows.map(row => ({ id: row.tag, title: row.title })),
        assignee: task.assignee ?? null, assigneeUuid: holder?.personUuid ?? null,
        blockedBy: (task.blockedBy ?? []).map(ref => ref._id), verified: true }
    }
    if (operation === 'setTaskDescription') {
      assert(typeof value === 'string', 'A description source is required and may be empty to clear one')
      const { markup } = sourceToMarkup(value, text)
      const reference = await writeDescription(task, markup)
      return { taskId, reference, markdown: value, verified: true }
    }
    if (operation === 'setTaskTitle') {
      // Writes the card title and reads it back before it answers. The title
      // is trimmed, and an empty title refuses before any write.
      assert(typeof value === 'string' && value.trim().length, 'A task title is required')
      const title = value.trim()
      await client.updateDoc(tracker.class.Issue, task.space, taskId, { title })
      const saved = await client.findOne(tracker.class.Issue, { _id: taskId }, { showArchived: true })
      assert.equal(saved?.title, title, 'Huly title read-back differs')
      return { taskId, title, verified: true }
    }
    if (operation === 'setTaskStage') {
      assert((args.length === 2 || args.length === 3) && isStageTitle(args[1]), 'A native stage title is required')
      const guard = args[2]
      assert(guard === undefined || (guard.onlyUnstarted === true && Array.isArray(guard.refuseLabels)
        && guard.refuseLabels.every(title => typeof title === 'string')), 'Invalid native stage guard')
      const stage = args[1]
      const target = await statusForLabels([stage], task.space)
      const unlock = await lockLabels(taskId, task.identifier, labelLockWait(config.timeout))
      try {
        const fresh = await client.findOne(tracker.class.Issue, { _id: taskId }, { showArchived: true })
        assert(fresh, 'Huly task disappeared before the status write')
        if (guard) {
          const currentLabels = plainLabelRows(await labels(taskId)).map(row => row.title)
          const status = await client.findOne(tracker.class.IssueStatus, { _id: fresh.status })
          if (currentLabels.some(title => guard.refuseLabels.includes(title))) return { state: 'blocked', verified: true }
          if (statusCategoryName(status?.category) !== 'UnStarted') return { state: 'other-stage', verified: true }
          for (const ref of fresh.blockedBy ?? []) {
            const blocker = await client.findOne(tracker.class.Issue, { _id: ref._id })
            const blockerStatus = blocker && await client.findOne(tracker.class.IssueStatus, { _id: blocker.status })
            if (!blocker || !statusDone(statusCategoryName(blockerStatus?.category))) return { state: 'blocked', verified: true }
          }
        }
        await refuseStatusOutsideType(target, fresh)
        const unchanged = fresh.status === target._id
        if (!unchanged) await client.updateDoc(tracker.class.Issue, fresh.space, taskId, { status: target._id })
        const saved = await client.findOne(tracker.class.Issue, { _id: taskId }, { showArchived: true })
        assert.equal(saved?.status, target._id, 'Huly status read-back differs')
        await clearLegacyStage(taskId)
        const plain = plainLabelRows(await labels(taskId))
        await applyStageAssignee(saved, [...plain.map(row => row.title), stage], true)
        return { taskId, stage, state: unchanged ? 'present' : 'added', status: saved.status, labels: plain.map(row => ({ id: row.tag, title: row.title })), verified: true }
      } finally { unlock() }
    }
    if (operation === 'setTaskPriority') {
      // Sets the card's native Huly priority and reads it back. The name is
      // checked before the write, so a refused name changes nothing.
      const priority = priorityValue(value)
      await client.updateDoc(tracker.class.Issue, task.space, taskId, { priority })
      const saved = await client.findOne(tracker.class.Issue, { _id: taskId }, { showArchived: true })
      assert.equal(saved?.priority, priority, 'Huly priority read-back differs')
      return { taskId, priority: value, verified: true }
    }
    if (operation === 'addTaskLabel') {
      // Adds one label and never removes one. A card carrying any label in
      // `refuseIf`, or another stage, is left exactly as it is. The reference
      // takes a stable identity from the card and the label, so two
      // concurrent calls create one reference, never two.
      const [, title, refuseIf] = args
      assert(typeof title === 'string' && title.length, 'A label title is required')
      assert(Array.isArray(refuseIf) && refuseIf.every(item => typeof item === 'string'),
        'The refusing labels must be a list of titles')
      // The card's stage is its status, so the stage it is in counts as a title here.
      const before = plainLabelRows(await labels(taskId))
      const stageNow = await stageOfStatus(task.status)
      const titles = [...before.map(row => row.title), ...(stageNow ? [stageNow] : [])]
      const current = before.map(row => ({ id: row.tag, title: row.title }))
      if (titles.some(item => refuseIf.includes(item))) return { taskId, state: 'blocked', labels: current, verified: true }
      if (isStageTitle(title)) {
        // Adding a stage moves the status. The card lock holds from the read of
        // the status to its read-back, so two concurrent adds cannot both see
        // an empty stage. A card already in another stage is left as it is.
        const unlock = await lockLabels(taskId, task.identifier, labelLockWait(config.timeout))
        try {
          const fresh = await client.findOne(tracker.class.Issue, { _id: taskId }, { showArchived: true })
          assert(fresh, 'Huly task disappeared before the stage write')
          const heldLabels = plainLabelRows(await labels(taskId))
          const stageHeld = await stageOfStatus(fresh.status)
          const heldTitles = [...heldLabels.map(row => row.title), ...(stageHeld ? [stageHeld] : [])]
          if (heldTitles.some(item => refuseIf.includes(item))) {
            return { taskId, state: 'blocked', labels: heldLabels.map(row => ({ id: row.tag, title: row.title })), verified: true }
          }
          const held = [...heldLabels.map(row => row.title), title]
          if (stageHeld === title) {
            await clearLegacyStage(taskId)
            await applyStageAssignee(task, held, true)
            return { taskId, state: 'present', labels: current, verified: true }
          }
          if (stageHeld) return { taskId, state: 'other-stage', labels: current, verified: true }
          const status = await statusForLabels([title], task.space)
          await client.updateDoc(tracker.class.Issue, task.space, taskId, { status: status._id })
          const savedTask = await client.findOne(tracker.class.Issue, { _id: taskId }, { showArchived: true })
          assert.equal(savedTask?.status, status._id, 'Huly status read-back differs')
          await clearLegacyStage(taskId)
          await applyStageAssignee(task, held, true)
          return { taskId, state: 'added', labels: current, verified: true }
        } finally { unlock() }
      }
      if (titles.includes(title)) return { taskId, state: 'present', labels: current, verified: true }
      const retired = retiredLabelRefusal(task.identifier, [title])
      if (retired) throw new Error(retired)
      const catalog = (await all(tags.class.TagElement, { targetClass: tracker.class.Issue })).rows
      const matches = catalog.filter(row => row.title === title)
      assert.equal(matches.length, 1, `Huly label is unknown or ambiguous: ${title}`)
      const referenceId = stableId('label', taskId, matches[0]._id)
      const state = await addOnce(client, tags.class.TagReference, referenceId, () => client.addCollection(
        tags.class.TagReference, task.space, taskId, tracker.class.Issue, 'labels',
        { tag: matches[0]._id, title, color: matches[0].color }, referenceId))
      await clearLegacyStage(taskId)
      const saved = plainLabelRows(await labels(taskId))
      assert(saved.some(row => row.title === title), 'Huly label read-back lacks the added label')
      assert(before.every(row => saved.some(item => item._id === row._id)), 'Huly label read-back lost a label')
      await applyStageAssignee(task, saved.map(row => row.title))
      return { taskId, state, labels: saved.map(row => ({ id: row.tag, title: row.title })), verified: true }
    }
    if (operation === 'upsertTaskComment') {
      const [, marker, body] = args
      assert(typeof marker === 'string' && marker.trim().length >= 8, 'A comment marker is required')
      assert(typeof body === 'string' && body.includes(marker), 'The comment text must carry its marker')
      const commentId = stableId('comment', taskId, marker)
      // The library may return the markup object; Huly stores the JSON string.
      const message = JSON.stringify(asObject(text.markdownToMarkup(body)))
      const existing = await client.findOne(chunter.class.ChatMessage, { _id: commentId })
      if (existing) {
        assert(existing.attachedTo === taskId && existing.collection === 'comments', 'Comment belongs to another card')
        await client.updateDoc(chunter.class.ChatMessage, task.space, commentId, { message })
      } else {
        await addOnce(client, chunter.class.ChatMessage, commentId, () => client.addCollection(
          chunter.class.ChatMessage, task.space, taskId, tracker.class.Issue, 'comments',
          { message, attachments: 0, replies: 0 }, commentId))
        // A concurrent first writer can win creation. Apply this version to that same comment.
        await client.updateDoc(chunter.class.ChatMessage, task.space, commentId, { message })
      }
      const saved = await client.findOne(chunter.class.ChatMessage, { _id: commentId })
      assert(saved && saved.attachedTo === taskId && saved.collection === 'comments' && sameStoredMarkup(saved.message, message),
        'Huly comment read-back differs')
      return { taskId, commentId, verified: true }
    }
    if (operation === 'findTaskComment' || operation === 'postTaskCommentOnce') {
      // Append-only comments. A comment carrying `marker` is found by its
      // text, so a retry reconciles against the board rather than a reply,
      // and a new one takes a stable identity from the card and marker, so
      // concurrent posts create one comment.
      const [, marker, body, links = []] = args
      assert(typeof marker === 'string' && marker.trim().length >= 8, 'A comment marker is required')
      const existing = (await all(chunter.class.ChatMessage, { attachedTo: taskId })).rows
        .filter(row => row.collection === 'comments' && String(row.message ?? '').includes(marker))
      // Each matching comment comes with its id and author id, next to the count.
      if (operation === 'findTaskComment') return {
        taskId, present: existing.length > 0, count: existing.length, verified: true,
        comments: existing.map(row => ({ id: row._id, createdBy: row.createdBy ?? null })),
      }
      assert(typeof body === 'string' && body.includes(marker), 'The comment text must carry its marker')
      if (existing.length) return { taskId, state: 'present', verified: true }
      assert(Array.isArray(links) && links.every(link => typeof link === 'string' && /^https?:\/\//.test(link)
        && body.includes(link)), 'Comment links must be HTTP URLs present in the text')
      const content = []
      let offset = 0
      for (const match of body.matchAll(/https?:\/\/[^\s]+/g)) {
        if (!links.includes(match[0])) continue
        if (match.index > offset) content.push({ type: 'text', text: body.slice(offset, match.index) })
        content.push({ type: 'text', text: match[0], marks: [{ type: 'link', attrs: { href: match[0] } }] })
        offset = match.index + match[0].length
      }
      if (offset < body.length) content.push({ type: 'text', text: body.slice(offset) })
      const message = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content }] })
      const commentId = stableId('comment', taskId, marker)
      const state = await addOnce(client, chunter.class.ChatMessage, commentId, () => client.addCollection(
        chunter.class.ChatMessage, task.space, taskId, tracker.class.Issue, 'comments',
        { message, attachments: 0, replies: 0 }, commentId))
      const saved = await client.findOne(chunter.class.ChatMessage, { _id: commentId })
      assert(saved && saved.attachedTo === taskId && String(saved.message).includes(marker), 'Huly comment read-back differs')
      return { taskId, state: state === 'added' ? 'posted' : 'present', commentId, verified: true }
    }
    if (operation === 'setTaskDescriptionMarkup') {
      assert(typeof value === 'string' && value.trim(), 'A description markup body is required')
      let doc
      try {
        doc = JSON.parse(value)
      } catch (error) {
        assert(false, `The description markup must be valid JSON, got ${value.length} bytes`)
      }
      assert(doc && doc.type === 'doc' && Array.isArray(doc.content), 'The description markup must be a stored Huly doc body')
      const reference = await writeDescription(task, value)
      return { taskId, reference, verified: true }
    }
    if (operation === 'setTaskLabels') {
      assert(Array.isArray(value) && value.every(v => typeof v === 'string' && v.length), 'Labels must be an array of titles')
      assert.equal(new Set(value).size, value.length, 'Label titles must be unique')
      assert(value.filter(v => v.startsWith('stage:')).length <= 1, 'Only one stage label is allowed')
      // A legacy paused label already on the card may stay in a rewrite. Adding one is refused.
      const legacyKept = (await labels(taskId)).some(row => row.title === 'paused')
      const retired = legacyKept ? null : retiredLabelRefusal(task.identifier, value)
      if (retired) throw new Error(retired)
      // Resolve every title before changing any attached records.
      // A stage title sets the status below and attaches no label reference.
      const catalog = (await all(tags.class.TagElement, { targetClass: tracker.class.Issue })).rows
      const wanted = value.filter(title => !isStageTitle(title)).map(title => {
        const matches = catalog.filter(row => row.title === title)
        assert.equal(matches.length, 1, `Huly label is unknown or ambiguous: ${title}`)
        return matches[0]
      })
      const status = await statusForLabels(value, task.space)
      // The lock holds from the card's read to its read-back. A concurrent
      // call on this card waits here for a bounded time, then refuses by name.
      const unlock = await lockLabels(taskId, task.identifier, labelLockWait(config.timeout))
      try {
        // The card status is read under the lock, because a call that ran
        // before this one may have moved it.
        const fresh = await client.findOne(tracker.class.Issue, { _id: taskId }, { showArchived: true })
        const startStatus = fresh?.status ?? task.status
        // Plain label changes preserve the status. Only an explicit stage moves it.
        const next = status
        // Legacy stage references are cleared only after the status write is verified.
        const before = plainLabelRows(await labels(taskId))
        const retiredNow = before.some(row => row.title === 'paused') ? null : retiredLabelRefusal(task.identifier, value)
        if (retiredNow) throw new Error(retiredNow)
        const keep = new Set()
        for (const row of before) {
          if (wanted.some(w => w._id === row.tag) && !keep.has(row.tag)) keep.add(row.tag)
          else await client.removeCollection(tags.class.TagReference, row.space, row._id, taskId, tracker.class.Issue, 'labels')
        }
        for (const row of wanted) {
          if (!keep.has(row._id)) await client.addCollection(tags.class.TagReference, task.space, taskId,
            tracker.class.Issue, 'labels', { tag: row._id, title: row.title, color: row.color }, randomUUID())
        }
        if (next) await client.updateDoc(tracker.class.Issue, task.space, taskId, { status: next._id })
        const savedTask = await client.findOne(tracker.class.Issue, { _id: taskId }, { showArchived: true })
        assert.equal(savedTask?.status, next?._id ?? startStatus, 'Huly status read-back differs')
        await clearLegacyStage(taskId)
        const saved = plainLabelRows(await labels(taskId))
        assert.deepEqual(saved.map(r => r.tag).sort(), wanted.map(r => r._id).sort(), 'Huly label read-back differs')
        assert.deepEqual(saved.map(r => r.title).sort(), value.filter(title => !isStageTitle(title)).sort(), 'Huly label titles differ')
        await applyStageAssignee(task, value, true)
        return { taskId, status: savedTask.status, labels: saved.map(r => ({ id: r.tag, title: r.title })), verified: true }
      } finally {
        unlock()
      }
    }
    if (operation === 'addTaskBlockedBy' || operation === 'removeTaskBlockedBy') {
      // The blockedBy list is the one resolveTask reads. The read-back must show the change.
      assert(typeof value === 'string' && value.length && value !== taskId, 'A different blocker task id is required')
      const blocker = await client.findOne(tracker.class.Issue, { _id: value }, { showArchived: true })
      assert(blocker, 'The blocker task does not exist')
      const adding = operation === 'addTaskBlockedBy'
      const linked = (task.blockedBy ?? []).some(ref => ref._id === blocker._id)
      if (linked === adding) return { taskId, blockerId: blocker._id, state: adding ? 'present' : 'absent', verified: true }
      const change = adding ? { $push: { blockedBy: { _id: blocker._id, _class: tracker.class.Issue } } }
        : { $pull: { blockedBy: { _id: blocker._id } } }
      await client.updateDoc(tracker.class.Issue, task.space, taskId, change)
      if (adding) {
        const { count } = await convergeEntry(client, { cls: tracker.class.Issue, space: task.space, id: taskId, field: 'blockedBy', entry: { _id: blocker._id, _class: tracker.class.Issue }, pull: { _id: blocker._id }, matches: ref => ref._id === blocker._id })
        assert.equal(count, 1, 'Huly blocked-by read-back differs')
        return { taskId, blockerId: blocker._id, state: 'added', verified: true }
      }
      const saved = await client.findOne(tracker.class.Issue, { _id: taskId }, { showArchived: true })
      assert(saved, 'Huly blocked-by read-back is missing')
      const after = (saved?.blockedBy ?? []).some(ref => ref._id === blocker._id)
      assert.equal(after, adding, 'Huly blocked-by read-back differs')
      return { taskId, blockerId: blocker._id, state: 'removed', verified: true }
    }
    if (operation === 'setTaskAssignee') {
      assert(typeof value === 'string' && value.length, 'An account uuid is required')
      // The assignee field holds the contact Person document id. Resolve the
      // person whose personUuid equals the account uuid, never by display name.
      const person = await client.findOne(contact.class.Person, { personUuid: value }, { showArchived: true })
      assert(person, 'No contact person document resolves from the account uuid')
      await client.updateDoc(tracker.class.Issue, task.space, taskId, { assignee: person._id })
      const saved = await client.findOne(tracker.class.Issue, { _id: taskId }, { showArchived: true })
      assert.equal(saved?.assignee, person._id, 'Huly assignee read-back differs')
      return { taskId, assignee: saved.assignee, person: person._id, verified: true }
    }
    if (operation === 'clearTaskAssignee') {
      // Take the card off whoever holds it. Huly stores an unassigned card
      // with a null assignee, which is what createTask writes. A card that is
      // already unassigned is reported as already clear without a write,
      // because writing null over null would add an activity entry that
      // records no change. The read-back requires an empty assignee, so a
      // write that did not take effect fails instead of being reported done.
      const previous = task.assignee ?? null
      if (previous === null) return { taskId, assignee: null, previous: null, alreadyClear: true, verified: true }
      await client.updateDoc(tracker.class.Issue, task.space, taskId, { assignee: null })
      const saved = await client.findOne(tracker.class.Issue, { _id: taskId }, { showArchived: true })
      assert(saved, 'Huly assignee read-back is missing the card')
      assert.equal(saved.assignee ?? null, null, 'Huly assignee read-back differs: the card still has an assignee')
      return { taskId, assignee: null, previous, alreadyClear: false, verified: true }
    }
    if (operation === 'attachTaskFile') {
      // Put a local file onto the card. Two steps: upload the bytes to the
      // board's file storage, then create an Attachment document that holds
      // the returned blob key beside the card's name, size and content type,
      // in the attachments collection the board's own issue read maps into
      // the card's attachment list. The read-back asserts the exact fields
      // that reader produces, so an attachment the card would not show cannot
      // be reported as verified.
      const name = args[1]
      const contentType = args[2]
      const dataBase64 = args[3]
      assert(typeof name === 'string' && name.length && name === name.trim()
        && !name.includes('/') && !name.includes('\\'), 'A plain file name is required')
      assert(typeof contentType === 'string' && contentType.length, 'A content type is required')
      assert(typeof dataBase64 === 'string' && dataBase64.length, 'File bytes in base64 are required')
      const data = Buffer.from(dataBase64, 'base64')
      assert(data.length > 0, 'File bytes decode to nothing')
      await renew('before attachment upload')
      const blob = await files.upload(data, contentType)
      await renew('after attachment upload')
      const id = randomUUID()
      await client.addCollection(attachment.class.Attachment, task.space, taskId, tracker.class.Issue,
        'attachments', {
          name, file: blob, size: data.length, type: contentType,
          lastModified: Date.now(), description: '', pinned: false,
        }, id)
      const saved = await client.findOne(attachment.class.Attachment, { _id: id }, { showArchived: true })
      assert(saved, 'Huly attachment read-back is missing')
      assert.equal(saved.attachedTo, taskId, 'Huly attachment is not attached to the card')
      assert.equal(saved.collection, 'attachments', 'Huly attachment is not in the attachments collection')
      assert.equal(saved.name, name, 'Huly attachment name read-back differs')
      assert.equal(saved.file, blob, 'Huly attachment blob read-back differs')
      assert.equal(saved.size, data.length, 'Huly attachment size read-back differs')
      assert.equal(saved.type, contentType, 'Huly attachment type read-back differs')
      return { taskId, attachmentId: id, name, size: data.length, type: contentType, file: blob, verified: true }
    }
    assert.equal(operation, 'postTaskComment', 'Unknown board operation')
    assert(typeof value === 'string' && value.trim(), 'A plain text comment is required')
    const message = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }] })
    // A retried write reuses this call's identity. If a comment already exists
    // at that id, the earlier attempt landed before its session died, so
    // verify the landed comment and report it instead of posting a second.
    const id = writeId ?? randomUUID()
    const landed = await client.findOne(chunter.class.ChatMessage, { _id: id })
    if (landed) {
      assert(landed.attachedTo === taskId && landed.message === message, 'Huly comment read-back differs')
      return { taskId, commentId: id, message: landed.message, verified: true }
    }
    await addOnce(client, chunter.class.ChatMessage, id, () => client.addCollection(
      chunter.class.ChatMessage, task.space, taskId, tracker.class.Issue,
      'comments', { message, attachments: 0, replies: 0 }, id))
    const saved = await client.findOne(chunter.class.ChatMessage, { _id: id })
    assert(saved && saved.attachedTo === taskId && saved.message === message, 'Huly comment read-back differs')
    return { taskId, commentId: id, message: saved.message, verified: true }
  } catch (error) {
    // A failed call on a shared connection may mean the connection is dead,
    // such as after a board host restart passed under a still open SSH
    // session. Drop the cached connection so the next call reconnects instead
    // of hanging on a corpse, which is how one dead connection holds every
    // later call and becomes a wedge shape again. The socket closes when the
    // calls still on it end, so this failure does not fail them with
    // Connection closed.
    if (config.shared === true) retireSharedConnection(connection)
    throw error
  } finally {
    if (config.shared === true) endSharedCall(connection)
    else await client.close()
  }
}

// The remote program for one SSH session. It reads one JSON request per line
// and answers each with one line, so several board operations share a single
// ssh process and a single native connection instead of opening a fresh one
// per operation. The native connection is shared through the shared config
// flag, because a new connection would repeat the loadModel handshake that
// wedged on 2026-09-16. When stdin reaches EOF, the shared connection is
// closed best effort and the process exits, so killing the local ssh child
// ends the remote process and its connection with it.
const SSH_LOOP_SUFFIX = `
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin, terminal: false });
const renewals = new Map();
function boardShutdown() {
  for (const pending of renewals.values()) { clearTimeout(pending.timer); pending.reject(new Error('Board proof stream closed')); }
  renewals.clear();
  if (sharedConn !== null) { closeConnection(sharedConn); sharedConn = null; }
  process.exit(0);
}
// Every request carries a host deadline a little past the client's own
// per-request limit. A request still running then has already been given up
// by the client, so the host process logs it and exits instead of waiting on
// a reply that may never come.
const configuredTimeout = Number(projectSettings().timeout);
const configuredExportTimeout = Number(projectSettings().board_export_timeout);
const configuredMoveTimeout = Number(projectSettings().move_timeout);
const hostRequestLimit = operation => {
  const exporting = operation === 'readBoardExport'
  const moving = operation === 'moveTask' || operation === 'planMoveTask'
  const configured = exporting ? configuredExportTimeout : moving ? configuredMoveTimeout : configuredTimeout
  const fallback = exporting ? defaults.board_export_timeout : moving ? defaults.move_timeout : defaults.timeout
  return (Number.isFinite(configured) && configured > 0 ? configured : fallback) + 5000
}
let requestCount = 0;
remoteStep = (tag, operation, step) => {
  try {
    process.stderr.write('huly-board remote ' + new Date().toISOString() + ' pid ' + process.pid +
      ' request ' + tag + ' ' + operation + ' ' + step + '\\n');
  } catch (error) { /* logging never fails a request */ }
};
function hostDeadlineExit(tag, operation) {
  remoteStep(tag, operation, 'exceeded ' + hostRequestLimit(operation) / 1000 + ' seconds on the host, exiting');
  for (const pending of renewals.values()) clearTimeout(pending.timer);
  renewals.clear();
  if (sharedConn !== null) { closeConnection(sharedConn); sharedConn = null; }
  process.exit(3);
}
// The caller's recheck can take as long as the request itself, so a renewal waits up to the host deadline for the request.
function requestRenewal(requestId, sequence, phase, waitMs) {
  return new Promise((resolve, reject) => {
    const key = requestId + ':' + sequence;
    const timer = setTimeout(() => { renewals.delete(key); reject(new Error('Board proof renewal timed out')); }, waitMs);
    renewals.set(key, { resolve, reject, timer });
    process.stdout.write('HULY_BOARD_RENEW=' + JSON.stringify({ requestId, sequence, phase }) + '\\n');
  });
}
rl.on('line', (line) => {
  if (!line.trim()) return;
  let request;
  try { request = JSON.parse(line); } catch (error) {
    process.stdout.write('HULY_BOARD_ERROR=' + String(error.message).replace(/[\\r\\n]+/g, ' ') + '\\n'); return;
  }
  if (request.renewal !== undefined) {
    const key = request.renewal + ':' + request.sequence;
    const pending = renewals.get(key);
    if (!pending) return;
    renewals.delete(key); clearTimeout(pending.timer);
    if (request.ok === true) pending.resolve();
    else pending.reject(new Error(request.error || 'Board proof renewal refused'));
    return;
  }
  let sequence = 0;
  const tag = String(++requestCount) + (request.writeId ? ' write ' + request.writeId : '');
  remoteStep(tag, request.operation, 'received');
  const deadline = setTimeout(() => hostDeadlineExit(tag, request.operation), hostRequestLimit(request.operation));
  const recheck = request.renewalId ? phase => requestRenewal(request.renewalId, ++sequence, phase, hostRequestLimit(request.operation)) : undefined;
  const board = createBoard({ ...request.config, native: true, shared: true, writeId: request.writeId, recheck, requestTag: tag });
  const reply = line => process.stdout.write(((request.brokerRequestId || request.callerRequestId) ? 'HULY_BOARD_REPLY=' + JSON.stringify({ requestId: request.brokerRequestId || request.callerRequestId, line }) : line) + '\\n');
  board[request.operation](...request.args)
    .then(result => { reply('HULY_BOARD_RESULT=' + JSON.stringify(result)); })
    .catch(error => {
      if (error.diagnostic) reply('HULY_BOARD_REFUSAL=' + JSON.stringify({error: error.message, diagnostic: error.diagnostic}));
      else reply('HULY_BOARD_ERROR=' + String(error && error.message || error).replace(/[\\r\\n]+/g, ' '));
    })
    .finally(() => { clearTimeout(deadline); remoteStep(tag, request.operation, 'answered'); });
});
rl.on('close', () => boardShutdown());`

// This file is the code a host broker sends to the board host. It is read once, when the
// file loads, so the socket identity and the program sent to the host are the same bytes.
// The eval payload on the board host already contains this source. It never starts
// another transport, and has no source file to open.
const OWN_CODE = typeof REMOTE_BOARD_CODE === 'undefined' ? fs.readFileSync(__filename, 'utf8') : ''
const OWN_CODE_DIGEST = createHash('sha256').update(OWN_CODE).digest('hex')

// The ssh command line for one board host. The remote program is this file with
// the caller's settings embedded, so the host reads the same settings its caller does.
function boardSshArgs(config) {
  const sshCode = 'const REMOTE_BOARD_CODE = true;\n' + OWN_CODE + '\nprojectSettings = () => (' + JSON.stringify(config) + ');\n' + SSH_LOOP_SUFFIX
  // The program travels deflated and base64 encoded, so one ssh argument stays far below the Linux per-argument limit.
  const encoded = require('node:zlib').deflateSync(Buffer.from(sshCode)).toString('base64')
  const bootstrap = `eval(require("node:zlib").inflateSync(Buffer.from("${encoded}", "base64")).toString())`
  return ['-F', '/dev/null', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
    '-o', 'IdentitiesOnly=yes', '-i', config.key, '-o', 'StrictHostKeyChecking=yes',
    '-o', `UserKnownHostsFile=${config.knownHosts}`, config.host,
    '/usr/bin/node -e ' + "'" + bootstrap + "'"]
}

// Every process on one host shares one host broker. The broker owns the single
// ssh tunnel and so the single remote client, and each process reaches it through
// a Unix socket instead of opening a tunnel of its own. The socket carries the same
// line protocol as the ssh child, so a caller reads it the way it reads that child.
// The socket is named by everything that picks the remote connection, because the
// remote process keeps one native connection. Callers that differ in any of these
// get their own broker, and callers that agree share one. The code digest is in the
// name too, so a caller on changed board code never reaches a broker that runs the
// old code. The old broker idles out once its own callers are gone.
// The folder is the user's runtime folder when there is one, and /tmp otherwise. A
// per-run TMPDIR is often too long for a socket path, so it is not used here.
function brokerSocketPath(config) {
  if (typeof config.broker_socket === 'string' && config.broker_socket !== '') return config.broker_socket
  const path = require('node:path')
  const identity = JSON.stringify([config.host, config.key, config.knownHosts, config.url, config.workspace, config.root, config.accounts, OWN_CODE_DIGEST])
  const digest = createHash('sha256').update(identity).digest('hex').slice(0, 16)
  return path.join(process.env.XDG_RUNTIME_DIR || '/tmp', `huly-board-${process.getuid()}`, `${digest}.sock`)
}

// How long a host broker with no caller and no request waits before it exits.
const BROKER_IDLE_MS = 600000

// The broker log sits in the runtime folder, which is RAM-backed, and it had grown to 94 MB
// in about nine hours on a busy host. Past 16 MB the broker keeps the newest 8 MB, cut at a
// line start, and checks the size once a minute while it runs. 8 MB is about 45 minutes of
// log at that growth rate. The config keys broker_log_cap and broker_log_check_ms override both,
// so a test can reach the cap without writing 16 MB.
const BROKER_LOG_CAP = 16 * 1024 * 1024
const BROKER_LOG_CHECK_MS = 60000

// Keeps the newest half of the log once it passes the cap. The broker writes the log in
// append mode, so the rewrite is in place and the broker's next line lands after it.
function capBrokerLog(file, cap) {
  const size = fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0
  if (size <= cap) return
  const keep = Math.floor(cap / 2)
  const fd = fs.openSync(file, 'r+')
  try {
    const tail = Buffer.alloc(keep)
    const read = fs.readSync(fd, tail, 0, keep, size - keep)
    const start = tail.subarray(0, read).indexOf(10) + 1
    fs.ftruncateSync(fd, 0)
    fs.writeSync(fd, tail, start, read - start, 0)
  } finally { fs.closeSync(fd) }
}

function connectHostBroker(socketPath) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath)
    socket.once('connect', () => resolve(socket))
    socket.once('error', reject)
  })
}

// The socket folder must belong to this user and be closed to everyone else, so no
// other user can stand in for the broker.
function ensurePrivateFolder(folder) {
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 })
  const info = fs.lstatSync(folder)
  if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0) {
    throw new Error('The host broker folder must be a private folder of this user')
  }
}

function startHostBroker(socketPath, config) {
  const log = fs.openSync(`${socketPath}.log`, 'a', 0o600)
  try {
    const broker = spawn(process.execPath, [__filename, '--host-broker', socketPath, JSON.stringify(config), OWN_CODE_DIGEST],
      { detached: true, stdio: ['ignore', log, log, 'ipc'] })
    broker.unref()
    return new Promise((resolve, reject) => {
      // Startup has one bounded acknowledgement. A failed broker is never
      // polled or waited on for recovery before opening a private tunnel.
      const timer = setTimeout(() => finish(new Error('The host broker did not acknowledge startup')), 1000)
      function finish(error) {
        clearTimeout(timer)
        broker.removeListener('exit', exited)
        broker.removeListener('error', finish)
        broker.removeListener('message', ready)
        if (broker.connected) broker.disconnect()
        if (error) reject(error)
        else resolve()
      }
      const exited = code => finish(new Error(`The host broker exited during startup (${code})`))
      const ready = message => { if (message === 'ready') finish() }
      broker.once('error', finish)
      broker.once('exit', exited)
      broker.on('message', ready)
    })
  } finally { fs.closeSync(log) }
}

// Start a missing broker once. Startup failure or an unavailable socket falls
// straight back to a private tunnel, without a broker recovery retry loop.
async function hostBrokerSocket(config) {
  const socketPath = brokerSocketPath(config)
  if (Buffer.byteLength(socketPath) > 107) throw new Error('The host broker socket path is too long')
  ensurePrivateFolder(require('node:path').dirname(socketPath))
  try { return await connectHostBroker(socketPath) } catch { /* start a missing broker once */ }
  await startHostBroker(socketPath, config)
  return connectHostBroker(socketPath)
}

// The caller's side of a host broker socket, shaped like the ssh child the session code reads and writes.
function brokerChild(socket) {
  const { PassThrough } = require('node:stream')
  return {
    stdin: socket,
    stdout: socket,
    stderr: new PassThrough(),
    kill: () => socket.destroy(),
    on: (event, listener) => socket.on(event, listener),
  }
}

// The host broker. It holds the one ssh tunnel to the board host and gives that
// tunnel concurrent requests with correlated replies to the caller that asked.
// A request still running after the caller's limit for its operation plus five seconds
// means the tunnel is wedged, so the broker drops it and the next request opens a new one.
// The broker exits after broker_idle_ms with no caller and no request, and removes its socket.
function runHostBroker(socketPath, config) {
  const logFile = `${socketPath}.log`
  const logCap = config.broker_log_cap ?? BROKER_LOG_CAP
  const checkLog = () => {
    try { capBrokerLog(logFile, logCap) } catch (error) { process.stderr.write(`host broker log cap failed: ${error.message}\n`) }
  }
  checkLog()
  // The first line of each broker's part of the log names the file it runs and the digest of that code.
  process.stderr.write(`host broker pid ${process.pid} started from ${__filename}, code sha256 ${OWN_CODE_DIGEST}\n`)
  setInterval(checkLog, config.broker_log_check_ms ?? BROKER_LOG_CHECK_MS).unref()
  const queue = []
  const callers = new Set()
  const inFlight = new Map()
  let remote = null
  let remoteBuffer = ''
  let idleTimer = null

  function shutdown() {
    server.close()
    try { fs.unlinkSync(socketPath) } catch { /* already gone */ }
    if (remote) { try { remote.stdin.end() } catch { /* already closed */ } remote.kill() }
    process.exit(0)
  }

  function armIdle() {
    clearTimeout(idleTimer)
    idleTimer = null
    if (callers.size === 0 && inFlight.size === 0 && queue.length === 0) idleTimer = setTimeout(shutdown, config.broker_idle_ms ?? BROKER_IDLE_MS)
  }

  // Drops the tunnel and fails its active requests. Later requests open a new tunnel.
  function dropRemote() {
    const dead = remote
    remote = null
    remoteBuffer = ''
    for (const request of inFlight.values()) { clearTimeout(request.timer); request.socket.destroy() }
    inFlight.clear()
    if (dead) { try { dead.stdin.end() } catch { /* already closed */ } dead.kill() }
    pump()
  }

  function ensureRemote() {
    if (remote !== null) return remote
    const child = spawn('ssh', boardSshArgs(config), { stdio: ['pipe', 'pipe', 'pipe'] })
    remote = child
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      if (child !== remote) return
      remoteBuffer += chunk
      for (;;) {
        const nl = remoteBuffer.indexOf('\n')
        if (nl === -1) break
        const line = remoteBuffer.slice(0, nl).trimEnd()
        remoteBuffer = remoteBuffer.slice(nl + 1)
        if (line !== '') answer(line)
      }
    })
    child.stderr.pipe(process.stderr)
    child.stdin.on('error', () => {})
    child.on('error', () => { if (child === remote) dropRemote() })
    child.on('close', () => { if (child === remote) dropRemote() })
    return child
  }

  function answer(line) {
    if (line.startsWith('HULY_BOARD_RENEW=')) {
      let renewal
      try { renewal = JSON.parse(line.slice(17)) } catch { dropRemote(); return }
      const request = [...inFlight.values()].find(row => row.request.renewalId === renewal.requestId)
      if (request && !request.socket.destroyed) request.socket.write(line + '\n')
      return
    }
    let reply
    try { reply = JSON.parse(line.slice('HULY_BOARD_REPLY='.length)) } catch { dropRemote(); return }
    const done = inFlight.get(reply.requestId)
    if (!done || typeof reply.line !== 'string') return
    inFlight.delete(reply.requestId)
    clearTimeout(done.timer)
    if (!done.socket.destroyed) done.socket.write('HULY_BOARD_REPLY=' + JSON.stringify({ requestId: done.request.callerRequestId, line: reply.line }) + '\n')
    pump()
  }

  function pump() {
    // The remote serializes writes on its shared native connection. Reads may
    // overlap and their correlation IDs keep out-of-order replies separate.
    while (queue.length > 0) {
      const next = queue.shift()
      if (next.socket.destroyed) continue
      const child = ensureRemote()
      const id = randomUUID()
      next.request.brokerRequestId = id
      next.timer = setTimeout(dropRemote, requestLimit(config, next.request.operation) + 5000)
      inFlight.set(id, next)
      child.stdin.write(JSON.stringify(next.request) + '\n')
    }
    armIdle()
  }

  const server = net.createServer(socket => {
    callers.add(socket)
    socket.setEncoding('utf8')
    let pending = ''
    socket.on('data', chunk => {
      pending += chunk
      for (;;) {
        const nl = pending.indexOf('\n')
        if (nl === -1) break
        const line = pending.slice(0, nl).trimEnd()
        pending = pending.slice(nl + 1)
        if (line === '') continue
        let request
        try { request = JSON.parse(line) } catch { socket.destroy(); return }
        if (request.renewal !== undefined) {
          // A caller can renew only the request it owns on this connection.
          const active = [...inFlight.values()].some(row => row.socket === socket && row.request.renewalId === request.renewal)
          if (active && remote) remote.stdin.write(line + '\n')
        } else queue.push({ socket, request })
      }
      pump()
    })
    socket.on('close', () => { callers.delete(socket); armIdle() })
    socket.on('error', () => {})
  })
  function ready() {
    armIdle()
    if (process.connected) process.send('ready')
  }
  let retried = false
  server.on('error', error => {
    if (error.code !== 'EADDRINUSE' || retried) {
      process.stderr.write(`host broker: ${error.message}\n`)
      process.exit(1)
    }
    // Another broker owns the socket, or a socket left by one that exited is in the way.
    retried = true
    connectHostBroker(socketPath).then(
      live => { live.destroy(); if (process.connected) process.send('ready', () => process.exit(0)); else process.exit(0) },
      () => { fs.rmSync(socketPath, { force: true }); server.listen(socketPath, ready) })
  })
  server.listen(socketPath, ready)
}

function createBoard(options = {}) {
  const { connect, native = false, writeId, testTransport = false, spawn: injectedSpawn, recheck, ...settings } = options
  assert(recheck === undefined || typeof recheck === 'function', 'A board renewal must be a callback')
  const stored = projectSettings()
  const config = { ...defaults, ...stored, ...settings }
  config.agent_account ??= (process.env.HULY_AGENT_ACCOUNT ?? '').trim()
  const offline = (stored.offline !== false) || settings.offline === true
  // Offline tests may exercise only explicitly injected in-memory/process doubles.
  const mockTransport = testTransport && (connect || injectedSpawn) && !native
  const spawnTransport = injectedSpawn ?? spawn
  assert(Number.isSafeInteger(config.pageSize) && config.pageSize > 0, 'pageSize must be positive')
  assert(Number.isSafeInteger(config.timeout) && config.timeout > 0, 'timeout must be positive')
  assert(Number.isSafeInteger(config.board_export_timeout) && config.board_export_timeout > 0, 'board_export_timeout must be positive')
  assert(Number.isSafeInteger(config.move_timeout) && config.move_timeout > 0, 'move_timeout must be positive')
  assert(Number.isSafeInteger(config.read_retry_ms) && config.read_retry_ms >= 0, 'read_retry_ms must be a nonnegative integer')
  assert(Number.isSafeInteger(config.description_pool) && config.description_pool >= 0,
    'description_pool must be a nonnegative integer')

  // One ssh child reused by every call from this process, together with one
  // shared native connection on the host. request/response is one line per
  // operation, so ordering is preserved and no result is ever a guess.
  let boardSession = null
  let openingSession = null
  // closeSession bumps this, so a session that was still opening when the close ran is torn down on arrival.
  let sessionEpoch = 0
  // A process reaches the board through the host broker, which holds one tunnel for
  // every process on the host, including callers with renewal callbacks. An injected
  // transport keeps its own session unless host_broker explicitly enables sharing.
  const useBroker = !native && connect === undefined &&
    (config.host_broker ?? injectedSpawn === undefined)
  function handleSSHLine(session, line) {
    if (line.startsWith('HULY_BOARD_RENEW=')) {
      let request
      try { request = JSON.parse(line.slice(17)) } catch { failSSH(session); return }
      const waiter = session.waiters.find(row => row.requestId === request.requestId)
      if (!waiter || !recheck || typeof request.phase !== 'string' || request.phase.length > 4096 ||
          request.sequence !== waiter.sequence + 1) { failSSH(session); return }
      waiter.sequence = request.sequence
      Promise.resolve().then(() => recheck(request.phase)).then(
        () => session.child.stdin.write(JSON.stringify({ renewal: request.requestId, sequence: request.sequence, ok: true }) + '\n'),
        error => session.child.stdin.write(JSON.stringify({ renewal: request.requestId, sequence: request.sequence, ok: false, error: String(error.message) }) + '\n'))
      return
    }
    let waiter
    if (line.startsWith('HULY_BOARD_REPLY=')) {
      let reply
      try { reply = JSON.parse(line.slice(17)) } catch { failSSH(session); return }
      const index = session.waiters.findIndex(row => row.callerId === reply.requestId)
      if (index === -1) return
      waiter = session.waiters.splice(index, 1)[0]
      line = reply.line
    } else waiter = session.waiters.shift()
    if (waiter === undefined) return
    clearTimeout(waiter.timer)
    if (line.startsWith('HULY_BOARD_RESULT=')) {
      try { waiter.resolve(JSON.parse(line.slice(18))) } catch (error) { waiter.reject(error) }
    } else if (line.startsWith('HULY_BOARD_REFUSAL=')) {
      try {
        const evidence = JSON.parse(line.slice(19))
        const error = new Error(evidence.error)
        error.huly = true
        error.diagnostic = evidence.diagnostic
        waiter.reject(error)
      } catch (error) { waiter.reject(error) }
    } else if (line.startsWith('HULY_BOARD_ERROR=')) {
      const error = new Error(line.slice(17))
      error.huly = true
      waiter.reject(error)
    } else {
      waiter.reject(new Error('Huly omitted the verified result'))
    }
  }
  function failSSH(session) {
    if (boardSession !== session) return
    const error = new Error(`Huly request failed or timed out. ${session.stderrTail.trim()}`)
    for (const waiter of session.waiters) { clearTimeout(waiter.timer); waiter.reject(error) }
    session.waiters.length = 0
    boardSession = null
  }
  function openSSH() {
    return attachSession(spawnTransport('ssh', boardSshArgs(config)))
  }
  // The broker's socket when this process uses the broker, and its own tunnel when the broker cannot be reached.
  async function openBoardSession(operation, args) {
    if (useBroker) {
      try { return attachSession(brokerChild(await hostBrokerSocket(config))) } catch (error) {
        const card = typeof args[0] === 'string' ? args[0] : operation
        process.stderr.write(`Huly broker fallback for ${String(card).replace(/[\r\n]+/g, ' ')}: ${String(error.message).replace(/[\r\n]+/g, ' ')}\n`)
      }
    }
    return openSSH()
  }
  function boardClosedError() {
    const error = new Error('Huly board session closed.')
    error.boardClosed = true
    return error
  }
  // A close that runs while the session is still opening must reject the request and kill the
  // child. Otherwise the request attaches a live session after the close and waits out its timeout.
  function startOpeningSession(operation, args) {
    const epoch = sessionEpoch
    const opening = openBoardSession(operation, args).then(session => {
      if (epoch !== sessionEpoch) {
        try { session.child.stdin.end() } catch { /* the child already closed */ }
        try { session.child.kill() } catch { /* the child already closed */ }
        throw boardClosedError()
      }
      boardSession = session
      return session
    }).finally(() => { if (openingSession === opening) openingSession = null })
    return opening
  }
  function attachSession(child) {
    const session = { child, waiters: [], buffer: '', stderrTail: '' }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      session.buffer += chunk
      for (;;) {
        const nl = session.buffer.indexOf('\n')
        if (nl === -1) break
        const line = session.buffer.slice(0, nl).trimEnd()
        session.buffer = session.buffer.slice(nl + 1)
        if (line !== '') handleSSHLine(session, line)
      }
    })
    child.stderr.on('data', (chunk) => {
      session.stderrTail = (session.stderrTail + String(chunk)).slice(-8192)
    })
    child.on('error', () => failSSH(session))
    child.on('close', () => failSSH(session))
    return session
  }
  function sendSSH(session, payloadJson, deadline = Infinity) {
    return new Promise((resolve, reject) => {
      if (recheck && session.waiters.length) { reject(new Error('A guarded board request cannot overlap another request')); return }
      const request = JSON.parse(payloadJson)
      request.callerRequestId = randomUUID()
      request.renewalId = recheck ? randomUUID() : null
      const waiter = { resolve, reject, timer: null, requestId: request.renewalId, callerId: request.callerRequestId, sequence: 0 }
      const limit = requestLimit(config, request.operation)
      const remaining = Math.min(limit, Math.max(0, deadline - Date.now()))
      waiter.timer = setTimeout(() => {
        const index = session.waiters.indexOf(waiter)
        if (index !== -1) session.waiters.splice(index, 1)
        const last = session.stderrTail.trim().split('\n').filter(line => line.startsWith('huly-board remote ')).at(-1)
        const detail = remaining < limit
          ? `The board call deadline expired. The request limit is ${limit / 1000} seconds.`
          : `The remote operation exceeded ${limit / 1000} seconds.`
        const error = new Error(`Huly request failed or timed out. ${detail}` +
          (last ? ` Last remote step: ${last}` : ''))
        // The marker separates a genuine timeout from a session that died on
        // its own. A dead session is still retried today, while a timed out
        // write is refused a retry, because the write may have taken effect.
        error.timedOut = true
        reject(error)
      }, remaining)
      if (waiter.timer.unref) waiter.timer.unref()
      session.waiters.push(waiter)
      try { session.child.stdin.write(JSON.stringify(request) + '\n') } catch (error) { reject(error) }
    })
  }

  // Closing is what the first merged attempt lacked, and its absence hung a
  // whole launch for eight minutes. The board object is frozen so this is an
  // explicit member of it. The session is killed and the cached pointers are
  // cleared, so the process ends and the next call opens a fresh session and,
  // where this process owns one, a fresh native connection.
  function closeSession() {
    sessionEpoch += 1
    openingSession = null
    if (boardSession !== null) {
      const session = boardSession
      boardSession = null
      // The rejection carries a marker the retry reads. When our own close
      // tears down a pending request the retry must not open a fresh session,
      // or the close would orphan a live ssh child on exactly the wedge and
      // deadline paths this whole close exists to clean. A session that died
      // on its own rejects without the marker and is still retried.
      const error = boardClosedError()
      for (const waiter of session.waiters) { clearTimeout(waiter.timer); waiter.reject(error) }
      session.waiters.length = 0
      try { session.child.stdin.end() } catch (error) { /* the child already closed */ }
      try { session.child.kill() } catch (error) { /* the child already closed */ }
    }
    if (sharedConn !== null) {
      closeConnection(sharedConn)
      sharedConn = null
    }
  }

  async function call(operation, args) {
    if (!native && operation === 'resolveTask') args = [movedIdentifier(args[0], config.move_mapping), ...args.slice(1)]
    if (config.shared !== true || !WRITE_OPERATIONS.has(operation)) {
      return callUnqueued(operation, args)
    }
    const previous = sharedWriteTail
    let release
    sharedWriteTail = new Promise(resolve => { release = resolve })
    await previous
    try {
      return await callUnqueued(operation, args)
    } finally { release() }
  }

  const batchSizeOf = options => {
    const size = options?.batchSize ?? CARD_BATCH_SIZE
    assert(Number.isSafeInteger(size) && size > 0, 'batchSize must be a positive whole number of cards')
    return size
  }
  const batchPlan = (operation, count, size) => ({
    batches: Math.ceil(count / size), batchSize: size, expectedSecondsPerBatch: size * CARD_COST_MS[operation] / 1000,
  })
  // One host call per batch of card ids. The pause between batches lets a launch's board read be served.
  async function runCardBatches(operation, lead, ids, size, changedOf, onBatch) {
    const answers = []
    let changed = 0
    for (let start = 0; start < ids.length; start += size) {
      if (start > 0) await new Promise(resolve => setTimeout(resolve, CARD_BATCH_PAUSE_MS))
      const batchIds = ids.slice(start, start + size)
      let answer
      try {
        answer = await call(operation, [true, lead, batchIds])
      } catch (error) {
        // An interrupted batch may have written some cards. Report only a confirmed snapshot.
        try {
          const left = await call('readWriteState', [operation, [false, lead]])
          const remaining = operation === 'repairCardKinds'
            ? left.projects.flatMap(project => project.cards.map(card => card.taskId))
            : left.cards.map(card => card.taskId)
          const pending = new Set(remaining)
          error.progress = { changed: ids.filter(id => !pending.has(id)).length, remaining: remaining.length }
        } catch {
          error.progress = { changed, remaining: null, verified: false }
        }
        error.message += ` (changed ${error.progress.changed}, remaining ${error.progress.remaining ?? 'unknown'})`
        throw error
      }
      answers.push(answer)
      // Recovery returns the remaining plan rather than the original write result.
      if (answer.readBack) {
        const left = new Set(operation === 'repairCardKinds'
          ? answer.projects.flatMap(project => project.cards.map(card => card.taskId))
          : answer.cards.map(card => card.taskId))
        changed += batchIds.filter(id => !left.has(id)).length
      } else changed += changedOf(answer)
      if (onBatch) onBatch({ batch: answers.length, batches: Math.ceil(ids.length / size), changed, remaining: ids.length - changed })
    }
    return answers
  }
  // A batch that lost its connection is answered from a read-back snapshot, so the flags come from the batch answers.
  const readBackFlags = answers => (answers.some(answer => answer.readBack) ? { readBack: true, snapshot: true } : {})
  async function repairCardKindsInBatches(apply = false, status, options) {
    assert(typeof apply === 'boolean', 'repairCardKinds takes one optional boolean, apply, an optional status name and an optional list of card ids')
    const size = batchSizeOf(options)
    const dry = await call('readWriteState', ['repairCardKinds', [false, status]])
    const ids = dry.projects.flatMap(project => project.cards.map(card => card.taskId))
    const plan = batchPlan('repairCardKinds', ids.length, size)
    if (!apply) return { ...dry, ...plan }
    const answers = await runCardBatches('repairCardKinds', status, ids, size, answer => answer.moved.length, options?.onBatch)
    const after = await call('readWriteState', ['repairCardKinds', [false, status]])
    const left = new Set(after.projects.flatMap(project => project.cards.map(card => card.taskId)))
    return { apply: true, setStatus: dry.setStatus, projects: after.projects, misfiled: dry.misfiled,
      moved: ids.filter(id => !left.has(id)),
      skipped: after.projects.flatMap(project => project.cards.filter(card => !card.statusAllowed).map(card => card.taskId)),
      ...plan, remaining: after.misfiled, verified: true, ...readBackFlags(answers) }
  }
  async function migrateStageLabelsInBatches(apply = false, merged = [], options) {
    assert(typeof apply === 'boolean', 'A stage migration takes an apply flag, optional merged identifiers and an optional list of card ids')
    const size = batchSizeOf(options)
    // A cards list limits every read and write of this run to those card ids,
    // so a Director can apply the status changes first. The remaining count is
    // always the whole board, so each pass says what is left after it. A card
    // already migrated has no stage label and is not planned again.
    const only = options?.cards
    assert(only === undefined || (Array.isArray(only) && only.length > 0 && only.every(id => typeof id === 'string' && id.length > 0)),
      'cards must be a nonempty list of card ids')
    const scope = apply => only === undefined ? [apply, merged] : [apply, merged, only]
    const dry = await call('readWriteState', ['migrateStageLabelsToStatus', scope(false)])
    const ids = dry.cards.map(card => card.taskId)
    const plan = batchPlan('migrateStageLabelsToStatus', ids.length, size)
    if (!apply) return { ...dry, ...plan }
    const answers = await runCardBatches('migrateStageLabelsToStatus', merged, ids, size,
      answer => answer.cards.filter(card => card.state === 'applied').length, options?.onBatch)
    const after = await call('readWriteState', ['migrateStageLabelsToStatus', [false, merged]])
    const left = new Map(after.cards.map(card => [card.taskId, card]))
    const blocked = new Map(answers.flatMap(answer => answer.cards.filter(card => card.state === 'blocked'))
      .map(card => [card.taskId, card]))
    const cards = dry.cards.map(card => left.has(card.taskId)
      ? blocked.get(card.taskId) ?? left.get(card.taskId) : { ...card, state: 'applied' })
    const applied = cards.filter(row => row.state === 'applied').length
    return { apply: true, statusChanges: cards.filter(row => row.statusChange).length,
      labelRemovals: cards.filter(row => row.state !== 'blocked' && row.statusChange === false).length,
      planned: cards.filter(row => row.state === 'planned').length, applied,
      blocked: cards.filter(row => row.state === 'blocked').length,
      cards, ...plan, remaining: after.cards.length, verified: true, ...readBackFlags(answers) }
  }

  // The read-back for a keyed write whose connection was lost. It reads the end
  // state the write asks for, under the write's own call deadline, and answers
  // with the write's shape when that state holds. null means it did not land.
  async function readBackLanded(operation, args, deadline, writeId) {
    const [task, value] = args
    const read = (name, readArgs) => callUnqueued(name, readArgs, deadline)
    // A comment is made under the write id, so the comment is found by that id.
    if (operation === 'postTaskComment') {
      const found = await read('readLandedDoc', ['comment', writeId])
      return found.present ? { taskId: task, commentId: writeId, message: found.message, verified: true, readBack: true } : null
    }
    if (operation === 'createTask') {
      const state = await read('readWriteState', [operation, args, writeId])
      return state === null ? null : { ...state, readBack: true }
    }
    if (operation === 'createProject') {
      const [identifier, name] = args
      const state = await read('readProjectState', [identifier])
      return state.exists && state.name === name.trim()
        ? { project: { _id: state.project, identifier, name: state.name }, verified: true, readBack: true } : null
    }
    if (operation === 'registerPlainLabel') {
      const [title] = args
      const found = await read('readLandedDoc', ['label', writeId])
      return found.present ? { label: { id: writeId, title }, verified: true, readBack: true } : null
    }
    if (operation === 'registerStageLabel') {
      const [title] = args
      const found = await read('readLandedDoc', ['status', writeId])
      return found.present ? { status: { id: writeId, name: title.slice(6) }, verified: true, readBack: true } : null
    }
    if (operation === 'addProjectMember') {
      // added is null here: the read-back shows the person on the list, but not
      // whether this write or an earlier attempt put them there.
      const [identifier, accountUuid] = args
      const state = await read('readProjectState', [identifier, accountUuid])
      return state.member === true
        ? { project: identifier, person: state.person, members: state.members, added: null, verified: true, readBack: true } : null
    }
    if (operation === 'upsertTaskComment') {
      const comments = await read('readTaskComments', [task])
      const id = stableId('comment', task, value)
      const found = comments.find(row => row.id === id)
      return found && found.comment === args[2].trim()
        ? { taskId: task, commentId: id, verified: true, readBack: true } : null
    }
    if (operation === 'setTaskDescriptionMarkup') {
      const saved = await read('readTaskDescription', [task])
      return sameStoredMarkup(saved.markup, value)
        ? { taskId: task, reference: null, verified: true, readBack: true } : null
    }
    if (operation === 'repairTaskStageStatus') {
      const saved = await read('readStageStatusInventory', [])
      const current = saved.tasks.find(row => row.taskId === task)
      const before = value.before
      return current && current.status === before.expectedStatus && current.assignee === before.assignee
        && JSON.stringify(current.labels) === JSON.stringify(before.labels)
        ? { taskId: task, status: current.status, verified: true, readBack: true } : null
    }
    if (['repairCardKinds', 'migrateStageLabelsToStatus', 'allowProjectStageStatuses'].includes(operation)) {
      const state = await read('readWriteState', [operation, args])
      const landed = operation === 'repairCardKinds'
        ? state.projects.every(project => project.cards.every(card => !card.statusAllowed))
        : operation === 'migrateStageLabelsToStatus' ? state.planned === 0
        : state.projects.every(project => project.lists.every(list => state.required.every(id => list.after.includes(id))))
      return landed ? { ...state, ...(Object.hasOwn(state, 'apply') ? { apply: args[0] === true } : {}),
        snapshot: true, readBack: true } : null
    }
    if (operation === 'setTaskDescription') {
      const saved = await read('readTaskDescription', [task])
      return saved.markdown === value ? { taskId: task, reference: null, markdown: value, verified: true, readBack: true } : null
    }
    if (operation === 'postTaskCommentOnce') {
      const found = await read('findTaskComment', [task, value])
      return found.present ? { taskId: task, state: 'present', commentId: found.comments[0].id, verified: true, readBack: true } : null
    }
    const state = await read('readTaskState', [task])
    if (operation === 'setTaskAssignee') {
      return state.assigneeUuid === value ? { taskId: task, assignee: state.assignee, verified: true, readBack: true } : null
    }
    if (operation === 'clearTaskAssignee') {
      return state.assignee === null ? { taskId: task, assignee: null, verified: true, readBack: true } : null
    }
    if (operation === 'addTaskBlockedBy' || operation === 'removeTaskBlockedBy') {
      const adding = operation === 'addTaskBlockedBy'
      return state.blockedBy.includes(value) === adding
        ? { taskId: task, blockerId: value, state: adding ? 'added' : 'removed', verified: true, readBack: true } : null
    }
    const answer = fields => ({ taskId: task, ...fields, status: state.status, labels: state.labels, verified: true, readBack: true })
    if (operation === 'setTaskTitle') return state.title === value.trim() ? answer({ title: state.title }) : null
    if (operation === 'setTaskPriority') return state.priority === priorityValue(value) ? answer({ priority: value }) : null
    if (operation === 'setTaskStage') return state.stage === value && state.stageComplete ? answer({ stage: value, state: 'present' }) : null
    if (operation === 'setTaskLabels') {
      const stage = value.find(isStageTitle)
      const plain = value.filter(title => !isStageTitle(title)).sort()
      const held = state.labels.map(row => row.title).sort()
      const same = plain.length === held.length && plain.every((title, n) => title === held[n])
      return same && state.stageComplete && (stage === undefined || state.stage === stage) ? answer({}) : null
    }
    if (operation === 'addTaskLabel') {
      const landed = isStageTitle(value) ? state.stage === value : state.labels.some(row => row.title === value)
      return landed && state.stageComplete ? answer({ state: 'present' }) : null
    }
    throw new Error(`No read-back for ${operation}`)
  }

  async function callUnqueued(operation, args, callDeadline) {
    if (recheck) await recheck(`Huly ${operation}: request admission`)
    if (process.env.HARNESS_BOARD_OUTBOX && !mockTransport) {
      if (recheck) throw new Error('A guarded board write requires the host transport and cannot enter an outbox')
      assertRegisteredOperation(operation)
      if (!WRITE_OPERATIONS.has(operation)) throw new Error('Board reads require the host launcher')
      const id = randomUUID()
      fs.appendFileSync(process.env.HARNESS_BOARD_OUTBOX,
        JSON.stringify({ operation, args, writeId: id }) + '\n', { mode: 0o600 })
      return { queued: true, verified: false, writeId: id }
    }
    if (offline && !mockTransport) throw new Error('Huly board is offline in tests')
    const write = WRITE_OPERATIONS.has(operation)
    assertRegisteredOperation(operation)
    // A write gets one identity for the whole call, minted outside the retry
    // loop so a retried attempt reuses its own id instead of minting a fresh
    // one. The board recognises the id, so the retry asks whether its earlier
    // attempt already landed rather than guessing. The SSH loop passes one
    // write id per request line; a connect-stubbed board has no session retry
    // but still mints here so perform always receives one.
    const requestWriteId = write ? (writeId ?? randomUUID()) : null
    let completedResult
    try {
      if (connect || native) {
        const answer = await perform(config, operation, args, connect ?? nativeConnection, requestWriteId, recheck)
        completedResult = answer
        if (recheck) await recheck(`Huly ${operation}: verified answer`)
        return answer
      }
      const payload = JSON.stringify({ config, operation, args, writeId: requestWriteId })
      let lastError = null
      // A lost session is retried on a fresh session. A genuine board
      // answer (even an error) is returned as-is and never repeated, because
      // repeating an acknowledged write could do it twice.
      // An unkeyed transport write keeps its one retry, except creates.
      // Reads and keyed writes retry after a delay until the
      // read's deadline, which is the two attempts of its timeout that
      // supervision/board_process.py call_limit already reserves for the call.
      // A keyed write (READBACK_WRITES) that loses its connection waits, reads
      // its end state back, and is sent again under the same deadline only when
      // the read-back shows it did not land.
      // A caller may ask for one attempt, as the follow-on dispatcher does, so a
      // dropped session is not retried and its call stays within one timeout.
      const limit = requestLimit(config, operation)
      const deadline = callDeadline ?? Date.now() + READ_CALL_ATTEMPTS * limit
      const keyed = write && READBACK_WRITES.has(operation)
      const attempts = config.request_attempts ?? (write && !keyed ? 2 : Infinity)
      assert(attempts === Infinity || (Number.isSafeInteger(attempts) && attempts >= 1 && attempts <= 2),
        'request_attempts must be 1 or 2')
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          if (!write && Date.now() >= deadline) throw lastError ?? new Error('The board call deadline expired.')
          if (boardSession === null) {
            openingSession ??= startOpeningSession(operation, args)
            await openingSession
          }
          if (!write && Date.now() >= deadline) throw lastError ?? new Error('The board call deadline expired.')
          const answer = await sendSSH(boardSession, payload, write && !keyed ? Infinity : deadline)
          completedResult = answer
          if (recheck) await recheck(`Huly ${operation}: verified answer`)
          return answer
        } catch (error) {
          lastError = error
          // A remote process keeps one native connection for its whole SSH
          // session. A failed native connection can answer "Connection closed"
          // while SSH remains alive. The initiating cause is not established.
          // A fresh session obtains a new native connection.
          // A read commits nothing, so this answer is retried. A write is retried
          // only through its read-back below.
          const lostConnection = error.huly === true && /Connection closed|ConnectionClosed|Broken pipe/.test(String(error.message))
          // A genuine board answer (even an error) is never retried, because
          // repeating an acknowledged write could do it twice. And a request
          // our own close rejected is teardown, not loss, so it must not open
          // a fresh session either.
          if ((error.huly && !lostConnection) || error.boardClosed) {
            error.transport = false
            throw lastError
          }
          error.transport = true
          // A write with no read-back key is not sent again after its
          // connection was lost, because it may already have taken effect.
          // Keyed creates reconcile their stable identity below.
          if (write && lostConnection && (recheck || !keyed)) {
            throw Object.assign(new Error(`${LOST_WRITE_RISK} Transport error: ${error.message}`), { transport: false })
          }
          // A keyed write waits, reconnects and reads its end state back. It is
          // sent again only when the read-back shows it did not land. A lost
          // session and a deadline expiry take the same path, as the owner rule
          // says for a deadline expiry.
          // Every keyed write must be idempotent. A hung first attempt can land
          // after the read-back says it did not, so the second send can meet the
          // first one's effect. Each keyed write's remote step therefore ends in
          // the same state run once or twice with one write id: it finds its own
          // earlier document by id, checks the end state before it changes
          // anything, sets an absolute value, or writes under a stable id. Anyone
          // who adds a keyed write must give it one of those properties first. A
          // write that cannot is left unkeyed and refuses a repeat instead.
          if (keyed && !recheck) {
            try { boardSession?.child?.kill() } catch { /* the child already closed */ }
            boardSession = null
            const wait = Math.min(config.read_retry_ms * 2 ** (attempt - 1), limit / 2)
            const epoch = sessionEpoch
            await new Promise(resolve => setTimeout(resolve, wait))
            if (epoch !== sessionEpoch) throw Object.assign(boardClosedError(), { transport: false })
            let landed
            try {
              landed = await readBackLanded(operation, args, deadline, requestWriteId)
            } catch (readError) {
              throw Object.assign(new Error(`${LOST_WRITE_RISK} The read-back failed: ${readError.message}`), { transport: false })
            }
            if (landed !== null) return landed
            if (attempt >= attempts || Date.now() >= deadline) {
              throw Object.assign(new Error('the connection was lost during this write, and the read-back shows it did not land. ' +
                'The call has no retry budget left. Read the card on the board before you retry it.'), { transport: false })
            }
            continue
          }
          // A timed out write may already have changed the board, so retrying
          // it could commit the same change twice. Refuse the retry and send
          // the caller to read instead. A read commits nothing, so a timed out
          // read keeps its retry below.
          if (write && error.timedOut) {
            try { boardSession?.child?.kill() } catch { /* the child already closed */ }
            boardSession = null
            throw Object.assign(new Error('the write timed out and may already have taken effect. Do not retry it. Read the card on the board first, then decide whether to reapply the change.'), { transport: false })
          }
          if (recheck) throw lastError
          try { boardSession?.child?.kill() } catch { /* the child already closed */ }
          boardSession = null
          if (!write) {
            // The wait doubles each time, and is capped at half an attempt's limit so a retry can still start before the
            // deadline. A final request gets only the time remaining in the call's budget.
            const wait = Math.min(config.read_retry_ms * 2 ** (attempt - 1), limit / 2)
            if (attempt >= attempts || Date.now() + wait >= deadline) throw lastError
            const epoch = sessionEpoch
            await new Promise(resolve => setTimeout(resolve, wait))
            // A close during the wait ends the call, so no new session opens after it.
            if (epoch !== sessionEpoch) throw Object.assign(boardClosedError(), { transport: false })
            if (Date.now() >= deadline) throw lastError
          }
        }
      }
      throw lastError
    } catch (error) {
      const refusal = new Error(`Huly ${operation}: ${error.message}`, { cause: error })
      refusal.diagnostic = error.diagnostic
      if (typeof error.transport === 'boolean') refusal.transport = error.transport
      if (write && completedResult !== undefined) {
        refusal.transport = false
        refusal.diagnostic = { operation, write_id: requestWriteId,
          completed_result: completedResult, acknowledged: false }
      }
      throw refusal
    }
  }
  // Moves the open cards of one project into another, one card per call, so the
  // mapping file names each card as soon as its move is read back. A card that
  // the mapping file already names is skipped, so a rerun does not move it twice.
  async function moveTasks(source, target, options = {}) {
    // The outbox queues a write and answers before it lands, so a move cannot read its plan or its result from it.
    assert(!(process.env.HARNESS_BOARD_OUTBOX && !mockTransport), 'moveTasks needs a direct board connection, not the write outbox')
    assert(typeof source === 'string' && source.length > 0 && typeof target === 'string' && target.length > 0,
      'A source and a target project identifier are required')
    assert(source !== target, 'The source and target projects must differ')
    const dryRun = !applyFlag(options)
    assert(options.tasks === undefined || (Array.isArray(options.tasks) && options.tasks.length > 0
      && options.tasks.every(key => typeof key === 'string' && key.length > 0)), 'tasks must be a nonempty list of card identifiers')
    options = { ...options, mapping: options.mapping ?? config.move_mapping }
    if (!dryRun) {
      assert(typeof config.move_mapping === 'string' && config.move_mapping.length > 0, 'Configure board.move_mapping before moving cards so harness readers can resolve old identifiers')
      assert.equal(require('node:path').resolve(options.mapping), require('node:path').resolve(config.move_mapping), 'The move must use board.move_mapping')
    }
    const mapping = typeof options.mapping === 'string' ? readMoveMapping(options.mapping, source, target) : null
    const recorded = new Set((mapping?.entries ?? []).map(entry => entry.task_id))
    const recovered = []
    const recoveryMismatches = []
    if (!dryRun && mapping.pending) {
      const pending = mapping.pending
      assert(pending.source === source && pending.target === target, 'Finish the pending project move before starting another')
      const result = await call('moveTask', [source, target, pending.taskId, true, pending.oldIdentifiers, pending.resume])
      assert(Array.isArray(result.moved), 'The board did not answer the pending move')
      for (const entry of result.moved) {
        if (!recorded.has(entry.task_id)) mapping.entries.push(entry)
        recorded.add(entry.task_id)
      }
      recovered.push(...result.moved)
      recoveryMismatches.push(...result.mismatches)
      delete mapping.pending
      writeMoveMapping(options.mapping, mapping)
    }
    const open = (await call('readProjectTasks', [source])).rows.filter(row => !row.done)
    // A named card that the mapping file already names, and that is no longer open here, is skipped.
    // A named card that is not open here and is not recorded may already be in
    // the target: a rerun after a lost reply, or a card someone moved by hand. It
    // is planned like every other card, and its plan then reports alreadyMoved, so
    // the batch records it instead of stopping on it. Only the target is read to
    // find it, and only when a named card is missing from both the source and the
    // mapping file.
    const cards = []
    const skipped = []
    let targetRows = null
    for (const key of options.tasks ?? open.map(row => row.identifier)) {
      const row = open.find(card => card.identifier === key || card._id === key)
      if (row) { cards.push(row); continue }
      const entry = (mapping?.entries ?? []).find(item => item.old_identifier === key || item.task_id === key)
      if (entry) {
        skipped.push({ identifier: key, task_id: entry.task_id, reason: 'named in the mapping file' })
        continue
      }
      if (targetRows === null) targetRows = (await call('readProjectTasks', [target])).rows
      const inTarget = targetRows.find(card => card.identifier === key || card._id === key)
      assert(inTarget, `Card ${key} is not an open card of ${source}`)
      cards.push(inTarget)
    }
    // Every card is planned before any write. A refusal names its card, and an
    // apply stops before its first write when any card is refused.
    const plans = new Map()
    const refused = []
    for (const row of cards) {
      try {
        const plan = await call('planMoveTask', [source, target, row._id])
        assert.equal(plan.verified, true, `The board did not answer the plan for ${row.identifier}`)
        plans.set(row._id, plan)
      } catch (error) {
        refused.push({ identifier: row.identifier, reason: error.message })
      }
    }
    const topLevel = cards.filter(row => plans.get(row._id)?.subIssue === false)
    const topIds = new Set(topLevel.map(row => row._id))
    for (const row of cards) {
      const plan = plans.get(row._id)
      if (plan?.subIssue === true && !topIds.has(plan.parent)) {
        refused.push({ identifier: row.identifier, reason: 'a sub-issue moves with its parent, and its parent is not in this move' })
      }
    }
    if (dryRun) {
      return { source, target, dryRun: true,
        wouldMove: topLevel.map(row => plans.get(row._id)),
        // A card already in the target has nothing to move. It is listed by name
        // so a reader of the dry run sees it as already in the target.
        alreadyInTarget: topLevel.filter(row => plans.get(row._id).alreadyMoved)
          .map(row => ({ identifier: row.identifier, task_id: row._id, reason: 'already in the target' })),
        refused, moved: [], skipped, mismatches: [], ok: refused.length === 0 }
    }
    if (refused.length) {
      throw new Error(`moveTasks refused before any write: ${refused.map(item => `${item.identifier} (${item.reason})`).join('; ')}`)
    }
    const moved = [...recovered]
    const mismatches = [...recoveryMismatches]
    for (const row of topLevel) {
      if (recorded.has(row._id)) {
        skipped.push({ identifier: row.identifier, task_id: row._id, reason: 'named in the mapping file' })
        continue
      }
      const plan = plans.get(row._id)
      if (plan.alreadyMoved) {
        // The card is already in the target and has no resume, so the board has
        // nothing to move. Its plan carries the cards it covers under `moved`,
        // not `cards`, so record those entries and go on to the next card. The
        // original identifier is unknown here, so each entry maps the identifier
        // the card now carries to itself, which canonical() resolves.
        for (const entry of plan.moved) {
          if (recorded.has(entry.task_id)) continue
          mapping.entries.push({ old_identifier: entry.old_identifier || entry.new_identifier,
            new_identifier: entry.new_identifier, task_id: entry.task_id })
          recorded.add(entry.task_id)
        }
        writeMoveMapping(options.mapping, mapping)
        moved.push({ identifier: row.identifier, alreadyMoved: true, moved: plan.moved })
        continue
      }
      const oldIdentifiers = Object.fromEntries(plan.cards.map(card => [card.task_id, card.identifier]))
      mapping.pending = { source, target, taskId: row._id, oldIdentifiers, resume: plan.resume }
      writeMoveMapping(options.mapping, mapping)
      const result = await call('moveTask', [source, target, row._id, true, oldIdentifiers, mapping.pending.resume])
      assert(Array.isArray(result.moved), `The board did not answer the move of ${row.identifier}`)
      for (const entry of result.moved) {
        assert(entry.old_identifier, `Card ${entry.task_id} has no old identifier for the mapping file`)
        if (recorded.has(entry.task_id)) continue
        mapping.entries.push({ old_identifier: entry.old_identifier, new_identifier: entry.new_identifier, task_id: entry.task_id })
        recorded.add(entry.task_id)
      }
      delete mapping.pending
      writeMoveMapping(options.mapping, mapping)
      moved.push({ identifier: row.identifier, alreadyMoved: result.alreadyMoved, moved: result.moved })
      mismatches.push(...result.mismatches.map(item => ({ ...item, card: row.identifier })))
    }
    return { source, target, dryRun: false, moved, skipped, refused: [], mismatches, mapping: options.mapping,
      ok: mismatches.length === 0, verified: mismatches.length === 0 }
  }
  // The number repair renumbers cards on the board host, but the move receipt
  // named by board.move_mapping stays on the controller. The board host returns
  // the entries it changed, and the controller merges them into the receipt and
  // replaces it atomically. On the board host itself the wrapper is a pure
  // pass-through, so the host never reads or writes the receipt path.
  async function repairMovedNumbers(project, options = {}) {
    if (ON_BOARD_HOST) return call('repairMovedNumbers', [project, options])
    assert(!(process.env.HARNESS_BOARD_OUTBOX && !mockTransport),
      'repairMovedNumbers needs a direct board connection, not the write outbox')
    const dryRun = options.dryRun === true
    const receiptFile = dryRun ? null : config.move_mapping
    if (!dryRun) {
      assert(typeof receiptFile === 'string' && receiptFile.length > 0,
        'Configure board.move_mapping before repairing moved numbers, so harness readers can resolve old identifiers')
    }
    const receipt = dryRun ? null : readMoveMapping(receiptFile)
    if (dryRun) return call('repairMovedNumbers', [project, options])
    // Preserve the old identifiers before any host mutation. If the host fails or
    // its reply is lost, the next apply recovers the current identifiers by stable
    // task id, including cards that no longer qualify as damaged.
    if (receipt.pending_repairs) {
      for (const entry of receipt.pending_repairs.entries) {
        const current = await call('readTaskState', [entry.task_id])
        assert(typeof current?.identifier === 'string' && current.identifier.length,
          `The board did not return the identifier for ${entry.task_id}`)
        if (current.identifier !== entry.old_identifier) {
          mergeReceiptEntries(receipt, [{ ...entry, new_identifier: current.identifier }])
        }
      }
      delete receipt.pending_repairs
      writeMoveMapping(receiptFile, receipt)
    }
    if (options.tasks) options = { ...options, tasks: options.tasks.map(key =>
      receipt.entries.find(entry => entry.old_identifier === key)?.task_id ?? key) }
    const plan = await call('repairMovedNumbers', [project, { ...options, dryRun: true }])
    if (!plan.cards.length) return { ...plan, apply: true }
    receipt.pending_repairs = { project,
      entries: plan.cards.map(({ task_id, old_identifier }) => ({ task_id, old_identifier })) }
    writeMoveMapping(receiptFile, receipt)
    const result = await call('repairMovedNumbers', [project,
      { ...options, tasks: plan.cards.map(card => card.task_id) }])
    result.skipped = [...plan.skipped, ...result.skipped]
    mergeReceiptEntries(receipt, result.changed_entries ?? [])
    // A transport retry can return success after skipping cards changed before a
    // lost reply. Reconcile the journal on success too, not just after a failure.
    for (const entry of receipt.pending_repairs.entries) {
      const current = await call('readTaskState', [entry.task_id])
      assert(typeof current?.identifier === 'string' && current.identifier.length,
        `The board did not return the identifier for ${entry.task_id}`)
      if (current.identifier !== entry.old_identifier) {
        mergeReceiptEntries(receipt, [{ ...entry, new_identifier: current.identifier }])
      }
    }
    delete receipt.pending_repairs
    writeMoveMapping(receiptFile, receipt)
    return result
  }
  return Object.freeze({
    ping: () => call('ping', []),
    resolveTask: input => call('resolveTask', [input]),
    taskRelations: task => call('taskRelations', [task]),
    createProject: (identifier, name, description) => call('createProject', [identifier, name, description]),
    addProjectMember: (project, accountUuid) => call('addProjectMember', [project, accountUuid]),
    moveTasks,
    planMoveTask: (source, target, taskId) => call('planMoveTask', [source, target, taskId]),
    moveTask: (...args) => call('moveTask', args),
    repairMovedNumbers,
    archiveProject: (project, options = {}) => call('archiveProject', [project, native && typeof options === 'boolean' ? options : applyFlag(options)]),
    renameProject: (project, name, options = {}) => call('renameProject', [project, name, native && typeof options === 'boolean' ? options : applyFlag(options)]),
    createTask: (project, title, markdown, labels, parent, priority, stage) => call('createTask', [project ?? config.project_identifier, title, markdown, labels, parent, priority, stage]),
    registerStageLabel: title => call('registerStageLabel', [title]),
    registerPlainLabel: title => call('registerPlainLabel', [title]),
    allowProjectStageStatuses: (apply = true) => call('allowProjectStageStatuses', [apply]),
    repairCardKinds: (apply = false, status, options) => repairCardKindsInBatches(apply, status, options),
    readProjectTasks: project => call('readProjectTasks', [project ?? config.project_identifier]),
    readSupervisionBoard: options => call('readSupervisionBoard', options === undefined ? [] : [options]),
    readSelectedBoard: options => call('readSelectedBoard', [options]),
    readPreparerBoard: () => call('readPreparerBoard', []),
    readKnowledgeBoard: options => call('readKnowledgeBoard', options === undefined ? [] : [options]),
    readStatusCatalog: () => call('readStatusCatalog', []),
    readStatusSetPlan: () => call('readStatusSetPlan', []),
    readLabelCatalog: () => call('readLabelCatalog', []),
    readBoardExport: () => call('readBoardExport', []),
    readStageStatusInventory: () => call('readStageStatusInventory', []),
    readTaskComments: task => call('readTaskComments', [task]),
    readTaskDescription: task => call('readTaskDescription', [task]),
    readTaskState: task => call('readTaskState', [task]),
    readLandedDoc: (kind, id) => call('readLandedDoc', [kind, id]),
    readProjectState: (identifier, accountUuid) => call('readProjectState', [identifier, accountUuid]),
    readWriteState: (operation, args, writeId) => call('readWriteState', [operation, args, writeId]),
    readTaskAttachmentLinks: (task, identifiers) => call('readTaskAttachmentLinks', [task, identifiers]),
    readTaskActivity: identifiers => call('readTaskActivity', [identifiers]),
    setTaskDescription: (task, markdown) => call('setTaskDescription', [task, markdown]),
    setTaskDescriptionMarkup: (task, markup) => call('setTaskDescriptionMarkup', [task, markup]),
    setTaskTitle: (task, title) => call('setTaskTitle', [task, title]),
    setTaskStage: (task, stage, guard) => call('setTaskStage', guard === undefined ? [task, stage] : [task, stage, guard]),
    setTaskPriority: (task, priority) => call('setTaskPriority', [task, priority]),
    setTaskLabels: (task, titles) => call('setTaskLabels', [task, titles]),
    addTaskLabel: (task, title, refuseIf) => call('addTaskLabel', [task, title, refuseIf]),
    setTaskAssignee: (task, accountUuid) => call('setTaskAssignee', [task, accountUuid]),
    clearTaskAssignee: task => call('clearTaskAssignee', [task]),
    agentPersonStatus: accountUuid => call('agentPersonStatus', [accountUuid]),
    resolvePersonByEmail: email => call('resolvePersonByEmail', [email]),
    verifyAgentEmailPerson: () => call('verifyAgentEmailPerson', []),
    repairTaskStageStatus: (task, value) => call('repairTaskStageStatus', [task, value]),
    migrateStageLabelsToStatus: (apply = false, merged = [], options) => migrateStageLabelsInBatches(apply, merged, options),
    addTaskBlockedBy: (task, blockerId) => call('addTaskBlockedBy', [task, blockerId]),
    removeTaskBlockedBy: (task, blockerId) => call('removeTaskBlockedBy', [task, blockerId]),
    // An owner decision card: the owner-decision label, assigned to the owner.
    createOwnerDecisionCard: async (project, title, markdown, ownerAccountUuid) => {
      const created = await call('createTask', [project ?? config.project_identifier, title, markdown, ['owner-decision'], null])
      await call('setTaskAssignee', [created.taskId, ownerAccountUuid]).catch(error => {
        throw new Error(`Owner decision card ${created.identifier} was created, but its owner assignment failed: ${error.message}`)
      })
      return created
    },
    attachTaskFile: (task, name, contentType, dataBase64) => call('attachTaskFile', [task, name, contentType, dataBase64]),
    upsertTaskComment: (task, marker, text) => call('upsertTaskComment', [task, marker, text]),
    postTaskComment: (task, text) => call('postTaskComment', [task, text]),
    postTaskCommentOnce: (task, marker, text, links = []) => call('postTaskCommentOnce', [task, marker, text, links]),
    findTaskComment: (task, marker) => call('findTaskComment', [task, marker]),
    close: closeSession,
  })
}

module.exports = { createBoard, assertRegisteredOperation, WRITE_OPERATIONS, attachmentFileLink, canonical: movedIdentifier, defaults }

// Started in the background by the first caller on a host. The remote program never reaches this line.
if (require.main === module && process.argv[2] === '--host-broker') {
  // The file may have changed since the parent loaded it. Refuse that observed
  // mismatch before opening its socket, so the caller uses its captured private code.
  if (process.argv[5] && process.argv[5] !== OWN_CODE_DIGEST) {
    process.stderr.write('host broker code changed before startup\n')
    process.exit(1)
  }
  runHostBroker(process.argv[3], JSON.parse(process.argv[4]))
}
