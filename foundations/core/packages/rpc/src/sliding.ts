import type { RateLimitInfo } from './rpc'

export class SlidingWindowRateLimitter {
  private readonly rateLimits = new Map<
  string,
  {
    requests: number[]
    resetTime: number
  }
  >()

  constructor (
    readonly rateLimitMax: number,
    readonly rateLimitWindow: number,
    readonly now: () => number = Date.now
  ) {
    this.rateLimitMax = rateLimitMax
    this.rateLimitWindow = rateLimitWindow
  }

  public checkRateLimit (groupId: string): RateLimitInfo {
    const now = this.now()
    const windowStart = now - this.rateLimitWindow

    let rateLimit = this.rateLimits.get(groupId)
    if (rateLimit == null) {
      rateLimit = { requests: [], resetTime: now + this.rateLimitWindow }
      this.rateLimits.set(groupId, rateLimit)
    }

    // Remove requests outside the current window. An accepted request is always
    // recorded at the time it was checked, so capacity is released on time.
    rateLimit.requests = rateLimit.requests.filter((time) => time > windowStart)

    if (rateLimit.requests.length >= this.rateLimitMax) {
      // Reject before recording anything. A rejected request must not consume
      // capacity and must not delay the capacity that accepted work releases.
      const oldest = rateLimit.requests[0]
      const nextAvailableTime = oldest !== undefined ? oldest + this.rateLimitWindow : now + this.rateLimitWindow
      rateLimit.resetTime = nextAvailableTime

      return {
        remaining: 0,
        limit: this.rateLimitMax,
        current: rateLimit.requests.length,
        reset: nextAvailableTime,
        retryAfter: Math.max(1, Math.min(this.rateLimitWindow, nextAvailableTime - now))
      }
    }

    rateLimit.requests.push(now)
    rateLimit.resetTime = now + this.rateLimitWindow

    return {
      remaining: this.rateLimitMax - rateLimit.requests.length,
      current: rateLimit.requests.length,
      limit: this.rateLimitMax,
      reset: rateLimit.resetTime
    }
  }

  // Add a reset method for testing purposes
  public reset (): void {
    this.rateLimits.clear()
  }
}
