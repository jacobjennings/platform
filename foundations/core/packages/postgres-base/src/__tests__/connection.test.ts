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

import { ConnectionMgr, type DBClient } from '../index'

function emptyResult (): any {
  return Object.assign([], { count: 0 })
}

// A pool with a hard connection limit. reserve() waits for a free slot, like
// postgres.js, so a reservation cycle that holds every connection shows up as a
// hung test rather than as silent success.
class FakePool {
  held = 0
  peak = 0
  statements = 0
  releases = 0

  private readonly waiters: Array<(client: DBClient) => void> = []

  constructor (readonly max: number) {}

  root (): DBClient {
    return {
      execute: async () => {
        this.statements++
        return emptyResult()
      },
      release: () => {},
      reserve: async () => await this.acquire(),
      raw: () => ({}) as any
    }
  }

  private acquire (): Promise<DBClient> {
    if (this.held < this.max) {
      return Promise.resolve(this.lease())
    }
    return await new Promise<DBClient>((resolve) => {
      this.waiters.push(resolve)
    })
  }

  private lease (): DBClient {
    this.held++
    this.peak = Math.max(this.peak, this.held)
    let released = false
    return {
      execute: async () => {
        this.statements++
        return emptyResult()
      },
      release: () => {
        if (released) return
        released = true
        this.held--
        this.releases++
        const next = this.waiters.shift()
        if (next !== undefined) {
          next(this.lease())
        }
      },
      reserve: async () => await this.acquire(),
      raw: () => ({}) as any
    }
  }
}

describe('ConnectionMgr reservations', () => {
  it('releases idle leases before a transaction waits for the pool', async () => {
    const pool = new FakePool(10)
    const mgr = new ConnectionMgr(pool.root(), { maxIdleLeases: 10, reserveTimeoutMs: 1000 })

    // Context A finishes a transaction and keeps its lease idle.
    await mgr.write('client_a', 'mgr', async () => {})
    expect(mgr.stats().idleLeases).toBe(1)

    // Another session holds the remaining nine connections.
    const held: DBClient[] = []
    for (let i = 0; i < 9; i++) {
      held.push(await pool.root().reserve())
    }
    expect(pool.held).toBe(10)

    // A new transaction must free A's idle lease instead of waiting behind it.
    await mgr.write('client_b', 'mgr', async (client) => {
      await client.execute('UPDATE board')
    })
    expect(pool.peak).toBeLessThanOrEqual(10)
    expect(pool.held).toBe(10)

    mgr.close()
    for (const lease of held) {
      lease.release()
    }
    expect(pool.held).toBe(0)
  })

  it('bounds the idle leases one manager can hold', async () => {
    const pool = new FakePool(10)
    const mgr = new ConnectionMgr(pool.root(), { maxIdleLeases: 2, reserveTimeoutMs: 1000 })

    // Six contexts finish together and each tries to keep its lease. The
    // manager keeps at most two and releases the rest.
    await Promise.all(
      Array.from({ length: 6 }, async (_, i) => {
        await mgr.write(`client_${i}`, 'mgr', async () => {})
      })
    )

    expect(pool.held).toBeLessThanOrEqual(6)
    expect(mgr.stats().idleLeases).toBe(2)
    expect(pool.held).toBe(2)

    mgr.close()
    expect(pool.held).toBe(0)
    expect(mgr.stats()).toEqual({ contexts: 0, idleLeases: 0, activeLeases: 0 })
  })

  it('lets sixteen managed contexts share a ten connection pool', async () => {
    const pool = new FakePool(10)
    const mgr = new ConnectionMgr(pool.root(), { maxIdleLeases: 5, reserveTimeoutMs: 2000 })

    await Promise.all(
      Array.from({ length: 16 }, async (_, user) => {
        const id = `client_async_${user}`
        // The server reserves a context for each asynchronous presence trigger.
        mgr.getConnection(id, 'mgr', true)
        for (let round = 0; round < 5; round++) {
          // Presence lookups (OnUserStatus, syncChat, trigger findAll) are reads.
          await mgr.retry(id, 'mgr', async (client) => {
            await client.execute('SELECT * FROM contact WHERE person = $1', [user])
            return []
          })
          // A derived transaction from the same context needs a lease.
          await mgr.write(id, 'mgr', async (client) => {
            await client.execute('UPDATE "contact" SET online = true WHERE person = $1', [user])
          })
        }
        // The asynchronous context ends and releases its reservation.
        mgr.release(id)
      })
    )

    expect(pool.peak).toBeLessThanOrEqual(10)
    expect(pool.statements).toBe(16 * 5 * 2)
    expect(mgr.stats()).toEqual({ contexts: 0, idleLeases: 0, activeLeases: 0 })
    expect(pool.held).toBe(0)
  })

  it('does not hold a lease for a presence lookup on an asynchronous context', async () => {
    const pool = new FakePool(10)
    const mgr = new ConnectionMgr(pool.root(), { maxIdleLeases: 5, reserveTimeoutMs: 1000 })

    mgr.getConnection('client_async_presence', 'mgr', true)
    for (let i = 0; i < 7; i++) {
      await mgr.retry('client_async_presence', 'mgr', async (client) => {
        await client.execute('SELECT * FROM "contact"."Person"')
        return []
      })
      // After every lookup the context is idle and must own nothing.
      expect(mgr.stats().idleLeases).toBe(0)
      expect(mgr.stats().activeLeases).toBe(0)
      expect(pool.held).toBe(0)
    }

    mgr.release('client_async_presence')
    expect(mgr.stats().contexts).toBe(0)
  })

  it('cancels a reservation that cannot get a connection and releases the late one', async () => {
    const pool = new FakePool(1)
    const mgr = new ConnectionMgr(pool.root(), { maxIdleLeases: 0, reserveTimeoutMs: 20 })

    const blocker = await pool.root().reserve()
    expect(pool.held).toBe(1)

    await expect(
      mgr.write('blocked', 'mgr', async () => {})
    ).rejects.toThrow('Timed out after 20ms waiting for a database connection')
    expect(pool.held).toBe(1)

    // Free the slot. The cancelled reservation resolves late and must release it
    // instead of leaking the connection.
    blocker.release()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(pool.held).toBe(0)
    expect(mgr.stats().contexts).toBe(0)
  })

  it('releases the lease of a context that is cancelled during a transaction', async () => {
    const pool = new FakePool(2)
    const mgr = new ConnectionMgr(pool.root(), { maxIdleLeases: 2, reserveTimeoutMs: 1000 })

    mgr.getConnection('client_disconnect', 'mgr', true)
    let finish!: () => void
    const started = new Promise<void>((resolve) => {
      finish = resolve
    })
    let transactionStarted!: () => void
    const entered = new Promise<void>((resolve) => {
      transactionStarted = resolve
    })

    const pending = mgr.write('client_disconnect', 'mgr', async () => {
      transactionStarted()
      await started
    })
    await entered
    expect(mgr.stats().activeLeases).toBe(1)

    // A disconnected client releases its asynchronous context mid-flight.
    mgr.release('client_disconnect')
    finish()
    await pending

    expect(mgr.stats()).toEqual({ contexts: 0, idleLeases: 0, activeLeases: 0 })
    expect(pool.held).toBe(0)
  })
})
