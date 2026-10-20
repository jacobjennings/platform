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

import type { Blob, CollaborativeDoc, Doc, Ref } from '@hcengineering/core'
import { getClient } from '../client'

const document: CollaborativeDoc = {
  objectClass: 'core:class:Doc' as any,
  objectId: 'doc-1' as Ref<Doc>,
  objectAttr: 'description'
}

const source = 'blob-1' as Ref<Blob>

function abortableFetch (): jest.Mock {
  return jest.fn(
    async (_url: string, init: RequestInit) =>
      await new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const error = new Error('The operation was aborted')
          error.name = 'AbortError'
          reject(error)
        })
      })
  )
}

function okResponse (body: any): any {
  return {
    ok: true,
    json: async () => body
  }
}

function wait (ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('collaborator client cancellation', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it('stops the retry timer when the owning read is aborted during the delay', async () => {
    const fetchMock = jest.fn(async () => {
      throw new Error('network down')
    })
    global.fetch = fetchMock as any

    const controller = new AbortController()
    const client = getClient('ws' as any, 'token', 'http://collab.invalid')
    const pending = client.getMarkup(document, null, controller.signal)

    setTimeout(() => controller.abort(), 10)

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await wait(120)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('aborts the in-flight description fetch and does not retry it', async () => {
    const fetchMock = abortableFetch()
    global.fetch = fetchMock as any

    const controller = new AbortController()
    const client = getClient('ws' as any, 'token', 'http://collab.invalid')
    const pending = client.getMarkup(document, source, controller.signal)

    setTimeout(() => controller.abort(), 10)

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await wait(120)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal)
  })

  it('does not replay a timed-out write after the caller aborts', async () => {
    const fetchMock = abortableFetch()
    global.fetch = fetchMock as any

    const controller = new AbortController()
    const client = getClient('ws' as any, 'token', 'http://collab.invalid')
    const pending = client.createMarkup(document, 'text', controller.signal)

    setTimeout(() => controller.abort(), 10)

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await wait(120)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not start a batch read for an already cancelled call', async () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as any

    const controller = new AbortController()
    controller.abort()

    const client = getClient('ws' as any, 'token', 'http://collab.invalid')

    await expect(
      client.getMarkups([{ document, source }], controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('passes the owning signal to a successful read', async () => {
    const fetchMock = jest.fn(async () => okResponse({ content: { description: 'hello' } }))
    global.fetch = fetchMock as any

    const controller = new AbortController()
    const client = getClient('ws' as any, 'token', 'http://collab.invalid')

    await expect(client.getMarkup(document, null, controller.signal)).resolves.toBe('hello')
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal)
  })
})
