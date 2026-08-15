import { describe, expect, it } from 'vitest'
import { neuerUsageZaehler, usageDelta } from '../usage'

describe('usageDelta', () => {
  it('zählt eine neue Nachricht voll und meldet sie als Anfrage', () => {
    const z = neuerUsageZaehler()
    const d = usageDelta(z, 'msg_1', { input_tokens: 12, output_tokens: 300, cache_creation_input_tokens: 40 })
    expect(d).toEqual({ in: 12, out: 300, cacheWrite: 40, neueNachricht: true })
  })

  it('zählt die identische Wiederholung derselben Nachricht nicht noch einmal', () => {
    // Die CLI schickt je Content-Block ein assistant-Event mit derselben
    // message.id und derselben Usage — genau der frühere Doppelzähl-Bug.
    const z = neuerUsageZaehler()
    const usage = { input_tokens: 12, output_tokens: 300, cache_creation_input_tokens: 40 }
    usageDelta(z, 'msg_1', usage)
    const d2 = usageDelta(z, 'msg_1', usage)
    const d3 = usageDelta(z, 'msg_1', usage)
    expect(d2).toEqual({ in: 0, out: 0, cacheWrite: 0, neueNachricht: false })
    expect(d3).toEqual({ in: 0, out: 0, cacheWrite: 0, neueNachricht: false })
  })

  it('zählt bei gewachsener Usage derselben Nachricht nur den Zuwachs', () => {
    const z = neuerUsageZaehler()
    usageDelta(z, 'msg_1', { input_tokens: 12, output_tokens: 100 })
    const d = usageDelta(z, 'msg_1', { input_tokens: 12, output_tokens: 260 })
    expect(d).toEqual({ in: 0, out: 160, cacheWrite: 0, neueNachricht: false })
  })

  it('zählt niemals negativ, wenn eine Angabe kleiner gemeldet wird', () => {
    const z = neuerUsageZaehler()
    usageDelta(z, 'msg_1', { output_tokens: 300 })
    const d = usageDelta(z, 'msg_1', { output_tokens: 200 })
    expect(d.out).toBe(0)
  })

  it('zählt verschiedene Nachrichten unabhängig', () => {
    const z = neuerUsageZaehler()
    usageDelta(z, 'msg_1', { input_tokens: 10, output_tokens: 100 })
    const d = usageDelta(z, 'msg_2', { input_tokens: 5, output_tokens: 50 })
    expect(d).toEqual({ in: 5, out: 50, cacheWrite: 0, neueNachricht: true })
  })

  it('zählt ohne Nachrichten-Id voll — dedupen lässt sich da nichts', () => {
    const z = neuerUsageZaehler()
    const d1 = usageDelta(z, undefined, { output_tokens: 100 })
    const d2 = usageDelta(z, undefined, { output_tokens: 100 })
    expect(d1.neueNachricht).toBe(true)
    expect(d2).toEqual({ in: 0, out: 100, cacheWrite: 0, neueNachricht: true })
  })

  it('vergisst alte Ids erst jenseits des Deckels', () => {
    const z = neuerUsageZaehler()
    for (let i = 0; i < 501; i++) usageDelta(z, `msg_${i}`, { output_tokens: 1 })
    // msg_0 ist verdrängt und würde wieder voll zählen; msg_500 nicht.
    expect(usageDelta(z, 'msg_0', { output_tokens: 1 }).neueNachricht).toBe(true)
    expect(usageDelta(z, 'msg_500', { output_tokens: 1 }).neueNachricht).toBe(false)
  })
})
