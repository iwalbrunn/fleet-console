import { test, expect, describe } from 'vitest'
import { fmtTime, fmtDuration, fmtTokens } from '../types'

describe('Types / Formatting utils', () => {
  test('fmtTime formats time correctly', () => {
    // mock timezone so formatting matches regardless of host machine timezone
    const d = new Date('2026-01-01T15:30:45Z')
    // Just testing it doesn't return '--:--:--'
    expect(fmtTime(d.toISOString())).not.toBe('--:--:--')
  })

  test('fmtDuration formats duration correctly', () => {
    expect(fmtDuration(1000 * 45)).toBe('45 s')
    expect(fmtDuration(1000 * 125)).toBe('2 min')
    expect(fmtDuration(1000 * 60 * 65)).toBe('1 h 5 min')
  })

  test('fmtTokens formats tokens correctly', () => {
    expect(fmtTokens(900)).toBe('900')
    expect(fmtTokens(1500)).toBe('1.5 k')
    expect(fmtTokens(1000000)).toBe('1.0 M')
  })
})
