// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest'

async function loadWithRoots(roots: string) {
  vi.resetModules()
  vi.stubEnv('FLEET_PROJECT_ROOTS', roots)
  return import('../config')
}
afterEach(() => vi.unstubAllEnvs())

test('accepts the root itself and directories below it', async () => {
  const { isWithinProjectRoots } = await loadWithRoots('/srv/code:/opt/work')
  expect(isWithinProjectRoots('/srv/code')).toBe(true)
  expect(isWithinProjectRoots('/srv/code/app')).toBe(true)
  expect(isWithinProjectRoots('/opt/work/deep/er')).toBe(true)
})

test('rejects siblings, prefix look-alikes and traversal out of a root', async () => {
  const { isWithinProjectRoots } = await loadWithRoots('/srv/code')
  expect(isWithinProjectRoots('/srv')).toBe(false)
  expect(isWithinProjectRoots('/srv/codex')).toBe(false)
  expect(isWithinProjectRoots('/srv/code/../secrets')).toBe(false)
  expect(isWithinProjectRoots('/etc')).toBe(false)
})
