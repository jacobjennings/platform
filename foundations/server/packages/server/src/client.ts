//
// Copyright © 2022 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import type { LoginInfoWithWorkspaces } from '@hcengineering/account-client'
import core, {
  generateId,
  matchQuery,
  TxProcessor,
  type Account,
  type AccountUuid,
  type Class,
  type Doc,
  type DocumentQuery,
  type Domain,
  type DomainParams,
  type DomainResult,
  type FindOptions,
  type FindResult,
  type LoadModelResponse,
  type MeasureContext,
  type OperationDomain,
  type PermissionsGrant,
  type PersonId,
  type Ref,
  type SearchOptions,
  type SearchQuery,
  type SearchResult,
  type SessionData,
  type SnapshotChange,
  type SnapshotFailure,
  type SnapshotPage,
  type SnapshotRequest,
  type SnapshotSection,
  type SnapshotSectionPage,
  type SocialId,
  type Space,
  type Timestamp,
  type Tx,
  type TxCUD,
  type TxResult,
  type WorkspaceDataId,
  type WorkspaceIds
} from '@hcengineering/core'
import { PlatformError, unknownError } from '@hcengineering/platform'
import {
  BackupClientOps,
  createBroadcastEvent,
  estimateDocSize,
  SessionDataImpl,
  type ClientSessionCtx,
  type ConnectionSocket,
  type OneSecondCounters,
  type Pipeline,
  type Session,
  type SessionRequest,
  type StatisticsElement
} from '@hcengineering/server-core'
import { type Token } from '@hcengineering/server-token'

const useReserveContext = (process.env.USE_RESERVE_CTX ?? 'true') === 'true'

// A snapshot request is bounded so one call cannot ask for an unbounded board.
const SNAPSHOT_MAX_SECTIONS = 16
const SNAPSHOT_DEFAULT_LIMIT = 200
const SNAPSHOT_MAX_LIMIT = 1000
// Rows reported per section in the final change set.
const SNAPSHOT_CHANGES_LIMIT = 2000
const SNAPSHOT_KEY = /^[a-zA-Z0-9_.-]{1,64}$/

interface SnapshotCursorState {
  // Pinned server time for every page of the read.
  v: Timestamp
  // Space the read is scoped to.
  s: Ref<Space>
  // Section keys the token was issued for, in request order.
  k: string[]
  // Last row identity read per section.
  c: Record<string, Ref<Doc>>
  // Exact row count per section, once known.
  t: Record<string, number>
}

function encodeSnapshotCursor (state: SnapshotCursorState): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url')
}

