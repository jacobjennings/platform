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

// Pure helpers for the activity feed. Kept free of UI imports so the query
// and read-state rules can be unit tested without a Huly client.

import type { ActivityMessage } from '@hcengineering/activity'
import type { Class, Doc, DocumentQuery, Ref, Space, Timestamp } from '@hcengineering/core'

/** Messages loaded per page. The feed loads one more page each time the user asks for more. */
export const FEED_PAGE_SIZE = 200

/** Per-user read state for the feed. Kept apart from Inbox notifications. */
export interface FeedReadState {
  /** Every message at or before this time counts as read in every document. */
  allReadUntil: Timestamp
  /** Per document, every message at or before this time counts as read. */
  docs: Record<string, Timestamp>
}

/** One card in the feed: all loaded messages for one document, newest first. */
export interface FeedGroup {
  docId: Ref<Doc>
  docClass: Ref<Class<Doc>>
  space: Ref<Space>
  messages: ActivityMessage[]
  lastTime: Timestamp
  unreadCount: number
}

/** The subset of the browser Storage API the feed needs. */
export interface FeedStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

export function emptyFeedReadState (): FeedReadState {
  return { allReadUntil: 0, docs: {} }
}

export function feedReadStateKey (account: string): string {
  return `activity-feed-read:${account}`
}

export function feedProjectKey (account: string): string {
  return `activity-feed-project:${account}`
}

export function messageTime (message: ActivityMessage): Timestamp {
  return message.createdOn ?? message.modifiedOn
}

/** Picks the newest preview even when combined messages arrive oldest first. */
export function newestFeedMessage<T extends ActivityMessage> (messages: T[]): T | undefined {
  return messages.reduce<T | undefined>(
    (newest, message) => newest === undefined || messageTime(message) > messageTime(newest) ? message : newest,
    undefined
  )
}

/**
 * The live query for the feed. With no project it matches every space the
 * server lets the user read. With a project it matches that space only.
 */
export function feedMessagesQuery (project: Ref<Space> | undefined): DocumentQuery<ActivityMessage> {
  return project === undefined ? {} : { space: project }
}

export function nextFeedLimit (limit: number): number {
  return limit + FEED_PAGE_SIZE
}

/** A page that came back full may have older messages behind it. */
export function hasMoreFeedMessages (loaded: number, limit: number): boolean {
  return loaded >= limit
}

export function isFeedMessageUnread (message: ActivityMessage, state: FeedReadState): boolean {
  const readUntil = Math.max(state.allReadUntil, state.docs[message.attachedTo] ?? 0)
  return messageTime(message) > readUntil
}

/** Groups messages by the document they are attached to. Newest group first. */
export function groupFeedMessages (messages: ActivityMessage[], state: FeedReadState): FeedGroup[] {
  const byDoc = new Map<Ref<Doc>, ActivityMessage[]>()
  for (const message of messages) {
    const list = byDoc.get(message.attachedTo)
    if (list === undefined) {
      byDoc.set(message.attachedTo, [message])
    } else {
      list.push(message)
    }
  }

  const groups: FeedGroup[] = []
  for (const [docId, list] of byDoc) {
    const sorted = [...list].sort((a, b) => messageTime(b) - messageTime(a))
    const newest = sorted[0]
    groups.push({
      docId,
      docClass: newest.attachedToClass,
      space: newest.space,
      messages: sorted,
      lastTime: messageTime(newest),
      unreadCount: sorted.filter((message) => isFeedMessageUnread(message, state)).length
    })
  }

  return groups.sort((a, b) => b.lastTime - a.lastTime)
}

/** Marks one document read up to the given time. Never moves a read mark backwards. */
export function markFeedDocRead (state: FeedReadState, docId: Ref<Doc>, time: Timestamp): FeedReadState {
  const docs = { ...state.docs, [docId]: Math.max(state.docs[docId] ?? 0, time) }
  return pruneFeedReadState({ allReadUntil: state.allReadUntil, docs })
}

/** Marks every loaded message read up to the given time, and drops per-document marks it covers. */
export function markAllFeedRead (state: FeedReadState, time: Timestamp): FeedReadState {
  return pruneFeedReadState({ allReadUntil: Math.max(state.allReadUntil, time), docs: state.docs })
}

function pruneFeedReadState (state: FeedReadState): FeedReadState {
  const docs: Record<string, Timestamp> = {}
  for (const [docId, time] of Object.entries(state.docs)) {
    if (time > state.allReadUntil) {
      docs[docId] = time
    }
  }
  return { allReadUntil: state.allReadUntil, docs }
}

/** Reads the stored state. A missing or damaged value gives an empty state, so nothing is lost but the marks. */
export function parseFeedReadState (raw: string | null): FeedReadState {
  if (raw === null || raw === '') {
    return emptyFeedReadState()
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      return emptyFeedReadState()
    }
    const { allReadUntil, docs } = parsed as { allReadUntil?: unknown, docs?: unknown }
    const docMarks: Record<string, Timestamp> = {}
    if (typeof docs === 'object' && docs !== null) {
      for (const [docId, time] of Object.entries(docs)) {
        if (typeof time === 'number') {
          docMarks[docId] = time
        }
      }
    }
    return pruneFeedReadState({
      allReadUntil: typeof allReadUntil === 'number' ? allReadUntil : 0,
      docs: docMarks
    })
  } catch {
    return emptyFeedReadState()
  }
}

export function loadFeedReadState (storage: FeedStorage, account: string): FeedReadState {
  return parseFeedReadState(storage.getItem(feedReadStateKey(account)))
}

export function saveFeedReadState (storage: FeedStorage, account: string, state: FeedReadState): void {
  storage.setItem(feedReadStateKey(account), JSON.stringify(state))
}

export function loadFeedProject (storage: FeedStorage, account: string): Ref<Space> | undefined {
  const raw = storage.getItem(feedProjectKey(account))
  return raw === null || raw === '' ? undefined : (raw as Ref<Space>)
}

export function saveFeedProject (storage: FeedStorage, account: string, project: Ref<Space> | undefined): void {
  storage.setItem(feedProjectKey(account), project ?? '')
}
