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

import { type ClientSocket, ClientSocketReadyState, pingConst, pongConst } from '@hcengineering/client'
import core, { type PersonUuid, generateId, type WorkspaceUuid, type Doc } from '@hcengineering/core'
import { connect, MAX_SLOW_DOWN_MS, nextSlowDownMs } from '../connection'

class MockEvent {
  constructor (readonly type: string) {}
}

class MockMessageEvent {
  constructor (readonly type: string, readonly data: any) {}
}

class MockCloseEvent {
  constructor (readonly type: string, readonly code: number) {}
}

interface Attempt {
  remaining: number
  limit?: number
  rejected?: boolean
  retryAfter?: number
}

/**
 * A socket that answers each RPC with the next scripted rate-limit header. The
 * script is per wire attempt, so a rejected RPC consumes one entry and its
 * retry consumes the next.
 */
class ScriptedWebSocket implements ClientSocket {
  readyState: ClientSocketReadyState = ClientSocketReadyState.CONNECTING
  onmessage?: ((this: ClientSocket, ev: MessageEvent) => any) | null = null
  onclose?: ((this: ClientSocket, ev: CloseEvent) => any) | null = null
  onopen?: ((this: ClientSocket, ev: Event) => any) | null = null
  onerror?: ((this: ClientSocket, ev: Event) => any) | null = null
  bufferedAmount = 0

  readonly sent: string[] = []
  private closed = false
  private helloId = -1

  constructor (private readonly attempts: Attempt[]) {
    setTimeout(() => {
      if (this.closed) {
        return
      }
      this.readyState = ClientSocketReadyState.OPEN
      this.onopen?.(new MockEvent('open') as any)
      setTimeout(() => {
        if (!this.closed) {
          this.receive({
            id: this.helloId,
            result: 'hello',
            binary: false,
            useCompression: false,
            lastHash: 'test-hash',
            serverVersion: 'test',
            reconnect: false,
            account: {}
          })
        }
      }, 1)
    }, 1)
  }

  private receive (response: any): void {
    if (this.onmessage !== null && this.onmessage !== undefined) {
      this.onmessage(new MockMessageEvent('message', JSON.stringify(response)) as any)
    }
  }

  private next (): Attempt {
    return this.attempts.shift() ?? { remaining: 1499, limit: 1500 }
  }

  send (data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.readyState !== ClientSocketReadyState.OPEN) {
      throw new Error('WebSocket is not open')
    }
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data as ArrayBuffer)
    if (text === pingConst) {
      this.receive({ id: -1, result: pongConst })
      return
    }
    const message = JSON.parse(text)
    this.sent.push(message.method)
    if (message.method === 'hello') {
      return
    }

    const attempt = this.next()
    const rateLimit = {
      remaining: attempt.remaining,
      limit: attempt.limit ?? 1500,
      current: 0,
      reset: 0,
      retryAfter: attempt.retryAfter
    }
    if (attempt.rejected === true) {
      this.receive({
        id: message.id,
        error: { code: 'rate-limit', severity: 2, params: {} },
        rateLimit
      })
      return
    }
    if (message.method === 'findAll') {
      this.receive({ id: message.id, result: [], rateLimit })
      return
    }
    if (message.method === 'tx') {
      this.receive({ id: message.id, result: {}, rateLimit })
      return
    }
    this.receive({ id: message.id, result: { transactions: [], hash: 'test-hash', full: false }, rateLimit })
  }

  close (code?: number): void {
    this.closed = true
    this.readyState = ClientSocketReadyState.CLOSED
    setTimeout(() => {
      this.onclose?.(new MockCloseEvent('close', code ?? 1000) as any)
    }, 1)
  }

  count (method: string): number {
    return this.sent.filter((it) => it === method).length
  }
}

function wait (ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor (condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timed out waiting for condition')
    }
    await wait(5)
  }
}

const workspace = 'ws-1' as WorkspaceUuid
const user = 'user-1' as PersonUuid

interface PacedConnection {
  conn: any
  socket: ScriptedWebSocket
  scheduledMs: number
}

async function openPaced (attempts: Attempt[]): Promise<PacedConnection> {
  const socket = new ScriptedWebSocket(attempts)
  const conn = connect('ws://test', () => {}, workspace, user, {
    socketFactory: () => socket as any
  }) as any
  await waitFor(() => conn.isConnected() as boolean)

  const sendRequest = conn.sendRequest.bind(conn)
  const paced: PacedConnection = { conn, socket, scheduledMs: 0 }
  conn.sendRequest = function (...args: any[]) {
    paced.scheduledMs += this.slowDownTimer as number
    return sendRequest(...args)
  }
  return paced
}

async function closePaced (paced: PacedConnection): Promise<void> {
  await paced.conn.close()
  await wait(20)
}

describe('nextSlowDownMs', () => {
  it('keeps a healthy window at zero delay', () => {
    expect(nextSlowDownMs(0, { remaining: 1499, limit: 1500, current: 1, reset: 0 })).toBe(0)
  })

  it('reduces the delay at the normal limit', () => {
    // The old counter could only shrink inside a remaining < 50 branch, which
    // a normal 1,500 request window never reaches.
    expect(nextSlowDownMs(50, { remaining: 1499, limit: 1500, current: 1, reset: 0 })).toBe(40)
    expect(nextSlowDownMs(50, undefined)).toBe(40)
  })

  it('raises the delay while the budget is in its last third', () => {
    expect(nextSlowDownMs(0, { remaining: 400, limit: 1500, current: 1100, reset: 0 })).toBe(10)
    expect(nextSlowDownMs(90, { remaining: 1, limit: 1500, current: 1499, reset: 0 })).toBe(
      MAX_SLOW_DOWN_MS
    )
  })

  it('never schedules more than the bound', () => {
    let delay = 0
    for (let i = 0; i < 100; i++) {
      delay = nextSlowDownMs(delay, { remaining: 0, limit: 1500, current: 1500, reset: 0 })
      expect(delay).toBeLessThanOrEqual(MAX_SLOW_DOWN_MS)
    }
    expect(delay).toBe(MAX_SLOW_DOWN_MS)
  })

  it('decays a full penalty to zero on healthy responses', () => {
    let delay = MAX_SLOW_DOWN_MS
    for (let i = 0; i < MAX_SLOW_DOWN_MS / 10; i++) {
      delay = nextSlowDownMs(delay, { remaining: 1400, limit: 1500, current: 100, reset: 0 })
    }
    expect(delay).toBe(0)
  })
})

