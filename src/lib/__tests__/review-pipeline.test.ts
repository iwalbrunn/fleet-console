// @vitest-environment node
import { execFile as execFileCallback } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { VERDICT_SCHEMA } from '../review-verdict'
import { collectWorkingState, runPipeline, runRoleProcess } from '../review-pipeline'
import { createSessionRuntime, leererKnoten, registry } from '../session-runtime'
import type { SessionState } from '../types'

const execFile = promisify(execFileCallback)

function sessionState(project: string): SessionState {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    claudeSessionId: 'claude-review',
    project,
    model: 'sonnet',
    roles: ['senior-developer'],
    prompt: 'Prüfe den Stand',
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
    nodes: [leererKnoten('orchestrator'), leererKnoten('senior-developer')],
    antworten: [],
    log: [],
    reportPath: null,
    cli: '',
    pipelineAktiv: false,
    pipelineRollen: [],
  }
}

describe('Review-Arbeitsstand', () => {
  let directory: string
  let project: string

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fleet-review-'))
    project = path.join(directory, 'project')
    await fs.mkdir(project)
    await execFile('git', ['init', '-b', 'main'], { cwd: project })
    await execFile('git', ['config', 'user.email', 'fleet@example.test'], { cwd: project })
    await execFile('git', ['config', 'user.name', 'Fleet Test'], { cwd: project })
    await fs.writeFile(path.join(project, 'tracked.ts'), 'export const value = 1\n', 'utf8')
    await execFile('git', ['add', 'tracked.ts'], { cwd: project })
    await execFile('git', ['commit', '-m', 'Initial'], { cwd: project })
  })

  afterEach(async () => {
    registry.clear()
    await fs.rm(directory, { recursive: true, force: true })
  })

  test('sammelt verfolgte Änderungen und neue Textdateien in einem gemeinsamen Stand', async () => {
    await fs.writeFile(path.join(project, 'tracked.ts'), 'export const value = 2\n', 'utf8')
    await fs.writeFile(path.join(project, 'new.ts'), 'export const added = true\n', 'utf8')

    const state = await collectWorkingState(project)

    expect(state).toMatchObject({
      dateien: 2,
      gekuerzt: false,
    })
    expect([...(state?.pfade ?? [])].sort()).toEqual(['new.ts', 'tracked.ts'])
    expect(state?.text).toContain('git diff HEAD')
    expect(state?.text).toContain('export const added = true')
  })

  test('liefert außerhalb eines Git-Repositories keinen Arbeitsstand', async () => {
    expect(await collectWorkingState(directory)).toBeNull()
  })

  test('startet für einen sauberen Stand keinen unnötigen Rollenprozess', async () => {
    const runtime = createSessionRuntime(sessionState(project), { persist: async () => {} })
    registry.set(runtime.state.id, runtime)

    await expect(runPipeline(runtime.state.id, ['senior-developer'])).resolves.toEqual({
      ok: false,
      error: 'Keine uncommitteten Änderungen — es gibt nichts zu prüfen.',
    })
  })

  test('liest strukturiertes Verdict und Verbrauch eines Rollenprozesses', async () => {
    const binary = path.join(directory, 'fake-role.mjs')
    await fs.writeFile(
      binary,
      [
        '#!/usr/bin/env node',
        "const line = (value) => process.stdout.write(JSON.stringify(value) + '\\n')",
        "line({ type: 'assistant', message: { id: 'role-msg', usage: { input_tokens: 7, output_tokens: 9 }, content: [{ type: 'text', text: 'Review abgeschlossen.' }] } })",
        "line({ type: 'result', total_cost_usd: 0.2, structured_output: { verdict: 'ok', befunde: [], zusammenfassung: 'Keine Befunde.' } })",
      ].join('\n'),
      'utf8'
    )
    await fs.chmod(binary, 0o755)
    const runtime = createSessionRuntime(sessionState(project), { persist: async () => {} })

    const result = await runRoleProcess(
      runtime,
      'senior-developer',
      null,
      'Prüfe den Diff',
      VERDICT_SCHEMA,
      { binary, timeoutSec: 5 }
    )

    expect(result).toMatchObject({
      text: 'Review abgeschlossen.',
      struktur: { verdict: 'ok', befunde: [], zusammenfassung: 'Keine Befunde.' },
      tokensIn: 7,
      tokensOut: 9,
      anfragen: 1,
      kostenUsd: 0.2,
      status: 'done',
      fehler: null,
    })
  })
})
