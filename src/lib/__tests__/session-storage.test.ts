// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createSessionStore } from '../session-storage'
import type { SessionState } from '../types'

function sessionState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    claudeSessionId: 'claude-1',
    project: '/tmp/project',
    model: 'sonnet',
    roles: ['senior-developer'],
    prompt: 'Prüfe den Stand',
    skipPermissions: false,
    startedAt: '2026-08-15T08:00:00.000Z',
    endedAt: null,
    status: 'läuft',
    tokensIn: 10,
    tokensOut: 20,
    tokensCached: 30,
    tokensCacheWrite: 5,
    anfragen: 1,
    kostenUsd: 0.25,
    anforderungen: [],
    worktreePath: null,
    worktreeBasis: null,
    nodes: [],
    antworten: [],
    log: [],
    reportPath: null,
    cli: 'claude -p',
    pipelineAktiv: true,
    pipelineRollen: ['senior-developer'],
    ...overrides,
  }
}

describe('Session-Ablage', () => {
  let directory: string
  let runsDirectory: string
  let reportsDirectory: string

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fleet-storage-'))
    runsDirectory = path.join(directory, 'runs')
    reportsDirectory = path.join(directory, 'reports')
  })

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true })
  })

  test('lädt ältere laufende Ablagen kompatibel als unterbrochene Sessions', async () => {
    const store = createSessionStore({ runsDirectory, reportsDirectory })
    const legacy = sessionState({
      kostenUsd: undefined as never,
      anforderungen: undefined as never,
    })
    legacy.nodes = [
      {
        id: 'orchestrator',
        status: 'running',
        phase: 'arbeitet',
        tokensOut: 0,
        tokensIn: 0,
        anfragen: 0,
        calls: 0,
        order: 0,
        auftrag: '',
        ergebnis: '',
        volltext: '',
        bericht: null,
        quelle: null,
        startedAt: null,
        endedAt: null,
        kostenUsd: undefined as never,
        befunde: undefined as never,
        nachpruefungen: undefined as never,
      },
    ]
    await fs.mkdir(runsDirectory, { recursive: true })
    await fs.writeFile(
      path.join(runsDirectory, `${legacy.id}.json`),
      JSON.stringify(legacy),
      'utf8'
    )

    const loaded = await store.loadAll()

    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toMatchObject({
      status: 'unterbrochen',
      pipelineAktiv: false,
      kostenUsd: 0,
      anforderungen: [],
      worktreePath: null,
      worktreeBasis: null,
    })
    expect(loaded[0].nodes[0]).toMatchObject({
      kostenUsd: 0,
      befunde: null,
      nachpruefungen: 0,
    })
  })

  test('persistiert Zustand und letzte Antwort als lesbaren Bericht', async () => {
    const store = createSessionStore({ runsDirectory, reportsDirectory })
    const state = sessionState({ status: 'fertig', endedAt: '2026-08-15T08:10:00.000Z' })

    await store.persist(state, 'Die Umsetzung ist abgeschlossen.')

    const saved = JSON.parse(await fs.readFile(store.file(state.id), 'utf8')) as SessionState
    expect(saved.reportPath).toBe(path.join(reportsDirectory, `${state.id}.md`))
    expect(await fs.readFile(saved.reportPath!, 'utf8')).toContain(
      'Die Umsetzung ist abgeschlossen.'
    )
  })

  test('schreibt Rollenberichte nur für sichere Rollennamen', async () => {
    const store = createSessionStore({ runsDirectory, reportsDirectory })
    const state = sessionState()

    const report = await store.writeRoleReport(
      state,
      'senior-developer',
      'Keine offenen Befunde.',
      '2026-08-15T08:12:00.000Z'
    )
    const rejected = await store.writeRoleReport(
      state,
      '../../fremd',
      'Darf nicht geschrieben werden.',
      '2026-08-15T08:12:00.000Z'
    )

    expect(report).toBe(path.join(reportsDirectory, `${state.id}-senior-developer.md`))
    expect(await fs.readFile(report!, 'utf8')).toContain('Keine offenen Befunde.')
    expect(rejected).toBeNull()
  })
})
