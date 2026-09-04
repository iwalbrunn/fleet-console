// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { anforderungenAendern, createSessionRuntime, leererKnoten } from '../session-runtime'
import type { Anforderung, SessionState } from '../types'

function state(): SessionState {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    claudeSessionId: null,
    project: '/tmp/project',
    model: 'sonnet',
    roles: [],
    prompt: 'x',
    skipPermissions: false,
    startedAt: '2026-08-15T08:00:00.000Z',
    endedAt: null,
    status: 'läuft',
    tokensIn: 0,
    tokensOut: 0,
    tokensCached: 0,
    tokensCacheWrite: 0,
    anfragen: 0,
    kostenUsd: 0,
    anforderungen: [],
    worktreePath: null,
    worktreeBasis: null,
    nodes: [leererKnoten('orchestrator')],
    antworten: [],
    log: [],
    reportPath: null,
    cli: '',
    pipelineAktiv: false,
    pipelineRollen: [],
  }
}

const eintrag = (id: string): Anforderung => ({ id, t: 't', text: id, status: 'offen' })

describe('anforderungenAendern', () => {
  test('serialisiert nebenläufige Änderungen — ein langsamer Merge überschreibt kein Append', async () => {
    const runtime = createSessionRuntime(state(), { persist: async () => {} })

    // Langsamer "merge": sieht nur den Stand von vor dem Append.
    const langsam = anforderungenAendern(runtime, async (aktuell) => {
      await new Promise((r) => setTimeout(r, 30))
      return aktuell.map((e) => ({ ...e }))
    })
    const schnell = anforderungenAendern(runtime, async (aktuell) => [...aktuell, eintrag('a1')])
    await Promise.all([langsam, schnell])

    expect(runtime.state.anforderungen.map((e) => e.id)).toEqual(['a1'])
  })

  test('ein Fehler unterbricht die Kette nicht', async () => {
    const runtime = createSessionRuntime(state(), { persist: async () => {} })
    await expect(
      anforderungenAendern(runtime, async () => {
        throw new Error('kaputt')
      })
    ).rejects.toThrow('kaputt')
    await anforderungenAendern(runtime, async (aktuell) => [...aktuell, eintrag('a1')])
    expect(runtime.state.anforderungen).toHaveLength(1)
  })
})
