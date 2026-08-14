import { test, expect, describe, beforeAll, afterAll } from 'vitest'

const ORIGINAL_ENV = process.env

describe('Config', () => {
  beforeAll(() => {
    process.env = { ...ORIGINAL_ENV }
    delete process.env.FLEET_PIPELINE_PARALLEL
    delete process.env.FLEET_ROLE_TIMEOUT_SEC
    delete process.env.FLEET_GRACE_SEC
    delete process.env.FLEET_DIFF_MAX
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  test('has expected configs defined or defaults', async () => {
    const config = await import('../config')
    expect(config.PIPELINE_PARALLEL).toBe(3)
    expect(config.ROLE_TIMEOUT_SEC).toBe(900)
    expect(config.GRACE_SEC).toBe(10)
    expect(config.DIFF_MAX).toBe(60000)
  })
})