function isValidTimestamp (value: unknown): value is Timestamp {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function decodeSnapshotCursor (cursor: string): SnapshotCursorState {
  let parsed: any
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch (err) {
    throw new Error('The snapshot continuation token is not valid')
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !isValidTimestamp(parsed.v) ||
    typeof parsed.s !== 'string' ||
    !Array.isArray(parsed.k) ||
    parsed.k.some((key: unknown) => typeof key !== 'string') ||
    parsed.c === null ||
    typeof parsed.c !== 'object' ||
    parsed.t === null ||
    typeof parsed.t !== 'object'
  ) {
    throw new Error('The snapshot continuation token is not valid')
  }
  return parsed as SnapshotCursorState
}

// A scoped section is always constrained to the request space. A caller cannot
// widen it by passing another space in its own query.
function snapshotSectionQuery (section: SnapshotSection, space: Ref<Space>): DocumentQuery<Doc> {
  if (section.scoped === false) return section.query
  if (section.query.space !== undefined && section.query.space !== space) {
    throw new Error(`Snapshot section ${section.key} asks for a space outside the request space`)
  }
  return { ...section.query, space }
}

function withSnapshotCursor (query: DocumentQuery<Doc>, cursor: Ref<Doc>): DocumentQuery<Doc> {
  const existing = query._id
  const idQuery =
    existing !== null && typeof existing === 'object' && !Array.isArray(existing) ? { ...(existing as object) } : {}
  return { ...query, _id: { ...idQuery, $gt: cursor } }
}

/**
 * @public
 */
export class ClientSession implements Session {
  createTime = Date.now()
  requests = new Map<string, SessionRequest>()
  binaryMode: boolean = false
  useCompression: boolean = false
  sessionId = ''
  lastRequest = Date.now()

  lastPing: number = Date.now()

  total: StatisticsElement = { find: 0, tx: 0 }
  current: StatisticsElement = { find: 0, tx: 0 }
  // Diagnostics only: result count of the last find response per request id.
  requestResultCount = new Map<number | string, number>()
  requestQuery = new Map<number | string, { class: string, queryKeys: string[] }>()
  mins5: StatisticsElement = { find: 0, tx: 0 }
  measures: { id: string, message: string, time: 0 }[] = []

  ops: BackupClientOps | undefined
  opsPipeline: Pipeline | undefined
  isAdmin: boolean

  constructor (
    readonly token: Token,
    readonly workspace: WorkspaceIds,
    readonly account: Account,
    readonly info: LoginInfoWithWorkspaces,
    readonly allowUpload: boolean,
    readonly counter: OneSecondCounters
  ) {
    this.isAdmin = this.token.extra?.admin === 'true'
  }

  getUser (): AccountUuid {
    return this.token.account
  }

  getUserSocialIds (): PersonId[] {
    return this.account.socialIds
  }

  getSocialIds (): SocialId[] {
    return this.info.socialIds
  }

  getRawAccount (): Account {
    return this.account
  }

  isUpgradeClient (): boolean {
    return this.token.extra?.model === 'upgrade'
  }

  getMode (): string {
    return this.token.extra?.mode ?? 'normal'
  }

  updateLast (): void {
    this.lastRequest = Date.now()
  }

  async ping (ctx: ClientSessionCtx): Promise<void> {
    this.lastRequest = Date.now()
    ctx.sendPong()
  }

  async loadModel (ctx: ClientSessionCtx, lastModelTx: Timestamp, hash?: string): Promise<void> {
    try {
      this.includeSessionContext(ctx)
      const result = await this.counter.withCounter('loadModel', 1, () =>
        ctx.pipeline.loadModel(ctx.ctx, lastModelTx, hash)
      )

      await this.counter.withCounter('clientSendMemory', this.estimateSize(result), () =>
        ctx.sendResponse(ctx.requestId, result)
      )
    } catch (err) {
      await ctx.sendError(ctx.requestId, 'Failed to loadModel', unknownError(err))
      ctx.ctx.error('failed to loadModel', { err })
    }
  }

  async loadModelRaw (ctx: ClientSessionCtx, lastModelTx: Timestamp, hash?: string): Promise<LoadModelResponse | Tx[]> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    this.includeSessionContext(ctx)
    return await ctx.ctx.with('load-model', {}, (_ctx) => ctx.pipeline.loadModel(_ctx, lastModelTx, hash))
  }

  private getPermissionsGrant (): PermissionsGrant | undefined {
    if (this.token.grant == null) {
      return
    }

    return {
      spaces: this.token.grant?.spaces as Ref<Space>[] | undefined,
      grantedBy: this.token.grant?.grantedBy
    }
  }

  includeSessionContext (ctx: ClientSessionCtx): void {
    const dataId = this.workspace.dataId ?? (this.workspace.uuid as unknown as WorkspaceDataId)
    const contextData = new SessionDataImpl(
      this.account,
      this.sessionId,
      this.isAdmin,
      undefined,
      {
        ...this.workspace,
        dataId
      },
      false,
      undefined,
      undefined,
      ctx.pipeline.context.modelDb,
      ctx.socialStringsToUsers,
      this.token.extra?.service ?? '🤦‍♂️user',
      this.getPermissionsGrant()
    )
    ctx.ctx.contextData = contextData
  }

  findAllRaw<T extends Doc>(
    ctx: ClientSessionCtx,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: FindOptions<T>
  ): Promise<FindResult<T>> {
    this.lastRequest = Date.now()
    this.total.find++
    this.current.find++
    this.includeSessionContext(ctx)
    return ctx.pipeline.findAll(ctx.ctx, _class, query, options)
  }

  estimateSize (doc: any): number {
    return Math.round((estimateDocSize(doc) * 10) / (1024 * 1024)) / 10
  }

  async findAll<T extends Doc>(
    ctx: ClientSessionCtx,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: FindOptions<T>
  ): Promise<void> {
    if (ctx.requestId !== undefined) {
      this.requestQuery.set(ctx.requestId, { class: _class, queryKeys: Object.keys(query) })
    }
    const domain = ctx.pipeline.context.hierarchy.findDomain(_class) ?? ''
    if (domain === '') {
      // Unknown domain, send error
      await ctx.sendError(
        ctx.requestId,
        'Invalid class name is passed. Failed to findAll.',
        new Error('Unknown domain')
      )
      return
    }
    try {
      const result = await this.counter.withCounter('find-' + domain, 1, () =>
        this.findAllRaw(ctx, _class, query, options)
      )
      if (ctx.requestId !== undefined) {
        this.requestResultCount.set(ctx.requestId, result.length)
      }

      await this.counter.withCounter('clientSendMemory', this.estimateSize(result), () =>
        ctx.sendResponse(ctx.requestId, result)
      )
    } catch (err) {
      await ctx.sendError(ctx.requestId, 'Failed to findAll', unknownError(err))
      ctx.ctx.error('failed to findAll', { err })
    }
  }

  async findSnapshot (ctx: ClientSessionCtx, request: SnapshotRequest): Promise<void> {
    try {
      const result = await this.counter.withCounter('findSnapshot', 1, () => this.findSnapshotRaw(ctx, request))
      await this.counter.withCounter('clientSendMemory', this.estimateSize(result), () =>
        ctx.sendResponse(ctx.requestId, result)
      )
    } catch (err) {
      await ctx.sendError(ctx.requestId, 'Failed to findSnapshot', unknownError(err))
      ctx.ctx.error('failed to findSnapshot', { err })
    }
  }

  /**
   * One bounded page of a versioned, multi-section read.
   *
   * The first page pins a server timestamp as the read version and returns exact
   * section counts. Every later page continues from an opaque token that carries
   * that version and one row cursor per section.
   *
   * Rows are read in `_id` order with a strict `_id > cursor` filter, so a row
   * that moves during the read is never returned twice. The last page also
   * returns every row written since the pinned version, with whether it still
   * matches its section query and whether it was removed. That change set is how
   * a caller learns about a row that moved behind its cursor and would otherwise
   * disappear from the read.
   *
   * Every query goes through the same pipeline as `findAll`, so workspace
   * membership and per-space read security apply unchanged. Scoped sections are
   * additionally constrained to the request space, so the call cannot widen a
   * read into another project.
   *
   * A failed section is reported in `failures` and does not advance its cursor,
   * so the next page retries it. The other sections still return rows.
   */
  async findSnapshotRaw (ctx: ClientSessionCtx, request: SnapshotRequest): Promise<SnapshotPage> {
    this.lastRequest = Date.now()
    this.total.find++
    this.current.find++
    this.includeSessionContext(ctx)
    const hierarchy = ctx.pipeline.context.hierarchy

    if (request === null || typeof request !== 'object') {
      throw new Error('A snapshot request is required')
    }
    if (typeof request.space !== 'string' || request.space === '') {
      throw new Error('A snapshot space is required')
    }
    const space = request.space
    const sections = request.sections
    if (!Array.isArray(sections) || sections.length === 0) {
      throw new Error('A snapshot request needs at least one section')
    }
    if (sections.length > SNAPSHOT_MAX_SECTIONS) {
      throw new Error(`A snapshot request allows at most ${SNAPSHOT_MAX_SECTIONS} sections`)
    }
    const keys: string[] = []
    const normalized: SnapshotSection[] = sections.map((section) => {
      if (section === null || typeof section !== 'object') {
        throw new Error('A snapshot section is required')
      }
      if (typeof section.key !== 'string' || !SNAPSHOT_KEY.test(section.key)) {
        throw new Error('A snapshot section key must be 1 to 64 letters, digits, dots, dashes or underscores')
      }
      if (keys.includes(section.key)) {
        throw new Error(`Snapshot section ${section.key} is repeated`)
      }
      keys.push(section.key)
      if (typeof section._class !== 'string' || !hierarchy.hasClass(section._class)) {
        throw new Error(`Snapshot section ${section.key} names an unknown class`)
      }
      if (section.query === null || typeof section.query !== 'object' || Array.isArray(section.query)) {
        throw new Error(`Snapshot section ${section.key} needs a query object`)
      }
      for (const key of Object.keys(section.query)) {
        if (key.startsWith('$')) {
          throw new Error(`Snapshot section ${section.key} query cannot use the top level operator ${key}`)
        }
      }
      const limit =
        section.limit === undefined
          ? SNAPSHOT_DEFAULT_LIMIT
          : Math.min(Math.max(Math.trunc(section.limit), 1), SNAPSHOT_MAX_LIMIT)
      return { ...section, limit, query: { ...section.query } }
    })

    const token = request.cursor === undefined ? undefined : decodeSnapshotCursor(request.cursor)
    if (token !== undefined) {
      if (token.s !== space || token.k.length !== keys.length || token.k.some((key, index) => key !== keys[index])) {
        throw new Error('The snapshot continuation token belongs to another read')
      }
    }
    const state: SnapshotCursorState = token ?? { v: Date.now(), s: space, k: keys, c: {}, t: {} }

    // The pipeline applies the workspace and space read rules. A space the
    // account cannot read is therefore not found here either.
    const spaces = await ctx.pipeline.findAll(ctx.ctx, core.class.Space, { _id: space }, { limit: 1, showArchived: true })
    if (spaces.length === 0) {
      throw new Error('The snapshot space is not visible to this account')
    }

    const failures: SnapshotFailure[] = []
    const pages: SnapshotSectionPage[] = []
    for (const section of normalized) {
      if (section.firstPageOnly === true && token !== undefined) {
        pages.push({ key: section.key, docs: [], more: false })
        continue
      }
      try {
        const first = state.c[section.key] === undefined
        const base = snapshotSectionQuery(section, space)
        const query = first ? base : withSnapshotCursor(base, state.c[section.key])
        const options: FindOptions<Doc> = {
          limit: section.limit,
          sort: { _id: 1 },
          showArchived: true,
          total: first
        }
        const docs = await ctx.pipeline.findAll(ctx.ctx, section._class, query, options)
        if (first) {
          state.t[section.key] = docs.total ?? docs.length
        }
        if (docs.length > 0) {
          state.c[section.key] = docs[docs.length - 1]._id
        }
        pages.push({
          key: section.key,
          docs,
          ...(first ? { total: state.t[section.key] } : {}),
          more: docs.length === section.limit
        })
      } catch (err: any) {
        failures.push({ key: section.key, message: String(err?.message ?? err) })
        pages.push({ key: section.key, docs: [], more: false })
      }
    }

    const anyMore = pages.some((page) => page.more)
    let changes: SnapshotChange[] | undefined
    if (request.includeChanges === true && !anyMore) {
      changes = []
      for (const section of normalized) {
        if (section.firstPageOnly === true) continue
        try {
          const base = snapshotSectionQuery(section, space)
          const modified = await ctx.pipeline.findAll(
            ctx.ctx,
            section._class,
            { ...base, modifiedOn: { $gte: state.v } },
            { limit: SNAPSHOT_CHANGES_LIMIT, sort: { _id: 1 }, showArchived: true }
          )
          for (const doc of modified) {
            changes.push({
              key: section.key,
              id: doc._id,
              matches: matchQuery([doc], base, section._class, hierarchy).length > 0,
              removed: false
            })
          }
          const removed = await ctx.pipeline.findAll(
            ctx.ctx,
            core.class.Tx,
            {
              _class: core.class.TxRemoveDoc,
              createdOn: { $gte: state.v },
              objectClass: section._class,
              ...(section.scoped === false ? {} : { space })
            },
            { limit: SNAPSHOT_CHANGES_LIMIT, sort: { _id: 1 }, showArchived: true }
          )
          for (const tx of removed as any[]) {
            changes.push({ key: section.key, id: tx.objectId, matches: false, removed: true })
          }
        } catch (err: any) {
          failures.push({ key: section.key, message: `changes: ${String(err?.message ?? err)}` })
        }
      }
    }

    return {
      version: state.v,
      space,
      sections: pages,
      ...(changes !== undefined ? { changes } : {}),
      ...(anyMore ? { next: encodeSnapshotCursor(state) } : {}),
      failures,
      partial: failures.length > 0
    }
  }

  async searchFulltext (ctx: ClientSessionCtx, query: SearchQuery, options: SearchOptions): Promise<void> {
    try {
      this.lastRequest = Date.now()
      this.includeSessionContext(ctx)
      const result = await this.counter.withCounter('fulltext', 1, () =>
        ctx.pipeline.searchFulltext(ctx.ctx, query, options)
      )
      await this.counter.withCounter('clientSendMemory', this.estimateSize(result), () =>
        ctx.sendResponse(ctx.requestId, result)
      )
    } catch (err) {
      await ctx.sendError(ctx.requestId, 'Failed to searchFulltext', unknownError(err))
      ctx.ctx.error('failed to searchFulltext', { err })
    }
  }

  async searchFulltextRaw (ctx: ClientSessionCtx, query: SearchQuery, options: SearchOptions): Promise<SearchResult> {
    this.lastRequest = Date.now()
    this.includeSessionContext(ctx)
    return await ctx.pipeline.searchFulltext(ctx.ctx, query, options)
  }

  async txRaw (
    ctx: ClientSessionCtx,
    tx: Tx
  ): Promise<{
      result: TxResult
      broadcastPromise: Promise<void>
      asyncsPromise: Promise<void> | undefined
    }> {
    this.lastRequest = Date.now()
    this.total.tx++
    this.current.tx++
    this.includeSessionContext(ctx)

    let cid = 'client_' + generateId()
    ctx.ctx.id = cid
    let onEnd = useReserveContext ? ctx.pipeline.context.adapterManager?.reserveContext?.(cid) : undefined
    let result: TxResult
    try {
      result = await ctx.pipeline.tx(ctx.ctx, [tx])
    } finally {
      onEnd?.()
    }
    // Send result immideately
    await ctx.sendResponse(ctx.requestId, result)

    // We need to broadcast all collected transactions
    const broadcastPromise = ctx.pipeline.handleBroadcast(ctx.ctx)

    // ok we could perform async requests if any
    const asyncs = (ctx.ctx.contextData as SessionData).asyncRequests ?? []
    let asyncsPromise: Promise<void> | undefined
    if (asyncs.length > 0) {
      cid = 'client_async_' + generateId()
      ctx.ctx.id = cid
      onEnd = useReserveContext ? ctx.pipeline.context.adapterManager?.reserveContext?.(cid) : undefined
      const handleAyncs = async (): Promise<void> => {
        try {
          for (const r of asyncs) {
            await r(ctx.ctx, cid)
          }
        } finally {
          onEnd?.()
        }
      }
      asyncsPromise = handleAyncs()
    }

    return { result, broadcastPromise, asyncsPromise }
  }

  async tx (ctx: ClientSessionCtx, tx: Tx): Promise<void> {
    const domain =
      ctx.pipeline.context.hierarchy.findDomain(
        TxProcessor.isExtendsCUD(tx._class) ? (tx as TxCUD<Doc>).objectClass : tx._class
      ) ?? ''
    await this.counter.withCounter('tx-' + domain, 1, async () => {
      try {
        const { broadcastPromise, asyncsPromise } = await this.txRaw(ctx, tx)
        await broadcastPromise
        if (asyncsPromise !== undefined) {
          await asyncsPromise
        }
      } catch (err) {
        await ctx.sendError(ctx.requestId, 'Failed to tx', unknownError(err))
        ctx.ctx.error('failed to tx', { err })
      }
    })
  }

  broadcast (ctx: MeasureContext, socket: ConnectionSocket, tx: Tx[]): void {
    if (this.tx.length > 10000) {
      const classes = new Set<Ref<Class<Doc>>>()
      for (const dtx of tx) {
        if (TxProcessor.isExtendsCUD(dtx._class)) {
          classes.add((dtx as TxCUD<Doc>).objectClass)
          const attachedToClass = (dtx as TxCUD<Doc>).attachedToClass
          if (attachedToClass !== undefined) {
            classes.add(attachedToClass)
          }
        }
      }
      const bevent = createBroadcastEvent(Array.from(classes))
      void socket.send(
        ctx,
        {
          result: [bevent]
        },
        this.binaryMode,
        this.useCompression
      )
    } else {
      void socket.send(ctx, { result: tx }, this.binaryMode, this.useCompression)
    }
  }

  getOps (pipeline: Pipeline): BackupClientOps {
    if (this.ops === undefined || this.opsPipeline !== pipeline) {
      if (pipeline.context.lowLevelStorage === undefined) {
        throw new PlatformError(unknownError('Low level storage is not available'))
      }
      this.ops = new BackupClientOps(pipeline.context.lowLevelStorage)
      this.opsPipeline = pipeline
    }
    return this.ops
  }

  async loadChunk (ctx: ClientSessionCtx, domain: Domain, idx?: number): Promise<void> {
    this.lastRequest = Date.now()
    try {
      const result = await this.getOps(ctx.pipeline).loadChunk(ctx.ctx, domain, idx)
      await ctx.sendResponse(ctx.requestId, result)
    } catch (err: any) {
      await ctx.sendError(ctx.requestId, 'Failed to upload', unknownError(err))
      ctx.ctx.error('failed to loadChunk', { domain, err })
    }
  }

  async getDomainHash (ctx: ClientSessionCtx, domain: Domain): Promise<void> {
    this.lastRequest = Date.now()
    try {
      const result = await this.getOps(ctx.pipeline).getDomainHash(ctx.ctx, domain)
      await ctx.sendResponse(ctx.requestId, result)
    } catch (err: any) {
      await ctx.sendError(ctx.requestId, 'Failed to upload', unknownError(err))
      ctx.ctx.error('failed to getDomainHash', { domain, err })
    }
  }

  async closeChunk (ctx: ClientSessionCtx, idx: number): Promise<void> {
    try {
      this.lastRequest = Date.now()
      await this.getOps(ctx.pipeline).closeChunk(ctx.ctx, idx)
      await ctx.sendResponse(ctx.requestId, {})
    } catch (err: any) {
      await ctx.sendError(ctx.requestId, 'Failed to closeChunk', unknownError(err))
      ctx.ctx.error('failed to closeChunk', { err })
    }
  }

  async loadDocs (ctx: ClientSessionCtx, domain: Domain, docs: Ref<Doc>[]): Promise<void> {
    this.lastRequest = Date.now()
    try {
      const result = await this.getOps(ctx.pipeline).loadDocs(ctx.ctx, domain, docs)
      await ctx.sendResponse(ctx.requestId, result)
    } catch (err: any) {
      await ctx.sendError(ctx.requestId, 'Failed to loadDocs', unknownError(err))
      ctx.ctx.error('failed to loadDocs', { domain, err })
    }
  }

  async upload (ctx: ClientSessionCtx, domain: Domain, docs: Doc[]): Promise<void> {
    if (!this.allowUpload) {
      await ctx.sendResponse(ctx.requestId, { error: 'Upload not allowed' })
    }
    this.lastRequest = Date.now()
    try {
      await this.getOps(ctx.pipeline).upload(ctx.ctx, domain, docs)
    } catch (err: any) {
      await ctx.sendError(ctx.requestId, 'Failed to upload', unknownError(err))
      ctx.ctx.error('failed to loadDocs', { domain, err })
      return
    }
    await ctx.sendResponse(ctx.requestId, {})
  }

  async clean (ctx: ClientSessionCtx, domain: Domain, docs: Ref<Doc>[]): Promise<void> {
    if (!this.allowUpload) {
      await ctx.sendResponse(ctx.requestId, { error: 'Clean not allowed' })
    }
    this.lastRequest = Date.now()
    try {
      await this.getOps(ctx.pipeline).clean(ctx.ctx, domain, docs)
    } catch (err: any) {
      await ctx.sendError(ctx.requestId, 'Failed to clean', unknownError(err))
      ctx.ctx.error('failed to clean', { domain, err })
      return
    }
    await ctx.sendResponse(ctx.requestId, {})
  }

  async domainRequest (ctx: ClientSessionCtx, domain: OperationDomain, params: DomainParams): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    await this.counter.withCounter('dr-' + domain, 1, async () => {
      try {
        const { asyncsPromise, broadcastPromise } = await this.domainRequestRaw(ctx, domain, params)

        await broadcastPromise

        if (asyncsPromise !== undefined) {
          await asyncsPromise
        }
      } catch (err) {
        await ctx.sendError(ctx.requestId, 'Failed to domainRequest', unknownError(err))
        ctx.ctx.error('failed to domainRequest', { err })
      }
    })
  }

  async domainRequestRaw (
    ctx: ClientSessionCtx,
    domain: OperationDomain,
    params: DomainParams
  ): Promise<{
      result: DomainResult
      broadcastPromise: Promise<void>
      asyncsPromise: Promise<void> | undefined
    }> {
    this.lastRequest = Date.now()
    this.total.find++
    this.current.find++
    this.includeSessionContext(ctx)

    const result: DomainResult = await ctx.pipeline.domainRequest(ctx.ctx, domain, params)

    await this.counter.withCounter('clientSendMemory', this.estimateSize(result), () =>
      ctx.sendResponse(ctx.requestId, result)
    )
    // We need to broadcast all collected transactions
    const broadcastPromise = ctx.pipeline.handleBroadcast(ctx.ctx)

    // ok we could perform async requests if any
    const asyncs = (ctx.ctx.contextData as SessionData).asyncRequests ?? []
    let asyncsPromise: Promise<void> | undefined
    if (asyncs.length > 0) {
      const handleAyncs = async (): Promise<void> => {
        // Make sure the broadcast is complete before we start the asyncs
        await broadcastPromise
        ctx.ctx.contextData.broadcast.queue = []
        ctx.ctx.contextData.broadcast.txes = []
        ctx.ctx.contextData.broadcast.sessions = {}
        try {
          for (const r of asyncs) {
            await r(ctx.ctx)
          }
        } catch (err: any) {
          ctx.ctx.error('failed to handleAsyncs', { err })
        }
      }
      asyncsPromise = handleAyncs().then(async () => {
        await ctx.pipeline?.handleBroadcast(ctx.ctx)
      })
    }

    return { result, asyncsPromise, broadcastPromise }
  }
}
