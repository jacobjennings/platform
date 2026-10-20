import { SlidingWindowRateLimitter } from '../sliding'

describe('SlidingWindowRateLimitter', () => {
  let clock = 100000

  beforeEach(() => {
    // Mock Date.now to control time
    clock = 100000
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('should allow requests within the limit', () => {
    const limiter = new SlidingWindowRateLimitter(5, 60000, () => clock)

    for (let i = 0; i < 5; i++) {
      const result = limiter.checkRateLimit('user1')
      expect(result.remaining).toBe(5 - i - 1)
      expect(result.limit).toBe(5)
    }

    // The next request should hit the limit
    const result = limiter.checkRateLimit('user1')
    expect(result.remaining).toBe(0)
    expect(result.retryAfter).toBeDefined()
  })

  it('should reject requests beyond the limit', () => {
    const limiter = new SlidingWindowRateLimitter(3, 60000, () => clock)

    // Use up the limit
    limiter.checkRateLimit('user1')
    limiter.checkRateLimit('user1')
    limiter.checkRateLimit('user1')

    // This should be limited
    const result = limiter.checkRateLimit('user1')
    expect(result.remaining).toBe(0)
    expect(result.retryAfter).toBeDefined()
  })

  it('should allow new requests as the window slides', () => {
    const limiter = new SlidingWindowRateLimitter(2, 10000, () => clock)

    // Use up the limit
    limiter.checkRateLimit('user1')
    limiter.checkRateLimit('user1')

    // This should be limited
    expect(limiter.checkRateLimit('user1').remaining).toBe(0)

    // Move time forward by 5 seconds (half the window)
    clock += 5 * 1000 // 5 seconds

    // Should still have one request outside the current window
    // and one within, so we can make one more request
    const result = limiter.checkRateLimit('user1')
    expect(result.remaining).toBe(0) // Now at limit again

    // Move time forward by full window
    clock += 11 * 1000 // 1011 seconds

    // All previous requests should be outside the window
    const newResult = limiter.checkRateLimit('user1')
    expect(newResult.remaining).toBe(1) // One request used, one remaining
    expect(limiter.checkRateLimit('user1').remaining).toBe(0) // Now at limit again
  })

  it('should handle different identifiers separately', () => {
    const limiter = new SlidingWindowRateLimitter(2, 60000, () => clock)

    limiter.checkRateLimit('user1')
    limiter.checkRateLimit('user1')

    // User1 should be at limit
    expect(limiter.checkRateLimit('user1').remaining).toBe(0)

    // Different user should have separate limit
    expect(limiter.checkRateLimit('user2').remaining).toBe(1)
    expect(limiter.checkRateLimit('user2').remaining).toBe(0)

    // Both users should be at their limits
    expect(limiter.checkRateLimit('user1').remaining).toBe(0)
    expect(limiter.checkRateLimit('user2').remaining).toBe(0)
  })

  it('should handle sliding window correctly', () => {
    const limiter = new SlidingWindowRateLimitter(10, 60000, () => clock)

    // Use up half the capacity
    for (let i = 0; i < 5; i++) {
      limiter.checkRateLimit('user1')
    }

    // Move halfway through the window
    clock += 30 * 1000 + 1 // 30 seconds

    // Make some more requests
    for (let i = 0; i < 7; i++) {
      const result = limiter.checkRateLimit('user1')
      if (i < 5) {
        expect(result.remaining).toBeGreaterThanOrEqual(0)
      } else {
        expect(result.remaining).toBe(0)
        expect(result.retryAfter).toBeDefined()
        break
      }
    }
  })

  it('check for ban', () => {
    const limiter = new SlidingWindowRateLimitter(10, 10000, () => clock)

    for (let i = 0; i < 50; i++) {
      limiter.checkRateLimit('user1')
    }

    const r1 = limiter.checkRateLimit('user1')
    expect(r1.remaining).toBe(0)
    // Pass all window time.
    clock += 10000

    const r2 = limiter.checkRateLimit('user1')
    expect(r2.remaining).toBe(9)
  })
})

describe('SlidingWindowRateLimitter capacity accounting', () => {
  let clock = 100000

  beforeEach(() => {
    clock = 100000
  })

  it('accepts exactly the limit and rejects without consuming capacity', () => {
    const limiter = new SlidingWindowRateLimitter(3, 60000, () => clock)

    for (let i = 0; i < 3; i++) {
      const accepted = limiter.checkRateLimit('user1')
      expect(accepted.retryAfter).toBeUndefined()
      expect(accepted.remaining).toBe(2 - i)
    }

    // A rejection storm must not consume or postpone capacity. The old limiter
    // recorded rejected requests and pushed accepted ones into the future.
    for (let i = 0; i < 100; i++) {
      const rejected = limiter.checkRateLimit('user1')
      expect(rejected.remaining).toBe(0)
      expect(rejected.current).toBe(3)
      expect(rejected.retryAfter).toBeGreaterThanOrEqual(1)
      expect(rejected.retryAfter).toBeLessThanOrEqual(60000)
      expect(rejected.reset).toBe(100000 + 60000)
      clock += 1
    }

    // The first slot frees exactly one window after the first accepted request,
    // even though 100 more requests were attempted in between.
    clock = 100000 + 60000 + 1
    const accepted = limiter.checkRateLimit('user1')
    expect(accepted.retryAfter).toBeUndefined()
    expect(accepted.remaining).toBe(2)
    expect(accepted.current).toBe(1)
  })

  it('releases capacity at the window boundary', () => {
    const limiter = new SlidingWindowRateLimitter(2, 1000, () => clock)

    limiter.checkRateLimit('user1')
    limiter.checkRateLimit('user1')

    clock += 999
    const beforeBoundary = limiter.checkRateLimit('user1')
    expect(beforeBoundary.remaining).toBe(0)
    expect(beforeBoundary.retryAfter).toBe(1)

    clock += 1
    const atBoundary = limiter.checkRateLimit('user1')
    expect(atBoundary.retryAfter).toBeUndefined()
    expect(atBoundary.remaining).toBe(1)
  })

  it('bounds retry delays and recovers after a 1,500-request burst and rejection storm', () => {
    const window = 30000
    const max = 1500
    const limiter = new SlidingWindowRateLimitter(max, window, () => clock)
    const start = clock

    // A shared-account burst fills the exact 1,500-request budget.
    for (let i = 0; i < max; i++) {
      const accepted = limiter.checkRateLimit('shared-accountservice')
      expect(accepted.retryAfter).toBeUndefined()
    }
    expect(limiter.checkRateLimit('shared-accountservice').remaining).toBe(0)

    // 5,000 rejected sends over the first half of the window. Every retry delay
    // stays inside one window and points at accepted work, not at future work.
    for (let i = 0; i < 5000; i++) {
      const rejected = limiter.checkRateLimit('shared-accountservice')
      expect(rejected.remaining).toBe(0)
      expect(rejected.retryAfter).toBeGreaterThanOrEqual(1)
      expect(rejected.retryAfter).toBeLessThanOrEqual(window)
      expect(rejected.reset).toBe(start + window)
      clock += 3
    }

    clock = start + window - 1
    expect(limiter.checkRateLimit('shared-accountservice').retryAfter).toBe(1)

    // At the window boundary the whole budget is available again. The old
    // limiter extended the recovery by five windows after a storm this size.
    clock = start + window
    for (let i = 0; i < max; i++) {
      expect(limiter.checkRateLimit('shared-accountservice').retryAfter).toBeUndefined()
    }
    expect(limiter.checkRateLimit('shared-accountservice').remaining).toBe(0)
  })

  it('lets a throttled model load retry after no more than one window', () => {
    const window = 30000
    const limiter = new SlidingWindowRateLimitter(1500, window, () => clock)

    for (let i = 0; i < 1500; i++) {
      limiter.checkRateLimit('user1model-load')
    }

    const rejected = limiter.checkRateLimit('user1model-load')
    expect(rejected.remaining).toBe(0)
    expect(rejected.retryAfter).toBe(window)

    clock += rejected.retryAfter ?? 0
    const retried = limiter.checkRateLimit('user1model-load')
    expect(retried.retryAfter).toBeUndefined()
    expect(retried.remaining).toBe(1499)
  })

  it('keeps the account and service scope of the budget key', () => {
    const limiter = new SlidingWindowRateLimitter(1, 60000, () => clock)

    // One account and service share one budget across connections.
    expect(limiter.checkRateLimit('user1serviceA').retryAfter).toBeUndefined()
    expect(limiter.checkRateLimit('user1serviceA').retryAfter).toBeDefined()

    // The same account keeps a separate budget for another service.
    expect(limiter.checkRateLimit('user1serviceB').retryAfter).toBeUndefined()

    // Another account keeps its own budget for the same service.
    expect(limiter.checkRateLimit('user2serviceA').retryAfter).toBeUndefined()
  })
})
