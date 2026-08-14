import { describe, expect, test } from 'vitest'
import { rejectCrossOrigin } from '../http'

function req(headers: Record<string, string>) {
  return new Request('http://internal.invalid/api/x', { method: 'POST', headers })
}

describe('rejectCrossOrigin', () => {
  test('lässt Requests ohne Origin-Header durch', () => {
    expect(rejectCrossOrigin(req({ host: 'localhost:4300' }))).toBeNull()
  })

  test('lässt gleichen Origin/Host auf Loopback durch', () => {
    const res = rejectCrossOrigin(req({ origin: 'http://127.0.0.1:4300', host: '127.0.0.1:4300' }))
    expect(res).toBeNull()
  })

  test('blockiert fremden Origin', async () => {
    const res = rejectCrossOrigin(req({ origin: 'https://evil.example', host: '127.0.0.1:4300' }))
    expect(res?.status).toBe(403)
  })

  test('blockiert Origin, dessen Host nicht zum Host-Header passt (DNS-Rebinding)', async () => {
    const res = rejectCrossOrigin(req({ origin: 'http://127.0.0.1:9999', host: '127.0.0.1:4300' }))
    expect(res?.status).toBe(403)
  })
})
