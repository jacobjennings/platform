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

import { RateLimitWaitLogger } from '../rateLimitWait'

describe('RateLimitWaitLogger', () => {
  it('logs one line per wait burst with retryAfter and waiting count', () => {
    let now = 1000
    const lines: Array<{ message: string, obj: Record<string, any> }> = []
    const logger = new RateLimitWaitLogger((message, obj) => lines.push({ message, obj }), () => now)

    logger.wait(1500, 12)
    now += 100
    logger.wait(1500, 13)
    now += 100
    logger.wait(1500, 14)

    expect(lines).toHaveLength(1)
    expect(lines[0].message).toBe('rate limit wait')
    expect(lines[0].obj).toEqual({ retryAfterMs: 1500, waiting: 12, burstRefusals: 1 })
  })

  it('logs again after the burst has passed', () => {
    let now = 1000
    const lines: Array<Record<string, any>> = []
    const logger = new RateLimitWaitLogger((_message, obj) => lines.push(obj), () => now)

    logger.wait(500, 3)
    now += 600
    logger.wait(800, 5)

    expect(lines).toHaveLength(2)
    expect(lines[1]).toEqual({ retryAfterMs: 800, waiting: 5, burstRefusals: 1 })
  })
})
