// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { startClaudeProcess } from '../claude-process'
import { createSessionRuntime, leererKnoten } from '../session-runtime'
import type { SessionState } from '../types'

function state(project: string): SessionState {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    claudeSessionId: null,
    project,
    model: 'sonnet',
    roles: [],
    prompt: 'Antworte kurz',
    skipPermissions: false,
    startedAt: '2026-08-15T08:00:00.000Z',
    endedAt: null,
    status: 'startet',
    tokensIn: 0,
    tokensOut: 0,
    tokensCached: 0,
    tokensCacheWrite: 0,
    anfragen: 0,
    kostenUsd: 0,
    anforderungen: [],
    worktreePath: null,
    worktreeBasis: null,
    nodes: [{ ...leererKnoten('orchestrator'), status: 'running', order: 0 }],
    antworten: [],
    log: [],
    reportPath: null,
    cli: '',
    pipelineAktiv: false,
    pipelineRollen: [],
  }
}

describe('Claude-Prozesslebenszyklus', () => {
  let directory: string
  let binary: string

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fleet-process-'))
    binary = path.join(directory, 'fake-claude.mjs')
    await fs.writeFile(
      binary,
      [
        '#!/usr/bin/env node',
        "const line = (value) => process.stdout.write(JSON.stringify(value) + '\\n')",
        "line({ type: 'system', subtype: 'init', session_id: 'claude-test', model: 'sonnet', tools: [] })",
        "line({ type: 'assistant', message: { id: 'msg-1', usage: { input_tokens: 4, output_tokens: 6 }, content: [{ type: 'text', text: 'Fertig.' }] } })",
        "line({ type: 'result', subtype: 'success', total_cost_usd: 0.1 })",
      ].join('\n'),
      'utf8'
    )
    await fs.chmod(binary, 0o755)
  })

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true })
  })

  test('verarbeitet den JSONL-Stream und schließt eine erfolgreiche Session ab', async () => {
    const runtime = createSessionRuntime(state(directory), { persist: async () => {} })
    const ended = new Promise<void>((resolve) => {
      runtime.subscribers.add((chunk) => {
        if (chunk.startsWith('event: end\n')) resolve()
      })
    })

    expect(startClaudeProcess(runtime, [], { binary })).toBe(true)
    await ended

    expect(runtime.state).toMatchObject({
      status: 'fertig',
      claudeSessionId: 'claude-test',
      tokensIn: 4,
      tokensOut: 6,
      kostenUsd: 0.1,
    })
    expect(runtime.state.antworten.at(-1)?.text).toBe('Fertig.')
    expect(runtime.state.nodes[0]).toMatchObject({ status: 'done', phase: 'Abgeschlossen' })
  })
})
