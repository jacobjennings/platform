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

import { decodeDocumentId, type GetContentsRequest, type GetContentsResponse } from '@hcengineering/collaborator-client'
import { MeasureContext } from '@hcengineering/core'
import { Context } from '../../context'
import { RpcMethodParams } from '../rpc'

/**
 * Reads the markup of many documents in one RPC call. Each document is still
 * loaded from storage, but the per-document HTTP request and the two workspace
 * lookups of the single-document path are paid once for the whole batch.
 */
export async function getContents (
  ctx: MeasureContext,
  context: Context,
  documentId: string,
  payload: GetContentsRequest,
  params: RpcMethodParams
): Promise<GetContentsResponse> {
  const { hocuspocus, transformer } = params
  const contents: GetContentsResponse['contents'] = {}

  await Promise.all(
    payload.documents.map(async (item) => {
      // Direct connections skip onAuthenticate, so the workspace check happens here.
      if (decodeDocumentId(item.documentId).workspaceId !== context.wsIds.uuid) {
        throw new Error('documentName must include workspace id')
      }

      const documentContext: Context = { ...context, content: item.source }
      const connection = await ctx.with('connect', {}, () => {
        return hocuspocus.openDirectConnection(item.documentId, documentContext)
      })

      try {
        const content = await ctx.with('transform', {}, async () => {
          const object: Record<string, string> = {}
          await connection.transact((document) => {
            document.share.forEach((_, field) => {
              object[field] = transformer.fromYdoc(document, field)
            })
          })
          return object
        })
        contents[item.documentId] = content
      } finally {
        await connection.disconnect()
      }
    })
  )

  return { contents }
}
