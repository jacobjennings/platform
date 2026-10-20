//
// Copyright © 2024 Hardcore Engineering Inc.
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

import { Blob, CollaborativeDoc, Markup, MarkupBlobRef, Ref, WorkspaceUuid, concatLink } from '@hcengineering/core'
import { encodeDocumentId } from './utils'

/** @public */
export interface GetContentRequest {
  source?: Ref<Blob>
}

/** @public */
export interface GetContentResponse {
  content: Record<string, Markup>
}

/** @public */
export interface CreateContentRequest {
  content: Record<string, Markup>
}

/** @public */
export interface CreateContentResponse {
  content: Record<string, MarkupBlobRef>
}

/** @public */
export interface UpdateContentRequest {
  content: Record<string, Markup>
}

/** @public */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface UpdateContentResponse {}

/** @public */
export interface GetMarkupItem {
  document: CollaborativeDoc
  source?: Ref<Blob> | null
}

/** @public */
export interface GetContentsItem {
  documentId: string
  source?: Ref<Blob>
}

/** @public */
export interface GetContentsRequest {
  documents: GetContentsItem[]
}

/** @public */
export interface GetContentsResponse {
  /** Markup keyed by encoded document id, then by attribute */
  contents: Record<string, Record<string, Markup>>
}

/** @public */
export interface CollaboratorClient {
  getMarkup: (document: CollaborativeDoc, source?: Ref<Blob> | null, signal?: AbortSignal) => Promise<Markup>
  getMarkups: (items: GetMarkupItem[], signal?: AbortSignal) => Promise<Markup[]>
  createMarkup: (document: CollaborativeDoc, markup: Markup, signal?: AbortSignal) => Promise<MarkupBlobRef>
  updateMarkup: (document: CollaborativeDoc, markup: Markup, signal?: AbortSignal) => Promise<void>
  copyContent: (
    source: CollaborativeDoc,
    target: CollaborativeDoc,
    content?: Ref<Blob>,
    signal?: AbortSignal
  ) => Promise<void>
}

/** @public */
export function getClient (workspaceId: WorkspaceUuid, token: string, collaboratorUrl: string): CollaboratorClient {
  const url = collaboratorUrl.replaceAll('wss://', 'https://').replace('ws://', 'http://')
  return new CollaboratorClientImpl(workspaceId, token, url)
}

class CollaboratorClientImpl implements CollaboratorClient {
  constructor (
    private readonly workspace: WorkspaceUuid,
    private readonly token: string,
    private readonly collaboratorUrl: string
  ) {}

  private async rpc<P, R>(
    document: CollaborativeDoc,
    method: string,
    payload: P,
    signal?: AbortSignal
  ): Promise<R> {
    throwIfAborted(signal)

    const workspace = this.workspace
    const documentId = encodeDocumentId(workspace, document)

    const url = concatLink(this.collaboratorUrl, `/rpc/${encodeURIComponent(documentId)}`)

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + this.token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ method, payload }),
      signal
    })

    if (!res.ok) {
      throw new Error('HTTP error ' + res.status)
    }

    const result = await res.json()

    if (result.error != null) {
      throw new Error(result.error)
    }

    return result as R
  }

  async getMarkup (document: CollaborativeDoc, source?: Ref<Blob> | null, signal?: AbortSignal): Promise<Markup> {
    const payload: GetContentRequest = {
      source: source !== null ? source : undefined
    }

    const res = await retry(
      3,
      async () => {
        return await this.rpc<GetContentRequest, GetContentResponse>(document, 'getContent', payload, signal)
      },
      50,
      signal
    )

    return res.content[document.objectAttr] ?? ''
  }

  async getMarkups (items: GetMarkupItem[], signal?: AbortSignal): Promise<Markup[]> {
    if (items.length === 0) {
      return []
    }

    const documents: GetContentsItem[] = items.map(({ document, source }) => ({
      documentId: encodeDocumentId(this.workspace, document),
      source: source ?? undefined
    }))

    const res = await retry(
      3,
      async () => {
        return await this.rpc<GetContentsRequest, GetContentsResponse>(
          items[0].document,
          'getContents',
          { documents },
          signal
        )
      },
      50,
      signal
    )

    return items.map(({ document }, i) => res.contents[documents[i].documentId]?.[document.objectAttr] ?? '')
  }

  async createMarkup (document: CollaborativeDoc, markup: Markup, signal?: AbortSignal): Promise<MarkupBlobRef> {
    const content = {
      [document.objectAttr]: markup
    }

    const res = await retry(
      3,
      async () => {
        return await this.rpc<CreateContentRequest, CreateContentResponse>(document, 'createContent', { content }, signal)
      },
      50,
      signal
    )

    return res.content[document.objectAttr]
  }

  async updateMarkup (document: CollaborativeDoc, markup: Markup, signal?: AbortSignal): Promise<void> {
    const content = {
      [document.objectAttr]: markup
    }

    await retry(
      3,
      async () => {
        await this.rpc<UpdateContentRequest, UpdateContentResponse>(document, 'updateContent', { content }, signal)
      },
      50,
      signal
    )
  }

  async copyContent (
    source: CollaborativeDoc,
    target: CollaborativeDoc,
    content?: Ref<Blob>,
    signal?: AbortSignal
  ): Promise<void> {
    const markup = await this.getMarkup(source, content, signal)
    await this.updateMarkup(target, markup, signal)
  }
}

function abortError (signal?: AbortSignal): Error {
  const reason = signal?.reason
  if (reason instanceof Error) {
    return reason
  }
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

function throwIfAborted (signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw abortError(signal)
  }
}

/**
 * Waits for the retry delay unless the owning call is cancelled. Cancelling
 * clears the timer, so a timed-out call leaves no retry behind.
 */
async function delay (ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  if (signal === undefined) {
    await new Promise((resolve) => setTimeout(resolve, ms))
    return
  }

  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onAbort = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer)
      }
      reject(abortError(signal))
    }
    timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
    }
  })
}

async function retry<T> (
  retries: number,
  op: () => Promise<T>,
  delayMs: number = 100,
  signal?: AbortSignal
): Promise<T> {
  let error: any
  throwIfAborted(signal)
  while (retries > 0) {
    retries--
    try {
      return await op()
    } catch (err: any) {
      // A cancelled call owns no further attempt, including for writes. The
      // caller decides how to read back an uncertain write.
      if (signal?.aborted === true) {
        throw abortError(signal)
      }
      error = err
      if (retries !== 0) {
        await delay(delayMs, signal)
      }
    }
  }
  throw error
}
