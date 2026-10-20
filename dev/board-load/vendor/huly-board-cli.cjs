// Command line front end for scripts/huly-board.cjs.
// The Python supervision scripts and shell launchers call it with one JSON
// request on standard input and receive one JSON result. A request names the
// operation, its positional arguments, and optional connection settings.
// Example: {"operation":"resolveTask","args":["630"]}
// Create project: {"operation":"createProject","args":["JH","jake-harness","Agent fleet harness"]}
// Result:  {"ok":true,"result":{...}} or {"ok":false,"error":"..."} with exit 1.
// With --stream, each line of standard input is one request and each line of output is its result.
// Common tasks take one command line instead, such as
// node board/huly-board-cli.cjs stage TASK-630 stage:queued. Run it with --help for the list.
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')
const { createBoard, defaults } = require('./huly-board.cjs')

function errorResult(error) {
  return { ok: false, error: error.message, diagnostic: error.diagnostic,
    ...(typeof error.transport === 'boolean' ? { transport: error.transport } : {}) }
}

async function runCli(json, create = createBoard, recheck) {
  const request = JSON.parse(json)
  if (!request || typeof request !== 'object') throw new Error('The Huly CLI expects a JSON request object')
  const board = create({ ...(request.config ?? {}), ...(recheck ? { recheck } : {}) })
  try {
    const fn = board[request.operation]
    if (typeof fn !== 'function') throw new Error(`Unknown board operation ${request.operation}`)
    return await fn(...(Array.isArray(request.args) ? request.args : []))
  } finally {
    // The board keeps one long lived ssh child per process. A CLI run is one
    // request, so the child must be killed before the process can end,
    // otherwise the process waits on the child's pipes forever and every
    // Python supervision call hangs until its own timeout.
    if (typeof board.close === 'function') await board.close()
  }
}

// --stream reads one JSON request per line and writes one JSON result per line, in
// order. One board client serves the whole stream, so a caller that makes many
// calls starts one process. Every request must carry the same config.
async function runStream(input, output, create = createBoard) {
  const lines = require('node:readline').createInterface({ input, terminal: false })
  let board = null
  let config = null
  try {
    for await (const line of lines) {
      if (line.trim() === '') continue
      const began = Date.now()
      try {
        const request = JSON.parse(line)
        if (!request || typeof request !== 'object') throw new Error('The Huly CLI expects a JSON request object')
        const nextConfig = JSON.stringify(request.config ?? {})
        if (board === null) {
          board = create({ ...(request.config ?? {}) })
          config = nextConfig
        } else if (nextConfig !== config) throw new Error('Board settings changed during a stream')
        const fn = board[request.operation]
        if (typeof fn !== 'function') throw new Error(`Unknown board operation ${request.operation}`)
        // Each answer carries the seconds its operation took, so a caller can log each board call of a stream.
        const result = await fn(...(Array.isArray(request.args) ? request.args : []))
        output.write(JSON.stringify({ ok: true, result, seconds: (Date.now() - began) / 1000 }) + '\n')
      } catch (error) {
        output.write(JSON.stringify({ ...errorResult(error), seconds: (Date.now() - began) / 1000 }) + '\n')
      }
    }
  } finally {
    if (board !== null && typeof board.close === 'function') await board.close()
  }
}

// The host ends each request at its own deadline: the configured limit plus this margin, as hostRequestLimit sets it.
const HOST_DEADLINE_MARGIN_MS = 5000

// renewTimeoutMs in the first request: the host's own call deadline, which bounds its recheck. The host ends this
// process at that deadline anyway, so waiting that long here never outlives the host. A first request that names
// none waits for the host deadline that its own config sets.
function renewWaitOf(line) {
  let request = {}
  try { request = JSON.parse(line) ?? {} } catch { /* runCli refuses the same line */ }
  if (Number.isSafeInteger(request.renewTimeoutMs) && request.renewTimeoutMs > 0) return request.renewTimeoutMs
  const exporting = request.operation === 'readBoardExport'
  const configured = request.config?.[exporting ? 'board_export_timeout' : 'timeout']
  const limit = Number.isSafeInteger(configured) && configured > 0 ? configured : defaults[exporting ? 'board_export_timeout' : 'timeout']
  return limit + HOST_DEADLINE_MARGIN_MS
}

