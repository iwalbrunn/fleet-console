// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { handleClaudeEvent } from '../claude-events'
import { createSessionRuntime, leererKnoten } from '../session-runtime'
import type { SessionState } from '../types'

function state(): SessionState {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    claudeSessionId: null,
    project: '/tmp/project',
    model: 'sonnet',
    roles: ['senior-developer'],
    prompt: 'Arbeite am Projekt',
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
    nodes: [{ ...leererKnoten('orchestrator'), status: 'running', order: 0 }],
    antworten: [],
    log: [],
    reportPath: null,
    cli: 'claude -p',
    pipelineAktiv: false,
    pipelineRollen: [],
  }
}

const effects = {
  updateRequirements: async () => {},
  writeRoleReport: async () => {},
}

describe('Claude-Stream-Ereignisse', () => {
  test('erfasst Initialisierung und Kontextinventar', () => {
    const runtime = createSessionRuntime(state(), { persist: async () => {} })

    handleClaudeEvent(
      runtime,
      {
        type: 'system',
        subtype: 'init',
        session_id: 'claude-session-123',
        model: 'sonnet',
        tools: ['Read', 'Bash'],
        agents: ['senior-developer'],
        slash_commands: ['test'],
        permissionMode: 'default',
        cwd: '/tmp/project',
      },
      effects
    )

    expect(runtime.state.claudeSessionId).toBe('claude-session-123')
    expect(runtime.state.nodes[0].phase).toBe('Kontext geladen')
    expect(runtime.state.log.at(-1)?.text).toContain('2 Tools')
  })

  test('zählt wiederholte Usage derselben API-Nachricht nur einmal', () => {
    const runtime = createSessionRuntime(state(), { persist: async () => {} })
    const event = {
      type: 'assistant',
      message: {
        id: 'msg-1',
        usage: {
          input_tokens: 12,
          output_tokens: 30,
          cache_creation_input_tokens: 5,
          cache_read_input_tokens: 80,
        },
        content: [],
      },
    }

    handleClaudeEvent(runtime, event, effects)
    handleClaudeEvent(runtime, event, effects)

    expect(runtime.state).toMatchObject({
      tokensIn: 12,
      tokensOut: 30,
      tokensCached: 80,
      tokensCacheWrite: 5,
      anfragen: 1,
    })
    expect(runtime.state.nodes[0]).toMatchObject({ tokensIn: 12, tokensOut: 30, anfragen: 1 })
  })

  test('ordnet Agent-Auftrag und Tool-Ergebnis demselben Rollenknoten zu', () => {
    const runtime = createSessionRuntime(state(), { persist: async () => {} })

    handleClaudeEvent(
      runtime,
      {
        type: 'assistant',
        message: {
          id: 'msg-agent',
          content: [
            {
              type: 'tool_use',
              id: 'tool-1',
              name: 'Agent',
              input: {
                subagent_type: 'senior-developer',
                description: 'Prüft die Änderung',
                prompt: 'Prüfe den Diff',
              },
            },
          ],
        },
      },
      effects
    )
    handleClaudeEvent(
      runtime,
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-1',
              content: 'Keine offenen Befunde.',
            },
          ],
        },
      },
      effects
    )

    expect(runtime.state.nodes.find((node) => node.id === 'senior-developer')).toMatchObject({
      status: 'done',
      calls: 1,
      auftrag: 'Prüfe den Diff',
      volltext: 'Keine offenen Befunde.',
      quelle: 'agent-tool',
    })
    expect(runtime.pendingAgents.size).toBe(0)
  })

  test('addiert Prozesskosten zur Kostenbasis und fordert ausstehendes Review an', () => {
    const runtime = createSessionRuntime(state(), {
      persist: async () => {},
      kostenBasisUsd: 1.25,
    })

    handleClaudeEvent(
      runtime,
      { type: 'result', subtype: 'success', duration_ms: 2500, total_cost_usd: 0.5 },
      effects
    )

    expect(runtime.state.kostenUsd).toBe(1.75)
    expect(runtime.state.nodes[0].phase).toBe('Antwort abgeschlossen')
    expect(
      runtime.state.log.some((line) =>
        line.text.includes('Review über den Rollenlauf steht noch aus')
      )
    ).toBe(true)
  })
})
