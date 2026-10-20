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
import core, { type PersonUuid, type WorkspaceUuid } from '@hcengineering/core'
import { connect } from '../connection'

class MockEvent {
  constructor (readonly type: string) {}
}

class MockMessageEvent {
  constructor (readonly type: string, readonly data: any) {}
}

class MockCloseEvent {
  constructor (readonly type: string, readonly code: number) {}
}

interface MockOptions {
  helloDelay?: number
  answerLoadModel?: boolean
  loadModelRateLimit?: boolean
}

class MockWebSocket implements ClientSocket {
  readyState: ClientSocketReadyState = ClientSocketReadyState.CONNECTING
  onmessage?: ((this: ClientSocket, ev: MessageEvent) => any) | null = null
  onclose?: ((this: ClientSocket, ev: CloseEvent) => any) | null = null
  onopen?: ((this: ClientSocket, ev: Event) => any) | null = null
  onerror?: ((this: ClientSocket, ev: Event) => any) | null = null
  bufferedAmount = 0

  readonly sent: any[] = []
  closed = false
  closeCode?: number
  private helloId = -1

  constructor (private readonly options: MockOptions = {}) {
    const helloDelay = options.helloDelay ?? 1
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
      }, helloDelay)
    }, 1)
  }

  private receive (response: any): void {
    if (this.onmessage !== null && this.onmessage !== undefined) {
      this.onmessage(new MockMessageEvent('message', JSON.stringify(response)) as any)
    }
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
    this.sent.push(message)

    if (message.method === 'hello') {
      return
    }
    if (message.method === 'loadModel') {
      if (this.options.loadModelRateLimit === true) {
        this.receive({
          id: message.id,
          error: { code: 'rate-limit', severity: 2, params: {} },
          rateLimit: { remaining: 0, limit: 100, current: 0, reset: 0, retryAfter: 100 }
        })
        return
      }
      if (this.options.answerLoadModel === true) {
        this.receive({ id: message.id, result: { transactions: [], hash: 'test-hash', full: false } })
      }
    }
  }

  close (code?: number): void {
    this.closeCode = code
    this.closed = true
    this.readyState = ClientSocketReadyState.CLOSED
    setTimeout(() => {
      this.onclose?.(new MockCloseEvent('close', code ?? 1000) as any)
    }, 1)
  }

  count (method: string): number {
    return this.sent.filter((message) => message.method === method).length
  }
}

function wait (ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor (condition: () => boolean, timeoutMs = 1000): Promise<void> {
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

describe('connection cancellation', () => {
  it('rejects a pending loadModel on close and keeps the socket closed', async () => {
    const socket = new MockWebSocket()
    const connection = connect('ws://test', () => {}, workspace, user, {
      socketFactory: () => socket
    })

    await waitFor(() => connection.isConnected())
    const pending = connection.loadModel(0)
    await waitFor(() => socket.count('loadModel') === 1)
    const sentBeforeClose = socket.sent.length

    await connection.close()

    await expect(pending).rejects.toThrow('Connection closed')
    await wait(150)

    expect(socket.sent.length).toBe(sentBeforeClose)
    expect(socket.closed).toBe(true)
  })

  it('cancels a reconnect retry timer when the connection closes', async () => {
    // The model request is queued before hello, so hello schedules the
    // connection's reconnect retry. Closing before that timer fires must not
    // send the request again.
    const socket = new MockWebSocket({ helloDelay: 40 })
    const connection = connect('ws://test', () => {}, workspace, user, {
      socketFactory: () => socket
    })

    const pending = connection.loadModel(0)
    await waitFor(() => connection.isConnected())
    await waitFor(() => socket.count('loadModel') === 1)

    await connection.close()

    await expect(pending).rejects.toThrow('Connection closed')
    await wait(180)

    expect(socket.count('loadModel')).toBe(1)
  })

  it('clears a rate-limit retry timer when the connection closes', async () => {
    const socket = new MockWebSocket({ loadModelRateLimit: true })
    const connection = connect('ws://test', () => {}, workspace, user, {
      socketFactory: () => socket
    })

    await waitFor(() => connection.isConnected())
    const pending = connection.loadModel(0)
    pending.catch(() => {})
    await waitFor(() => socket.count('loadModel') === 1)

    await wait(10)
    await connection.close()
    await wait(180)

    expect(socket.count('loadModel')).toBe(1)
  })

  it('aborts a pending loadModel and closes its socket', async () => {
    const controller = new AbortController()
    const socket = new MockWebSocket()
    const connection = connect('ws://test', () => {}, workspace, user, {
      socketFactory: () => socket,
      signal: controller.signal
    })

    await waitFor(() => connection.isConnected())
    const pending = connection.loadModel(0)
    await waitFor(() => socket.count('loadModel') === 1)
    const sentBeforeAbort = socket.sent.length

    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await wait(150)

    expect(socket.sent.length).toBe(sentBeforeAbort)
    expect(socket.closed).toBe(true)
  })
})
