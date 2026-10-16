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

import type { ActivityMessage } from '@hcengineering/activity'
import type { Class, Doc, Ref, Space } from '@hcengineering/core'

import {
  FEED_PAGE_SIZE,
  type FeedReadState,
  type FeedStorage,
  emptyFeedReadState,
  feedMessagesQuery,
  feedProjectKey,
  feedReadStateKey,
  groupFeedMessages,
  hasMoreFeedMessages,
  isFeedMessageUnread,
  loadFeedProject,
  loadFeedReadState,
  markAllFeedRead,
  markFeedDocRead,
  nextFeedLimit,
  parseFeedReadState,
  saveFeedProject,
  saveFeedReadState
} from './feed-query'

const ACCOUNT = 'account-1'
const PROJECT_A = 'space-a' as Ref<Space>
const PROJECT_B = 'space-b' as Ref<Space>
const CLASS_ISSUE = 'tracker:class:Issue' as Ref<Class<Doc>>

function message (id: string, attachedTo: string, createdOn: number, space: Ref<Space> = PROJECT_A): ActivityMessage {
  return {
    _id: id,
    _class: 'activity:class:DocUpdateMessage',
    space,
    attachedTo,
    attachedToClass: CLASS_ISSUE,
    createdOn,
    modifiedOn: createdOn
  } as unknown as ActivityMessage
}

function memoryStorage (): FeedStorage & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    }
  }
}

describe('feedMessagesQuery', () => {
  it('matches every space when no project is chosen', () => {
    expect(feedMessagesQuery(undefined)).toEqual({})
  })

  it('matches only the chosen project', () => {
    expect(feedMessagesQuery(PROJECT_B)).toEqual({ space: PROJECT_B })
  })
})

describe('paging', () => {
  it('adds one page to the limit', () => {
    expect(nextFeedLimit(FEED_PAGE_SIZE)).toBe(FEED_PAGE_SIZE * 2)
  })

  it('offers more only when the page came back full', () => {
    expect(hasMoreFeedMessages(FEED_PAGE_SIZE, FEED_PAGE_SIZE)).toBe(true)
    expect(hasMoreFeedMessages(FEED_PAGE_SIZE - 1, FEED_PAGE_SIZE)).toBe(false)
  })
})

describe('groupFeedMessages', () => {
  it('groups by attached document, newest group first, newest message first', () => {
    const messages = [
      message('m1', 'doc-1', 100),
      message('m2', 'doc-2', 300),
      message('m3', 'doc-1', 200),
      message('m4', 'doc-2', 150)
    ]

    const groups = groupFeedMessages(messages, emptyFeedReadState())

    expect(groups.map((g) => g.docId)).toEqual(['doc-2', 'doc-1'])
    expect(groups[0].messages.map((m) => m._id)).toEqual(['m2', 'm4'])
    expect(groups[1].messages.map((m) => m._id)).toEqual(['m3', 'm1'])
    expect(groups[0].lastTime).toBe(300)
    expect(groups[0].docClass).toBe(CLASS_ISSUE)
    expect(groups[0].space).toBe(PROJECT_A)
  })

  it('returns no groups for no messages', () => {
    expect(groupFeedMessages([], emptyFeedReadState())).toEqual([])
  })

  it('counts unread messages per group', () => {
    const state: FeedReadState = { allReadUntil: 0, docs: { 'doc-1': 150 } }
    const messages = [message('m1', 'doc-1', 100), message('m2', 'doc-1', 200), message('m3', 'doc-2', 120)]

    const groups = groupFeedMessages(messages, state)
    const byId = new Map(groups.map((g) => [g.docId, g.unreadCount]))

    expect(byId.get('doc-1' as Ref<Doc>)).toBe(1)
    expect(byId.get('doc-2' as Ref<Doc>)).toBe(1)
  })
})

describe('read state', () => {
  it('treats a message as unread only after both read marks', () => {
    const msg = message('m1', 'doc-1', 500)

    expect(isFeedMessageUnread(msg, emptyFeedReadState())).toBe(true)
    expect(isFeedMessageUnread(msg, { allReadUntil: 500, docs: {} })).toBe(false)
    expect(isFeedMessageUnread(msg, { allReadUntil: 100, docs: { 'doc-1': 500 } })).toBe(false)
    expect(isFeedMessageUnread(msg, { allReadUntil: 100, docs: { 'doc-2': 900 } })).toBe(true)
  })

  it('marks one document read and never moves the mark backwards', () => {
    const once = markFeedDocRead(emptyFeedReadState(), 'doc-1' as Ref<Doc>, 400)
    const back = markFeedDocRead(once, 'doc-1' as Ref<Doc>, 200)

    expect(once.docs).toEqual({ 'doc-1': 400 })
    expect(back.docs).toEqual({ 'doc-1': 400 })
  })

  it('marks everything read and drops the document marks it covers', () => {
    const state: FeedReadState = { allReadUntil: 100, docs: { 'doc-1': 300, 'doc-2': 900 } }

    const next = markAllFeedRead(state, 600)

    expect(next).toEqual({ allReadUntil: 600, docs: { 'doc-2': 900 } })
  })

  it('never moves the global mark backwards', () => {
    expect(markAllFeedRead({ allReadUntil: 600, docs: {} }, 100).allReadUntil).toBe(600)
  })

  it('reads an empty state for missing or damaged values', () => {
    expect(parseFeedReadState(null)).toEqual(emptyFeedReadState())
    expect(parseFeedReadState('')).toEqual(emptyFeedReadState())
    expect(parseFeedReadState('not json')).toEqual(emptyFeedReadState())
    expect(parseFeedReadState('42')).toEqual(emptyFeedReadState())
    expect(parseFeedReadState('null')).toEqual(emptyFeedReadState())
  })

  it('drops document marks that are not numbers', () => {
    const raw = JSON.stringify({ allReadUntil: 10, docs: { 'doc-1': 20, 'doc-2': 'soon', 'doc-3': null } })

    expect(parseFeedReadState(raw)).toEqual({ allReadUntil: 10, docs: { 'doc-1': 20 } })
  })

  it('saves and loads per account', () => {
    const storage = memoryStorage()
    const state: FeedReadState = { allReadUntil: 700, docs: { 'doc-1': 800 } }

    saveFeedReadState(storage, ACCOUNT, state)

    expect(storage.values.has(feedReadStateKey(ACCOUNT))).toBe(true)
    expect(loadFeedReadState(storage, ACCOUNT)).toEqual(state)
    expect(loadFeedReadState(storage, 'account-2')).toEqual(emptyFeedReadState())
  })
})

describe('project choice', () => {
  it('defaults to all projects', () => {
    expect(loadFeedProject(memoryStorage(), ACCOUNT)).toBeUndefined()
  })

  it('remembers one project per account and clears back to all projects', () => {
    const storage = memoryStorage()

    saveFeedProject(storage, ACCOUNT, PROJECT_B)
    expect(storage.values.get(feedProjectKey(ACCOUNT))).toBe(PROJECT_B)
    expect(loadFeedProject(storage, ACCOUNT)).toBe(PROJECT_B)
    expect(loadFeedProject(storage, 'account-2')).toBeUndefined()

    saveFeedProject(storage, ACCOUNT, undefined)
    expect(loadFeedProject(storage, ACCOUNT)).toBeUndefined()
  })
})
