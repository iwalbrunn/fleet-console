// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { buildArgs, cliText, orchestratorAuftrag } from '../sessions'

describe('Claude-CLI-Vertrag', () => {
  test('startet eine rollenbegleitete Session mit Anforderungen und Schutzoptionen', () => {
    const anforderungen = '/tmp/fleet-anforderungen.json'
    const auftrag = orchestratorAuftrag(['senior-developer'], anforderungen)
    const args = buildArgs({
      model: 'sonnet',
      skipPermissions: true,
      roles: ['senior-developer'],
      anforderungenDatei: anforderungen,
    })

    expect(auftrag).toContain('senior-developer')
    expect(auftrag).toContain(anforderungen)
    expect(args).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--verbose',
      '--model',
      'sonnet',
      '--append-system-prompt',
      auftrag,
      '--forward-subagent-text',
      '--autocompact',
      '200000',
      '--dangerously-skip-permissions',
    ])

    const sichtbar = cliText(args)
    expect(sichtbar).toContain('«Rollenauftrag»')
    expect(sichtbar).not.toContain(anforderungen)
  })
})
