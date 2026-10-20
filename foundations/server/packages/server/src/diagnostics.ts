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

import { monitorEventLoopDelay, type IntervalHistogram } from 'perf_hooks'

/**
 * Diagnostics for the transactor stall investigation (JH-902454).
 *
 * Everything in this file is additive. It only measures and logs, it never
 * changes a limit, a timeout or a response.
 */

export const DEFAULT_RATE_LIMIT_LOG_INTERVAL_MS = 10 * 1000
export const MAX_SAMPLES_PER_KEY = 20000

export function envNumber (name: string, def: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') {
    return def
  }
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) {
    return def
  }
  return value
}

export function percentile (values: number[], p: number): number {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

export interface RateLimitRefusal {
  user: string
  service: string
  limit: number
  windowMs: number
  retryAfter?: number
  method: string
}

/**
 * Emits at most one warning per key per interval. The first refusal of a burst
 * is logged immediately. Refusals suppressed since the previous log are
 * reported in the count of the next line.
 */
export class RateLimitRefusalLogger {
  private readonly state = new Map<string, { lastLog: number, suppressed: number }>()

  constructor (
    private readonly log: (message: string, obj: Record<string, any>) => void,
    private readonly intervalMs: number = DEFAULT_RATE_LIMIT_LOG_INTERVAL_MS,
    private readonly now: () => number = Date.now
  ) {}

  refused (key: string, refusal: RateLimitRefusal): boolean {
    const now = this.now()
    const state = this.state.get(key)
    if (state !== undefined && now - state.lastLog < this.intervalMs) {
      state.suppressed++
      return false
    }
    const count = (state?.suppressed ?? 0) + 1
    this.state.set(key, { lastLog: now, suppressed: 0 })
    this.log('rate limit refused', { ...refusal, count })
    return true
  }
}

export interface KeyRequestStats {
  key: string
  user: string
  service: string
  requests: number
  refusals: number
  maxMs: number
  p95Ms: number
}

interface KeyAccumulator {
  key: string
  user: string
  service: string
  requests: number
  refusals: number
  times: number[]
  maxMs: number
}

/** Per user and service key request statistics for the one minute summary. */
export class MinuteRequestStats {
  private readonly keys = new Map<string, KeyAccumulator>()

  private get (key: string, user: string, service: string): KeyAccumulator {
    let acc = this.keys.get(key)
    if (acc === undefined) {
      acc = { key, user, service, requests: 0, refusals: 0, times: [], maxMs: 0 }
      this.keys.set(key, acc)
    }
    return acc
  }

  request (key: string, user: string, service: string, timeMs: number): void {
    const acc = this.get(key, user, service)
    acc.requests++
    acc.maxMs = Math.max(acc.maxMs, timeMs)
    if (acc.times.length < MAX_SAMPLES_PER_KEY) {
      acc.times.push(timeMs)
    }
  }

  refusal (key: string, user: string, service: string): void {
    this.get(key, user, service).refusals++
  }

  drain (): KeyRequestStats[] {
    const result: KeyRequestStats[] = []
    for (const acc of this.keys.values()) {
      result.push({
        key: acc.key,
        user: acc.user,
        service: acc.service,
        requests: acc.requests,
        refusals: acc.refusals,
        maxMs: acc.maxMs,
        p95Ms: percentile(acc.times, 95)
      })
    }
    this.keys.clear()
    return result
  }
}

export interface SlowRequestRecord {
  method: string
  user: string
  service: string
  sessionId: string
  queuedMs: number
  executionMs: number
  totalMs: number
  class?: string
  queryKeys?: string[]
  resultCount?: number
  source: 'websocket' | 'rpc'
}

/**
 * Tracks the hello to first response time for each session. Used to find
 * sessions that connected but never finished their first find or load model.
 */
export class ConnectTimings {
  private readonly helloAt = new Map<string, number>()
  private readonly completed = new Set<string>()
  private readonly responded = new Set<string>()

  hello (sessionId: string, time: number = Date.now()): void {
    this.helloAt.set(sessionId, time)
    this.completed.delete(sessionId)
    this.responded.delete(sessionId)
  }

  /** Returns the hello to completion time for the first completion, or undefined. */
  complete (sessionId: string, time: number = Date.now()): number | undefined {
    const start = this.helloAt.get(sessionId)
    if (start === undefined || this.completed.has(sessionId)) {
      return undefined
    }
    this.completed.add(sessionId)
    this.requestCompleted(sessionId)
    return time - start
  }

  requestCompleted (sessionId: string): void {
    if (this.helloAt.has(sessionId)) this.responded.add(sessionId)
  }

  isWaiting (sessionId: string): boolean {
    return this.helloAt.has(sessionId) && !this.responded.has(sessionId)
  }

  remove (sessionId: string): void {
    this.helloAt.delete(sessionId)
    this.completed.delete(sessionId)
    this.responded.delete(sessionId)
  }
}

export interface EventLoopSample {
  p50Ms: number
  p99Ms: number
}

/**
 * Wraps perf_hooks.monitorEventLoopDelay. The histogram is reset after every
 * sample, so each sample covers the interval since the previous one.
 */
export class EventLoopDelayMonitor {
  private readonly histogram: IntervalHistogram | undefined

  constructor (enabled: boolean = true, histogram?: IntervalHistogram) {
    if (histogram !== undefined) {
      this.histogram = histogram
    } else if (enabled) {
      try {
        this.histogram = monitorEventLoopDelay({ resolution: 10 })
        this.histogram.enable()
      } catch {
        this.histogram = undefined
      }
    }
  }

  sample (): EventLoopSample | undefined {
    const histogram = this.histogram
    if (histogram === undefined) {
      return undefined
    }
    const p50Ms = Math.round(histogram.percentile(50) / 1e3) / 1e3
    const p99Ms = Math.round(histogram.percentile(99) / 1e3) / 1e3
    histogram.reset()
    return { p50Ms, p99Ms }
  }

  disable (): void {
    this.histogram?.disable()
  }
}

/** Keys only, never values, for logging a query shape. */
export function queryKeys (query: any): string[] {
  if (query === undefined || query === null || typeof query !== 'object') {
    return []
  }
  return Object.keys(query)
}
