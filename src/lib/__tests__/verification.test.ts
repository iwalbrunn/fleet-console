// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { assessRisk } from '../verification'

describe('risk-based verification routing', () => {
  test('keeps a small local change low risk', () => {
    expect(assessRisk(['src/lib/format.ts']).risk).toBe('low')
  })

  test('routes auth and UI changes to relevant focuses', () => {
    const result = assessRisk(['src/app/api/auth/route.ts', 'src/components/Login.tsx'])
    expect(result.risk).toBe('high')
    expect(result.focuses).toContain('Security und Berechtigungen')
    expect(result.focuses).toContain('UX, Accessibility und visuelle Regressionen')
  })
})
