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

import type { DBClient } from '@hcengineering/postgres-base'
import { normalizeSql, slowSqlThreshold, wrapSlowSqlClient } from '../diagnostics'

function fakeClient (result: any): DBClient {
  return {
    execute: async () => result,
    release: () => {},
    reserve: async () => fakeClient(result),
    raw: () => (() => {}) as any
  }
}

describe('postgres slow SQL diagnostics', () => {
  it('normalizes a statement without parameter values', () => {
    const sql = 'SELECT *\n   FROM "tx"\n WHERE "workspaceId" = $1::uuid AND _id = $2::text'
    expect(normalizeSql(sql)).toBe('SELECT * FROM "tx" WHERE "workspaceId" = $1::uuid AND _id = $2::text')
  })

  it('reads the threshold from HULY_SLOW_SQL_MS', () => {
    const previous = process.env.HULY_SLOW_SQL_MS
    try {
      process.env.HULY_SLOW_SQL_MS = '250'
      expect(slowSqlThreshold()).toBe(250)
      delete process.env.HULY_SLOW_SQL_MS
      expect(slowSqlThreshold()).toBe(1000)
    } finally {
      if (previous === undefined) {
        delete process.env.HULY_SLOW_SQL_MS
      } else {
        process.env.HULY_SLOW_SQL_MS = previous
      }
    }
  })

  it('logs a statement over the threshold with rows and duration', async () => {
    const lines: Array<{ message: string, obj: Record<string, any> }> = []
    const times = [1000, 2600]
    const client = wrapSlowSqlClient(
      fakeClient([{ _id: 'a' }, { _id: 'b' }]),
      { info: (message, obj) => lines.push({ message, obj: obj ?? {} }) },
      1000,
      () => times.shift() ?? 2600
    )

    await client.execute('SELECT * FROM "doc" WHERE "workspaceId" = $1::uuid', ['ws'])

    expect(lines).toHaveLength(1)
    expect(lines[0].message).toBe('slow sql')
    expect(lines[0].obj.statement).toBe('SELECT * FROM "doc" WHERE "workspaceId" = $1::uuid')
    expect(lines[0].obj.durationMs).toBe(1600)
    expect(lines[0].obj.rows).toBe(2)
  })

  it('does not log a statement under the threshold', async () => {
    const lines: Array<Record<string, any>> = []
    const times = [1000, 1100]
    const client = wrapSlowSqlClient(
      fakeClient([]),
      { info: (_message, obj) => lines.push(obj ?? {}) },
      1000,
      () => times.shift() ?? 1100
    )

    await client.execute('SELECT 1', [])
    expect(lines).toHaveLength(0)
  })
})