describe('connection pacing after a spent budget', () => {
  it('bounds pacing, then decays it on healthy responses of one persistent connection', async () => {
    const attempts: Attempt[] = []
    // Before: a healthy connection at the normal limit.
    for (let i = 0; i < 4; i++) attempts.push({ remaining: 1400 })
    // During: the budget is nearly spent.
    for (let i = 0; i < 9; i++) attempts.push({ remaining: 2 })
    // A rejected request and its server-directed retry.
    attempts.push({ remaining: 0, rejected: true, retryAfter: 25 })
    attempts.push({ remaining: 1300 })
    // After: the budget recovered.
    for (let i = 0; i < 12; i++) attempts.push({ remaining: 1400 })

    const paced = await openPaced(attempts)
    try {
      const before: number[] = []
      for (let i = 0; i < 4; i++) {
        const start = Date.now()
        await paced.conn.loadModel(0)
        before.push(Date.now() - start)
      }
      const scheduledBefore = paced.scheduledMs
      expect(paced.conn.slowDownTimer).toBe(0)
      expect(scheduledBefore).toBe(0)
      expect(Math.max(...before)).toBeLessThan(40)

      const during: number[] = []
      for (let i = 0; i < 9; i++) {
        const start = Date.now()
        await paced.conn.loadModel(0)
        during.push(Date.now() - start)
      }
      const scheduledDuring = paced.scheduledMs - scheduledBefore
      expect(scheduledDuring).toBe(360)
      expect(during[during.length - 1]).toBeGreaterThanOrEqual(70)
      expect(paced.conn.slowDownTimer).toBe(90)

      const rejectedAt = Date.now()
      await paced.conn.loadModel(0)
      const rejectedElapsed = Date.now() - rejectedAt
      expect(rejectedElapsed).toBeGreaterThanOrEqual(100)
      // The rejected response raises the delay, and its retry response lowers
      // it again because the retried request was accepted.
      expect(paced.conn.slowDownTimer).toBe(90)

      const after: number[] = []
      const delays: number[] = []
      const scheduledBeforeAfter = paced.scheduledMs
      for (let i = 0; i < 12; i++) {
        const start = Date.now()
        await paced.conn.loadModel(0)
        after.push(Date.now() - start)
        delays.push(paced.conn.slowDownTimer)
      }
      const scheduledAfter = paced.scheduledMs - scheduledBeforeAfter
      expect(scheduledAfter).toBe(450)
      expect(paced.conn.slowDownTimer).toBe(0)
      expect(after[after.length - 1]).toBeLessThan(50)

      // Every healthy response lowers the delay until the penalty is gone.
      expect(delays).toEqual([80, 70, 60, 50, 40, 30, 20, 10, 0, 0, 0, 0])

      // Four warm-up reads, nine pressure reads, the rejected attempt and its
      // retry, and twelve recovery reads. One persistent connection served all.
      expect(paced.socket.count('loadModel')).toBe(4 + 9 + 2 + 12)
      expect(paced.scheduledMs).toBe(360 + 90 + 450)
    } finally {
      await closePaced(paced)
    }
  })

  it('keeps a mixed read and write migration bounded and recovers to zero', async () => {
    const attempts: Attempt[] = []
    for (let i = 0; i < 3; i++) attempts.push({ remaining: 1400 })
    // Three cards of the migration workload: four reads and two writes each.
    for (let i = 0; i < 6; i++) attempts.push({ remaining: 2 })
    attempts.push({ remaining: 0, rejected: true, retryAfter: 20 })
    for (let i = 0; i < 12; i++) attempts.push({ remaining: 1400 })

    const paced = await openPaced(attempts)
    try {
      for (let i = 0; i < 3; i++) await paced.conn.findAll(core.class.Doc, {})
      for (let card = 0; card < 3; card++) {
        for (let read = 0; read < 4; read++) await paced.conn.findAll(core.class.Doc, { _id: generateId() })
        for (let write = 0; write < 2; write++) await paced.conn.tx(twoWrites[card][write])
      }

      expect(paced.socket.count('findAll')).toBe(3 + 12 + 1)
      expect(paced.socket.count('tx')).toBe(6)
      expect(paced.conn.slowDownTimer).toBe(0)
      expect(paced.scheduledMs).toBe(420)
    } finally {
      await closePaced(paced)
    }
  })
})

const twoWrites: Array<Array<Doc & { _class: any }>> = [0, 1, 2].map(() => [
  {
    _id: generateId(),
    _class: core.class.Doc,
    space: core.space.Model,
    modifiedBy: core.account.System,
    modifiedOn: 0,
    createdBy: core.account.System,
    createdOn: 0
  },
  {
    _id: generateId(),
    _class: core.class.Doc,
    space: core.space.Model,
    modifiedBy: core.account.System,
    modifiedOn: 0,
    createdBy: core.account.System,
    createdOn: 0
  }
])
