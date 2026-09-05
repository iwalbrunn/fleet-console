// @vitest-environment node
import { expect, test } from 'vitest'
import { parseQuota } from '../quota'
test('reads actual CLI unified windows, including zero, without exposing other data', () => {
  const quota = parseQuota(
    {
      status: 'allowed',
      unifiedWindows: {
        five_hour: { utilization: 0, resetsAt: 1800000000 },
        seven_day: { utilization: 0.01, resetsAt: 1800500000 },
      },
      unexpected: 'private',
    },
    '2026-09-05T08:00:00Z'
  )!
  expect(quota.windows).toEqual([
    { type: 'five_hour', usedPercent: 0, resetsAt: 1800000000 },
    { type: 'seven_day', usedPercent: 1, resetsAt: 1800500000 },
  ])
  expect(quota).not.toHaveProperty('unexpected')
})
test('missing or invalid utilization is unknown, never zero', () => {
  expect(
    parseQuota({ status: 'allowed', rateLimitType: 'five_hour' })!.windows[0].usedPercent
  ).toBeNull()
  expect(
    parseQuota({ status: 'rejected', rateLimitType: 'five_hour', utilization: 90 })!.windows[0]
      .usedPercent
  ).toBeNull()
  expect(parseQuota(null)).toBeNull()
})
