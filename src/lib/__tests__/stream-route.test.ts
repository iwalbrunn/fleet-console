// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  unsubscribe: vi.fn(),
  getSession: vi.fn(),
  listSessions: vi.fn(),
  subscribe: vi.fn(),
}))
vi.mock('@/lib/sessions', () => mocks)
import { GET } from '../../app/api/sessions/[id]/stream/route'
afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})
test('releases heartbeat and subscriber on request abort', async () => {
  vi.useFakeTimers()
  mocks.getSession.mockReturnValue({ id: 'one' })
  mocks.subscribe.mockReturnValue(mocks.unsubscribe)
  const abort = new AbortController()
  const response = await GET(
    new Request('http://localhost/api/sessions/one/stream', { signal: abort.signal }),
    { params: Promise.resolve({ id: 'one' }) }
  )
  expect(vi.getTimerCount()).toBe(1)
  abort.abort()
  expect(mocks.unsubscribe).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
  await response.body!.cancel()
  expect(mocks.unsubscribe).toHaveBeenCalledOnce()
})
test('releases heartbeat when stream reader is cancelled', async () => {
  vi.useFakeTimers()
  mocks.getSession.mockReturnValue({ id: 'one' })
  mocks.subscribe.mockReturnValue(mocks.unsubscribe)
  const response = await GET(new Request('http://localhost/api/sessions/one/stream'), {
    params: Promise.resolve({ id: 'one' }),
  })
  await response.body!.cancel()
  expect(mocks.unsubscribe).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
test('streams archived state once without reconnect loop', async () => {
  mocks.listSessions.mockResolvedValue([{ id: 'old' }])
  mocks.subscribe.mockReturnValue(null)
  const response = await GET(new Request('http://localhost/api/sessions/old/stream'), {
    params: Promise.resolve({ id: 'old' }),
  })
  expect(await response.text()).toContain('event: archived')
})
