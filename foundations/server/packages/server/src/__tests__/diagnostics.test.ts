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

import { MeasureMetricsContext, type MeasureContext } from '@hcengineering/core'

jest.mock('@hcengineering/account-client', () => ({
  getClient: jest.fn(() => ({
    getWorkspaceInfo: jest.fn(),
    updateLastVisit: jest.fn(),
    getLoginWithWorkspaceInfo: jest.fn()
  }))
}))

jest.mock('@hcengineering/analytics', () => ({
  Analytics: { handleError: jest.fn() }
}))

jest.mock('../workspace', () => ({
  Workspace: jest.fn()
}))

jest.mock('../utils', () => ({
  sendResponse: jest.fn()
}))

jest.mock('../client', () => ({
  ClientSession: jest.fn()
}))

// eslint-disable-next-line import/first
import {
  ConnectTimings,
  envNumber,
  EventLoopDelayMonitor,
  MinuteRequestStats,
  percentile,
  queryKeys,
  RateLimitRefusalLogger
} from '../diagnostics'
// eslint-disable-next-line import/first
import { TSessionManager } from '../sessionManager'

describe('diagnostics helpers', () => {
  it('reads optional numeric environment values', () => {
    const previous = process.env.HULY_TEST_NUMBER
    try {
      delete process.env.HULY_TEST_NUMBER
      expect(envNumber('HULY_TEST_NUMBER', 7)).toBe(7)
      process.env.HULY_TEST_NUMBER = '42'
      expect(envNumber('HULY_TEST_NUMBER', 7)).toBe(42)
      process.env.HULY_TEST_NUMBER = 'not-a-number'
      expect(envNumber('HULY_TEST_NUMBER', 7)).toBe(7)
    } finally {
      if (previous === undefined) {
        delete process.env.HULY_TEST_NUMBER
      } else {
        process.env.HULY_TEST_NUMBER = previous
      }
    }
  })

  it('computes percentiles', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(percentile(values, 95)).toBe(95)
    expect(percentile([], 95)).toBe(0)
  })

  it('logs the query keys and not the values', () => {
    expect(queryKeys({ _id: 'secret-id', space: 'secret-space' })).toEqual(['_id', 'space'])
  })

  it('coalesces rate limit refusals to one line per key per interval', () => {
    let now = 1000
    const lines: Array<Record<string, any>> = []
    const logger = new RateLimitRefusalLogger((_message, obj) => lines.push(obj), 10000, () => now)

    const refusal = {
      user: 'user-1',
      service: 'front',
      limit: 1500,
      windowMs: 30000,
      retryAfter: 2000,
      method: 'findAll'
    }
    logger.refused('user-1front', refusal)
    now += 100
    logger.refused('user-1front', refusal)
    now += 100
    logger.refused('user-1front', refusal)

    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ user: 'user-1', service: 'front', limit: 1500, count: 1 })

    now += 10000
    logger.refused('user-1front', refusal)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toMatchObject({ user: 'user-1', service: 'front', count: 3 })
  })

  it('aggregates request statistics for the minute summary', () => {
    const stats = new MinuteRequestStats()
    stats.request('k', 'user-1', 'front', 10)
    stats.request('k', 'user-1', 'front', 20)
    stats.refusal('k', 'user-1', 'front')

    const drained = stats.drain()
    expect(drained).toHaveLength(1)
    expect(drained[0]).toMatchObject({ user: 'user-1', service: 'front', requests: 2, refusals: 1, maxMs: 20 })
    expect(stats.drain()).toHaveLength(0)
  })

  it('tracks hello to first response once per session', () => {
    const timings = new ConnectTimings()
    timings.hello('s1', 1000)
    expect(timings.isWaiting('s1')).toBe(true)
    expect(timings.complete('s1', 8000)).toBe(7000)
    expect(timings.isWaiting('s1')).toBe(false)
    expect(timings.complete('s1', 9000)).toBeUndefined()
  })

  it('samples event loop delay and resets the histogram', () => {
    const reset = jest.fn()
    const monitor = new EventLoopDelayMonitor(true, {
      percentile: (p: number) => (p === 50 ? 2e6 : 250e6),
      reset,
      disable: jest.fn()
    } as any)

    expect(monitor.sample()).toEqual({ p50Ms: 2, p99Ms: 250 })
    expect(reset).toHaveBeenCalledTimes(1)
  })
})