function runGuardedCli(create = createBoard) {
  const readline = require('node:readline')
  const rl = readline.createInterface({ input: process.stdin, terminal: false })
  const pending = new Map()
  let started = false
  let sequence = 0
  // The host's recheck runs inside this wait, so the host names the wait in its first request.
  let renewWaitMs = 0
  const renew = phase => new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Host proof renewal timed out')) }, renewWaitMs)
    pending.set(id, { resolve, reject, timer })
    process.stdout.write(JSON.stringify({ renew: id, phase }) + '\n')
  })
  rl.on('line', line => {
    if (Buffer.byteLength(line) > 1024 * 1024) { rl.close(); return }
    if (!started) {
      started = true
      renewWaitMs = renewWaitOf(line)
      runCli(line, create, renew).then(
        result => process.stdout.write(JSON.stringify({ ok: true, result }) + '\n'),
        error => { process.stdout.write(JSON.stringify(errorResult(error)) + '\n'); process.exitCode = 1 }
      ).finally(() => { rl.close(); process.stdin.pause() })
      return
    }
    let reply
    try { reply = JSON.parse(line) } catch { rl.close(); return }
    const waiter = pending.get(reply.renew)
    if (!waiter || typeof reply.ok !== 'boolean') { rl.close(); return }
    pending.delete(reply.renew)
    clearTimeout(waiter.timer)
    if (reply.ok) waiter.resolve()
    else waiter.reject(new Error(reply.error || 'Host proof renewal refused'))
  })
  rl.on('close', () => {
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Host proof stream closed')) }
    pending.clear()
  })
}

// One command per common board task. A write runs an existing operation and
// then reads the card back, so the command prints what the board holds after
// the write. The operations take the card's internal id, so each command first
// resolves the number or identifier it was given.
const isStageTitle = title => title.startsWith('stage:')

// The card as the board reads it now: stage, labels, assignee and blocked-by.
const cardView = card => ({
  identifier: card.identifier, stage: card.stage, statusName: card.statusName, expectedStatus: card.expectedStatus,
  labels: card.labels.map(label => label.title), assignee: card.assignee, blocked_by: card.related_tasks.blocked,
})
const readBackOf = async (board, card) => cardView(await board.resolveTask(card.identifier))

async function setStage(board, task, stage) {
  const card = await board.resolveTask(task)
  const write = await board.setTaskStage(card._id, stage)
  return { state: write.state, readBack: await readBackOf(board, card) }
}

// A close takes one reason from this fixed set. The reason and its evidence link
// go in one closing comment, and the card's stage moves to the closed status that
// the reason names. No label carries the reason. Each stage is a native status in
// board/huly-board.cjs (harnessStatusSet).
const CLOSED_STAGE_OF = {
  done: 'stage:closed',
  superseded: 'stage:closed superseded',
  obsolete: 'stage:closed obsolete',
  'wont-do': 'stage:closed by owner decision',
  duplicate: 'stage:closed',
}
const CLOSE_REASONS = Object.keys(CLOSED_STAGE_OF)
const COMMIT_SHAPE = /^[0-9a-f]{7,40}$/
// An evidence link is a URL, a card identifier, a commit hash or a file and line.
const LINK_SHAPES = [/^https?:\/\/\S+$/, /^[A-Z][A-Z0-9]*-\d+$/, COMMIT_SHAPE, /^\S+:\d+$/]
// A wont-do ruling is cited by a URL or a file and line.
const RULING_SHAPES = [/^https?:\/\/\S+$/, /^\S+:\d+$/]
function closeProject() {
  const loader = join(__dirname, '../lib/harness_config.py')
  const result = spawnSync('python3', ['-c',
    'import json,runpy,sys; c=runpy.run_path(sys.argv[1])["load"](); print(json.dumps(c["project"]))', loader], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error('Cannot read project settings for the done commit check')
  return JSON.parse(result.stdout)
}

// The named commit must be a commit of the repository and an ancestor of origin/main.
// The check reads the local origin/main ref. A stale ref refuses a new commit and
// never accepts one that is not on main, so fetch first when the commit is new.
function commitOnMain(repo, evidence, main = 'main') {
  if (!COMMIT_SHAPE.test(evidence)) throw new Error(`Closing as done needs a commit hash, not ${evidence}`)
  const found = spawnSync('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', `${evidence}^{commit}`], { encoding: 'utf8' })
  if (found.status !== 0) throw new Error(`Closing as done needs a commit in ${repo}, and ${evidence} is not one`)
  const sha = found.stdout.trim()
  const ref = `refs/remotes/origin/${main}`
  const onMain = spawnSync('git', ['-C', repo, 'merge-base', '--is-ancestor', sha, ref], { encoding: 'utf8' })
  if (onMain.status === 1) throw new Error(`Closing as done needs commit ${sha}, and it is not on origin/${main}`)
  if (onMain.status !== 0) throw new Error(`The check of ${sha} against origin/${main} could not run: ${onMain.stderr.trim()}`)
}

