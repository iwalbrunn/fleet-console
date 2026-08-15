import { describe, expect, test } from 'vitest'
import { VERDICT_SCHEMA, verdictAlsText, verdictKurz } from '../sessions'
import type { RollenVerdict } from '../types'

describe('Review-Verdict-Vertrag', () => {
  test('unterscheidet offene und behobene Befunde in Bericht und Kurzfassung', () => {
    const verdict: RollenVerdict = {
      verdict: 'befunde',
      zusammenfassung: 'Zwei geprüfte Befunde.',
      befunde: [
        {
          schweregrad: 'hoch',
          datei: 'src/lib/sessions.ts',
          zeile: 42,
          titel: 'Offene Kopplung',
          beschreibung: 'Die Prozesslogik ist noch gekoppelt.',
          status: 'offen',
        },
        {
          schweregrad: 'mittel',
          datei: 'src/lib/types.ts',
          titel: 'Doppelter Vertrag',
          beschreibung: 'Der Vertrag wurde vereinheitlicht.',
          status: 'behoben',
        },
      ],
    }

    expect(verdictAlsText(verdict)).toBe(
      [
        'Zwei geprüfte Befunde.',
        '',
        '- [hoch] (offen) src/lib/sessions.ts:42 — Offene Kopplung: Die Prozesslogik ist noch gekoppelt.',
        '- [mittel] (behoben) src/lib/types.ts — Doppelter Vertrag: Der Vertrag wurde vereinheitlicht.',
      ].join('\n')
    )
    expect(verdictKurz(verdict)).toBe('1 Befund(e) · davon 1 hoch/kritisch · 1 behoben')
  })

  test('begrenzt strukturierte Rollenberichte auf zehn Befunde', () => {
    expect(VERDICT_SCHEMA.properties.befunde.maxItems).toBe(10)
    expect(VERDICT_SCHEMA.required).toEqual(['verdict', 'befunde'])
  })
})
