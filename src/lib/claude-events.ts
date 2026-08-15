import { HOME } from './config'
import { requirementStore } from './session-requirements'
import {
  emit,
  node,
  now,
  planeAblage,
  push,
  setNode,
  writeRoleReport,
  type SessionRuntime,
} from './session-runtime'
import { usageDelta, type StreamUsage } from './usage'

type JsonRecord = Record<string, unknown>

const ROLLENNAME = /^[A-Za-z0-9_-]+$/

function record(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null ? (value as JsonRecord) : null
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function streamUsage(value: unknown): StreamUsage | null {
  const usage = record(value)
  if (!usage) return null
  return {
    input_tokens: numeric(usage.input_tokens),
    output_tokens: numeric(usage.output_tokens),
    cache_creation_input_tokens: numeric(usage.cache_creation_input_tokens),
    cache_read_input_tokens: numeric(usage.cache_read_input_tokens),
  }
}

export interface ClaudeEventEffects {
  updateRequirements: (session: SessionRuntime) => void | Promise<void>
  writeRoleReport: (session: SessionRuntime, role: string, text: string) => void | Promise<void>
}

const defaultEffects: ClaudeEventEffects = {
  updateRequirements: async (session) => {
    session.state.anforderungen = await requirementStore.merge(
      session.state.id,
      session.state.anforderungen
    )
    emit(session, 'anforderungen', session.state.anforderungen)
    planeAblage(session)
  },
  writeRoleReport,
}

export function describeTool(name: string, value: unknown): string {
  const input = record(value)
  if (!input) return name
  if (name === 'Bash') return `Bash(${String(input.command ?? '').slice(0, 70)})`
  const file = input.file_path ?? input.path ?? input.pattern ?? input.notebook_path
  if (file) return `${name} ${String(file).replace(process.env.HOME ?? '', '~')}`
  if (input.url) return `${name} ${String(input.url)}`
  if (input.query) return `${name} "${String(input.query).slice(0, 50)}"`
  return name
}

export function handleClaudeEvent(
  session: SessionRuntime,
  value: unknown,
  effectOverrides: Partial<ClaudeEventEffects> = {}
): void {
  const event = record(value)
  if (!event || typeof event.type !== 'string') return
  const effects = { ...defaultEffects, ...effectOverrides }
  const state = session.state

  if (event.type === 'system') {
    if (typeof event.session_id === 'string' && event.session_id) {
      state.claudeSessionId = event.session_id
    }
    if (event.subtype === 'init') {
      setNode(session, 'orchestrator', { phase: 'Kontext geladen' })
      const parts = [
        `Session ${String(event.session_id ?? '').slice(0, 8)}`,
        `Modell ${String(event.model ?? state.model)}`,
        Array.isArray(event.tools) ? `${event.tools.length} Tools` : null,
        Array.isArray(event.agents) ? `${event.agents.length} Subagenten` : null,
        Array.isArray(event.slash_commands)
          ? `${event.slash_commands.length} Skills/Befehle`
          : null,
        event.permissionMode ? `Permissions ${String(event.permissionMode)}` : null,
        event.cwd ? `cwd ${String(event.cwd).replace(HOME, '~')}` : null,
      ].filter(Boolean)
      push(session, { agent: 'orchestrator', kind: 'system', text: parts.join(' · ') })
    }
    return
  }

  if (event.type === 'assistant') {
    const message = record(event.message)
    const role = event.parent_tool_use_id
      ? session.pendingAgents.get(String(event.parent_tool_use_id))
      : undefined
    const usage = streamUsage(message?.usage)
    if (usage) {
      const delta = usageDelta(session.usageZaehler, message?.id, usage)
      if (delta.neueNachricht) state.anfragen += 1
      state.tokensIn += delta.in
      state.tokensCacheWrite += delta.cacheWrite
      state.tokensCached = Math.max(state.tokensCached, usage.cache_read_input_tokens ?? 0)
      state.tokensOut += delta.out
      if (delta.neueNachricht || delta.in || delta.out) {
        const target = role ?? 'orchestrator'
        const graphNode = node(session, target)
        setNode(session, target, {
          anfragen: graphNode.anfragen + (delta.neueNachricht ? 1 : 0),
          tokensIn: graphNode.tokensIn + delta.in,
          tokensOut: graphNode.tokensOut + delta.out,
        })
        emit(session, 'tokens', {
          in: state.tokensIn,
          out: state.tokensOut,
          cached: state.tokensCached,
          cacheWrite: state.tokensCacheWrite,
          anfragen: state.anfragen,
          kosten: state.kostenUsd,
        })
      }
    }

    const content = message?.content
    if (!Array.isArray(content)) return

    if (role) {
      for (const rawBlock of content) {
        const block = record(rawBlock)
        if (!block) continue
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          const line = block.text.trim().split('\n')[0].slice(0, 80)
          setNode(session, role, { phase: line })
          push(session, { agent: role, kind: 'text', text: line })
        }
        if (block.type === 'tool_use') {
          const target = describeTool(String(block.name), block.input)
          setNode(session, role, { phase: target.slice(0, 80) })
          push(session, { agent: role, kind: 'tool', text: `→ ${target}` })
        }
      }
      return
    }

    for (const rawBlock of content) {
      const block = record(rawBlock)
      if (!block) continue
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        const fullText = block.text
        session.lastAssistantText = fullText
        state.antworten.push({ t: now(), text: fullText })
        emit(session, 'antwort', state.antworten[state.antworten.length - 1])
        push(session, {
          agent: 'orchestrator',
          kind: 'text',
          text: `antwortet (${fullText.length} Zeichen) · ${fullText.trim().split('\n')[0].slice(0, 90)}`,
        })
      }
      if (block.type !== 'tool_use') continue

      const name = String(block.name)
      if (name === 'Agent' || name === 'Task') {
        const input = record(block.input)
        const rawRole = String(input?.subagent_type ?? 'allgemein')
        const agentRole = ROLLENNAME.test(rawRole) ? rawRole : 'allgemein'
        const description = String(input?.description ?? input?.prompt ?? '').slice(0, 90)
        if (block.id) session.pendingAgents.set(String(block.id), agentRole)
        const graphNode = node(session, agentRole)
        session.orderCounter += 1
        setNode(session, agentRole, {
          status: 'running',
          phase: description || 'arbeitet',
          calls: graphNode.calls + 1,
          order: graphNode.order ?? session.orderCounter,
          auftrag: String(input?.prompt ?? input?.description ?? ''),
          quelle: 'agent-tool',
          startedAt: now(),
          endedAt: null,
        })
        push(session, { agent: agentRole, kind: 'agent', text: `beauftragt · ${description}` })
      } else {
        const target = describeTool(name, block.input)
        setNode(session, 'orchestrator', { phase: target })
        push(session, { agent: 'orchestrator', kind: 'tool', text: `→ ${target}` })
      }
    }
    return
  }

  if (event.type === 'user') {
    const message = record(event.message)
    const content = message?.content
    if (!Array.isArray(content)) return
    for (const rawBlock of content) {
      const block = record(rawBlock)
      if (!block || block.type !== 'tool_result') continue
      const role = session.pendingAgents.get(String(block.tool_use_id))
      if (!role) continue
      session.pendingAgents.delete(String(block.tool_use_id))
      const rawText = Array.isArray(block.content)
        ? block.content
            .map(record)
            .filter((part): part is JsonRecord => part?.type === 'text')
            .map((part) => String(part.text ?? ''))
            .join('\n')
        : String(block.content ?? '')
      if (/async agent launched|internal metadata/i.test(rawText)) {
        setNode(session, role, { status: 'running', phase: 'arbeitet im Hintergrund' })
        push(session, { agent: role, kind: 'agent', text: 'im Hintergrund gestartet' })
        continue
      }
      const summary = rawText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(' · ')
        .slice(0, 300)
      const failed = Boolean(block.is_error)
      setNode(session, role, {
        status: failed ? 'error' : 'done',
        phase: failed ? 'Fehler' : 'zurückgemeldet',
        ergebnis: summary,
        volltext: rawText,
        endedAt: now(),
      })
      void effects.writeRoleReport(session, role, rawText)
      push(session, {
        agent: role,
        kind: 'agent',
        text: failed ? 'mit Fehler beendet' : `meldet zurück · ${summary.slice(0, 120)}`,
      })
    }
    return
  }

  if (event.type === 'result') {
    if (typeof event.total_cost_usd === 'number') {
      state.kostenUsd = session.kostenBasisUsd + event.total_cost_usd
      emit(session, 'tokens', {
        in: state.tokensIn,
        out: state.tokensOut,
        cached: state.tokensCached,
        cacheWrite: state.tokensCacheWrite,
        anfragen: state.anfragen,
        kosten: state.kostenUsd,
      })
    }
    const duration = typeof event.duration_ms === 'number' ? event.duration_ms : 0
    push(session, {
      agent: 'system',
      kind: 'result',
      text: `Ergebnis: ${String(event.subtype ?? 'ok')}${duration ? ` · ${Math.round(duration / 1000)}s` : ''}`,
    })
    const pending = new Set(session.pendingAgents.values())
    for (const graphNode of state.nodes) {
      if (graphNode.id === 'orchestrator' || graphNode.status !== 'running') continue
      if (graphNode.quelle === 'rollenlauf') continue
      if (pending.has(graphNode.id)) {
        setNode(session, graphNode.id, { phase: 'im Hintergrund — kein Ergebnis in dieser Runde' })
        push(session, {
          agent: graphNode.id,
          kind: 'error',
          text: 'Runde endete ohne Rückmeldung dieser Rolle',
        })
        continue
      }
      setNode(session, graphNode.id, { status: 'done', phase: 'zurückgemeldet', endedAt: now() })
    }
    setNode(session, 'orchestrator', { phase: 'Antwort abgeschlossen' })
    void effects.updateRequirements(session)
    const delegated = state.nodes.some(
      (graphNode) => graphNode.id !== 'orchestrator' && graphNode.calls > 0
    )
    if (state.roles.length && !delegated && !state.pipelineAktiv) {
      push(session, {
        agent: 'system',
        kind: 'system',
        text: 'Runde beendet — Review über den Rollenlauf steht noch aus.',
      })
    }
    emit(session, 'state', state)
  }
}