describe('session manager diagnostic lines', () => {
  let ctx: MeasureContext
  let manager: TSessionManager
  let warn: jest.SpyInstance
  let info: jest.SpyInstance

  const session = {
    sessionId: 'session-1',
    token: { account: 'user-1', extra: { service: 'front' } },
    workspace: { uuid: 'ws-1' },
    getUser: () => 'user-1' as any,
    requestResultCount: new Map<number | string, number>()
  } as any

  beforeEach(() => {
    ctx = new MeasureMetricsContext('test', {})
    warn = jest.spyOn(ctx, 'warn').mockImplementation(() => {})
    info = jest.spyOn(ctx, 'info').mockImplementation(() => {})
    const queue = {
      getProducer: jest.fn(() => ({ send: jest.fn(), close: jest.fn() })),
      createConsumer: jest.fn(() => ({ close: jest.fn() }))
    }
    manager = new TSessionManager(ctx, { pingTimeout: 10000, reconnectTimeout: 3 }, {} as any, undefined, '', true, false, queue as any, jest.fn())
    ;(manager as any).slowRequestMs = 100
    ;(manager as any).slowConnectMs = 5000
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('logs a rate limit refusal with the limiter fields', () => {
    ;(manager as any).logRateLimitRefusal(
      session,
      { remaining: 0, limit: 1500, current: 1500, reset: 0, retryAfter: 2000 },
      'findAll'
    )
    expect(warn).toHaveBeenCalledWith(
      'rate limit refused',
      expect.objectContaining({
        user: 'user-1',
        service: 'front',
        limit: 1500,
        windowMs: 30000,
        retryAfter: 2000,
        method: 'findAll',
        count: 1
      })
    )
  })

  it('logs a slow request with queued and execution time', () => {
    session.requestResultCount.set(7, 3)
    ;(manager as any).logSlowRequest(
      session,
      'findAll',
      ['class:Document', { space: 'secret-space', _id: 'secret-id' }],
      7,
      'websocket',
      1000,
      1200,
      2400
    )
    expect(warn).toHaveBeenCalledWith(
      'slow request',
      expect.objectContaining({
        method: 'findAll',
        class: 'class:Document',
        queryKeys: ['space', '_id'],
        resultCount: 3,
        user: 'user-1',
        service: 'front',
        sessionId: 'session-1',
        queuedMs: 200,
        executionMs: 1200,
        totalMs: 1400
      })
    )
  })

  it('logs a slow connect from hello to the first find response', () => {
    ;(manager as any).connectTimings.hello('session-1', 1000)
    ;(manager as any).logSlowRequest(session, 'findAll', ['class:Document', {}], 8, 'websocket', 6900, 6900, 7000)
    expect(warn).toHaveBeenCalledWith(
      'slow connect',
      expect.objectContaining({ sessionId: 'session-1', method: 'findAll', helloToResponseMs: 6000 })
    )
  })

  it('logs one minute summary line with per key request stats', () => {
    ;(manager as any).minuteRequestStats.request('user-1front', 'user-1', 'front', 25)
    ;(manager as any).minuteRequestStats.refusal('user-1front', 'user-1', 'front')
    ;(manager as any).connectTimings.hello('session-1', 1000)
    manager.sessions.set('socket-1', { session, socket: { id: 'socket-1' } as any, tickHash: 0 })

    ;(manager as any).logMinuteSummary()

    expect(info).toHaveBeenCalledWith(
      'minute summary',
      expect.objectContaining({
        sessions: 1,
        keys: [
          expect.objectContaining({
            user: 'user-1',
            service: 'front',
            requests: 1,
            refusals: 1,
            sessions: 1,
            helloNoRequest: 1
          })
        ]
      })
    )
  })

  it('logs an event loop delay warning at the minute boundary', () => {
    ;(manager as any).eventLoopWarnMs = 200
    ;(manager as any).eventLoopMonitor = new EventLoopDelayMonitor(true, {
      percentile: (p: number) => (p === 50 ? 3e6 : 400e6),
      reset: jest.fn(),
      disable: jest.fn()
    } as any)

    ;(manager as any).logMinuteSummary()

    expect(warn).toHaveBeenCalledWith(
      'event loop delay',
      expect.objectContaining({ p50Ms: 3, p99Ms: 400, thresholdMs: 200 })
    )
  })
})
