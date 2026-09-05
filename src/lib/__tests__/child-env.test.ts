// @vitest-environment node
import { expect, test } from 'vitest'
import { childEnvironment } from '../child-env'
test('does not poison CLI and npm with the Next production runtime', () => {
  const source = {
    NODE_ENV: 'production',
    NEXT_RUNTIME: 'nodejs',
    PATH: '/bin',
    CUSTOM: 'keep',
  } as const
  expect(childEnvironment(source)).toEqual({ PATH: '/bin', CUSTOM: 'keep' } as const)
  expect(source.NODE_ENV).toBe('production')
})