// Refuses a close the board must not see. It runs before the board is opened, so a
// refused close writes nothing.
function checkClose(args, repo) {
  const [, reason, evidence, wordsFile] = args
  if (!CLOSE_REASONS.includes(reason)) throw new Error(`Unknown closure reason ${reason}. Use one of ${CLOSE_REASONS.join(', ')}`)
  if (reason !== 'wont-do' && wordsFile !== undefined) throw new Error('Only wont-do takes an owner words file')
  if (reason === 'done') {
    const project = repo === undefined ? closeProject() : { checkout: repo, main_branch: 'main' }
    commitOnMain(project.checkout, evidence, project.main_branch)
  }
  else if (reason === 'wont-do') {
    if (!RULING_SHAPES.some(shape => shape.test(evidence))) throw new Error(`wont-do needs a ruling link, a URL or file:line, not ${evidence}`)
    if (wordsFile === undefined) throw new Error("wont-do needs the owner's words in a file, quoted verbatim")
    if (readFileSync(wordsFile, 'utf8').trim() === '') throw new Error("The owner's words file is empty")
  } else if (!LINK_SHAPES.some(shape => shape.test(evidence))) {
    throw new Error(`${reason} needs an evidence link: a URL, a card identifier, a commit hash or file:line, not ${evidence}`)
  }
}

// The closing comment names the reason and its evidence. wont-do quotes the owner
// words below it, set apart and verbatim. The last line is the marker a retry finds.
function closingText(reason, evidence, words) {
  const quoted = words === undefined ? []
    : ['', "Owner's words, verbatim:", '', ...words.replace(/\n+$/, '').split('\n').map(line => `> ${line}`)]
  return [`Closed as ${reason}. Evidence: ${evidence}.`, ...quoted, '', closeMarker(reason)].join('\n')
}
const closeMarker = reason => `close-reason:${reason}`

async function closeCard(board, task, reason, evidence, wordsFile) {
  const words = wordsFile === undefined ? undefined : readFileSync(wordsFile, 'utf8')
  const card = await board.resolveTask(task)
  const before = cardView(card)
  const { state, readBack } = await setStage(board, task, CLOSED_STAGE_OF[reason])
  const kept = before.labels.filter(title => !isStageTitle(title))
  const lost = kept.filter(title => !readBack.labels.includes(title))
  if (lost.length) throw new Error(`Closing ${readBack.identifier} lost non-stage labels: ${lost.join(', ')}`)
  const marker = closeMarker(reason)
  const links = /^https?:\/\//.test(evidence) ? [evidence] : []
  const write = await board.postTaskCommentOnce(card._id, marker, closingText(reason, evidence, words), links)
  const read = await board.findTaskComment(card._id, marker)
  return { state, readBack, status: readBack.statusName, keptLabels: kept, reason, comment: { state: write.state, present: read.present, count: read.count } }
}

async function commentOnce(board, task, marker, file) {
  const card = await board.resolveTask(task)
  const write = await board.postTaskCommentOnce(card._id, marker, readFileSync(file, 'utf8'))
  const read = await board.findTaskComment(card._id, marker)
  return { identifier: card.identifier, state: write.state, commentId: write.commentId ?? null, present: read.present, count: read.count }
}

function blockedBy(operation) {
  return async (board, task, blocker) => {
    const card = await board.resolveTask(task)
    const other = await board.resolveTask(blocker)
    const write = await board[operation](card._id, other._id)
    return { state: write.state, blocker: other.identifier, readBack: await readBackOf(board, card) }
  }
}

async function createCard(board, project, title, file, stage) {
  const created = await board.createTask(project, title, readFileSync(file, 'utf8'), [], null, null, stage)
  // The card exists once createTask answers. A failed read-back must say so and give the identifier, or a retry makes a duplicate.
  try {
    return { identifier: created.identifier, readBack: await readBackOf(board, created) }
  } catch (error) {
    throw Object.assign(new Error(`The card ${created.identifier} was created, but its read-back failed: ${error.message}. ` +
      `Do not create it again. Read it with: node board/huly-board-cli.cjs read ${created.identifier}`),
    { transport: false, diagnostic: { operation: 'createTask', identifier: created.identifier, created: true } })
  }
}

async function getDescription(board, task, file) {
  const card = await board.resolveTask(task)
  const read = await board.readTaskDescription(card._id)
  writeFileSync(file, read.markdown)
  return { identifier: card.identifier, file, bytes: Buffer.byteLength(read.markdown), fileMatches: readFileSync(file, 'utf8') === read.markdown }
}

async function setDescription(board, task, file) {
  const card = await board.resolveTask(task)
  const write = await board.setTaskDescription(card._id, readFileSync(file, 'utf8'))
  const read = await board.readTaskDescription(card._id)
  return { identifier: card.identifier, reference: write.reference, readBack: read.markdown }
}

