//
// Copyright © 2026 Hardcore Engineering Inc.
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

import type { MeasureContext } from '@hcengineering/core'
import type { ConnectionMgr, DBClient } from '@hcengineering/postgres-base'

export const DEFAULT_SLOW_SQL_MS = 1000
const MAX_STATEMENT_LENGTH = 2000

export function slowSqlThreshold (): number {
  const raw = process.env.HULY_SLOW_SQL_MS
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_SLOW_SQL_MS
  }
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_SLOW_SQL_MS
}

/**
 * Remove inline SQL literals and comments as well as keeping bound parameters
 * out of the log. Preserve quoted identifiers and $n placeholders.
 */
export function normalizeSql (sql: string): string {
  let redacted = ''
  let i = 0
  while (i < sql.length) {
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i + 2)
      i = end < 0 ? sql.length : end
      redacted += '?'
      continue
    }
    if (sql.startsWith('/*', i)) {
      let depth = 1
      i += 2
      while (i < sql.length && depth > 0) {
        if (sql.startsWith('/*', i)) {
          depth++
          i += 2
        } else if (sql.startsWith('*/', i)) {
          depth--
          i += 2
        } else {
          i++
        }
      }
      redacted += '?'
      continue
    }
    const dollar = /^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/.exec(sql.slice(i))
    if (dollar !== null) {
      const end = sql.indexOf(dollar[0], i + dollar[0].length)
      i = end < 0 ? sql.length : end + dollar[0].length
      redacted += '?'
      continue
    }
    const escaped = /^[eE]'/.test(sql.slice(i)) && (i === 0 || !/[A-Za-z_0-9$]/.test(sql[i - 1]))
    if (sql[i] === "'" || escaped) {
      i += escaped ? 2 : 1
      while (i < sql.length) {
        // Only E strings treat a backslash as an escape. Ordinary strings
        // use PostgreSQL's default standard_conforming_strings behavior.
        if (escaped && sql[i] === '\\') {
          i += 2
        } else if (sql[i] === "'") {
          if (sql[i + 1] !== "'") {
            i++
            break
          }
          i += 2
        } else {
          i++
        }
      }
      redacted += '?'
      continue
    }
    const token = /^(?:"(?:""|[^"])*"|\$\d+|[A-Za-z_][A-Za-z_0-9$]*|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(sql.slice(i))
    if (token !== null) {
      redacted += /^\d/.test(token[0]) ? '?' : token[0]
      i += token[0].length
    } else {
      redacted += sql[i++]
    }
  }
  const normalized = redacted.replace(/\s+/g, ' ').trim()
  return normalized.length > MAX_STATEMENT_LENGTH ? normalized.slice(0, MAX_STATEMENT_LENGTH) + '...' : normalized
}

export interface SlowSqlLogger {
  info: (message: string, obj?: Record<string, any>) => void
}

function rowCount (result: any): number | undefined {
  if (result === undefined || result === null) {
    return undefined
  }
  if (typeof result.count === 'number') {
    return result.count
  }
  if (Array.isArray(result)) {
    return result.length
  }
  return undefined
}

/**
 * Wraps a DBClient so every execute is timed. Only logging is additive, the
 * call and its result pass through unchanged.
 */
export function wrapSlowSqlClient (
  client: DBClient,
  log: SlowSqlLogger,
  thresholdMs: number = slowSqlThreshold(),
  now: () => number = Date.now
): DBClient {
  return {
    execute: async (query, parameters) => {
      const start = now()
      let result: any
      try {
        result = await client.execute(query, parameters)
        return result
      } finally {
        const durationMs = now() - start
        if (durationMs >= thresholdMs) {
          log.info('slow sql', {
            statement: normalizeSql(String(query)),
            durationMs,
            rows: rowCount(result)
          })
        }
      }
    },
    release: () => client.release(),
    reserve: async () => wrapSlowSqlClient(await client.reserve(), log, thresholdMs, now),
    raw: () => client.raw()
  }
}

/**
 * Wraps a ConnectionMgr so the clients it hands to retry and write callbacks
 * are the timed ones. Every other member is reached with the manager as this.
 */
export function wrapSlowSqlMgr (
  mgr: ConnectionMgr,
  log: SlowSqlLogger,
  thresholdMs: number = slowSqlThreshold(),
  now: () => number = Date.now
): ConnectionMgr {
  const wrap = (client: DBClient): DBClient => wrapSlowSqlClient(client, log, thresholdMs, now)
  return new Proxy(mgr, {
    get (target, prop, receiver) {
      if (prop === 'retry' || prop === 'write') {
        return (id: string | undefined, mgrId: string, fn: (client: DBClient) => Promise<any>) =>
          (target[prop] as any)(id, mgrId, (client: DBClient) => fn(wrap(client)))
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}

export function createSlowSql (ctx: MeasureContext, thresholdMs: number = slowSqlThreshold()): {
  wrapClient: (client: DBClient) => DBClient
  wrapMgr: (mgr: ConnectionMgr) => ConnectionMgr
} {
  return {
    wrapClient: (client: DBClient) => wrapSlowSqlClient(client, ctx, thresholdMs),
    wrapMgr: (mgr: ConnectionMgr) => wrapSlowSqlMgr(mgr, ctx, thresholdMs)
  }
}

/** Measure database waits for a cursor, excluding time spent consuming its rows. */
export async function * timedSqlCursor<T extends any[]> (
  cursor: AsyncIterable<T>,
  statement: string,
  log: SlowSqlLogger,
  thresholdMs: number = slowSqlThreshold()
): AsyncGenerator<T> {
  const iterator = cursor[Symbol.asyncIterator]()
  let durationMs = 0
  let rows = 0
  let done = false
  try {
    while (true) {
      const start = Date.now()
      let part: IteratorResult<T>
      try {
        part = await iterator.next()
      } finally {
        durationMs += Date.now() - start
      }
      if (part.done === true) {
        done = true
        break
      }
      rows += part.value.length
      yield part.value
    }
  } finally {
    try {
      if (!done) await iterator.return?.()
    } finally {
      if (durationMs >= thresholdMs) {
        log.info('slow sql', { statement: normalizeSql(statement), durationMs, rows })
      }
    }
  }
}