const COMMANDS = {
  read: { params: ['TASK'], about: 'stage, statusName, labels, assignee and blocked_by in one call', run: async (board, task) => cardView(await board.resolveTask(task)) },
  stage: { params: ['TASK', 'STAGE'], about: 'set the stage, such as stage:queued, and print the read-back', run: setStage },
  close: { params: ['TASK', 'REASON', 'EVIDENCE'], optional: ['WORDS_FILE'], about: `move the card to closed for REASON (${CLOSE_REASONS.join(', ')}), post one closing comment with the EVIDENCE link, and print the read-back. wont-do takes WORDS_FILE, the owner's words, quoted verbatim`, check: checkClose, run: closeCard },
  'comment-once': { params: ['TASK', 'MARKER', 'TEXT_FILE'], about: 'post the file text once under MARKER (the text must contain MARKER)', run: commentOnce },
  'blocked-by add': { params: ['TASK', 'BLOCKER'], about: 'add BLOCKER to the blocked-by list and print the read-back', run: blockedBy('addTaskBlockedBy') },
  'blocked-by remove': { params: ['TASK', 'BLOCKER'], about: 'remove BLOCKER from the blocked-by list and print the read-back', run: blockedBy('removeTaskBlockedBy') },
  create: { params: ['PROJECT', 'TITLE', 'DESCRIPTION_FILE', 'STAGE'], about: 'add a card titled TITLE, described by the file, at STAGE, and print the read-back', run: createCard },
  'description get': { params: ['TASK', 'FILE'], about: 'write the card description to FILE, replacing what FILE held', run: getDescription },
  'description set': { params: ['TASK', 'FILE'], about: 'replace the card description with the text of FILE and print the read-back', run: setDescription },
}

const usageOf = (name, command) => [name, ...command.params, ...(command.optional ?? []).map(word => `[${word}]`)].join(' ')

function usageText() {
  const rows = Object.entries(COMMANDS).map(([name, command]) => [usageOf(name, command), command.about])
  const width = Math.max(...rows.map(([usage]) => usage.length)) + 2
  return [
    'Usage: node board/huly-board-cli.cjs COMMAND ARGS   (with no arguments it reads one JSON request on stdin)',
    'Usage: node board/huly-board-cli.cjs --stream   (reads one JSON request per line on stdin, prints one result per line)',
    'Tasks are numbers or identifiers such as TASK-630. Every command prints one JSON result.',
    '',
    ...rows.map(([usage, about]) => `  ${usage.padEnd(width)}${about}`),
  ].join('\n')
}

async function runCommand(argv, create = createBoard, repo) {
  const twoWords = argv.slice(0, 2).join(' ')
  const name = Object.hasOwn(COMMANDS, twoWords) ? twoWords : argv[0]
  if (!Object.hasOwn(COMMANDS, name)) throw new Error(`Unknown board command ${argv[0]}. Run node board/huly-board-cli.cjs --help`)
  const command = COMMANDS[name]
  const args = argv.slice(name.split(' ').length)
  const optional = command.optional ?? []
  if (args.length < command.params.length || args.length > command.params.length + optional.length) {
    throw new Error(`Usage: node board/huly-board-cli.cjs ${usageOf(name, command)}`)
  }
  // A check refuses here, before the board is opened, so a refused write opens nothing.
  if (command.check) command.check(args, repo)
  const board = create({})
  try {
    return await command.run(board, ...args)
  } finally {
    if (typeof board.close === 'function') await board.close()
  }
}

if (require.main === module) {
  const argv = process.argv.slice(2)
  // A lone "-" is the stdin request, as the Python callers pass it. It is not a command.
  const readsStdin = argv.length === 0 || (argv.length === 1 && argv[0] === '-')
  if (argv[0] === '--guarded') runGuardedCli()
  else if (argv[0] === '--stream') runStream(process.stdin, process.stdout).catch(() => { process.exitCode = 1 })
  else if (argv[0] === '--help' || argv[0] === '-h') console.log(usageText())
  else if (!readsStdin) {
    runCommand(argv).then(
      result => console.log(JSON.stringify({ ok: true, result })),
      error => { console.log(JSON.stringify(errorResult(error))); process.exitCode = 1 }
    )
  } else {
  let input = ''
  process.stdin.on('data', chunk => { input += chunk })
  process.stdin.on('end', async () => {
    try {
      console.log(JSON.stringify({ ok: true, result: await runCli(input) }))
    } catch (error) {
      console.log(JSON.stringify(errorResult(error)))
      process.exitCode = 1
    }
  })
  }
}

module.exports = { runCli, runGuardedCli, runStream, runCommand, usageText }
