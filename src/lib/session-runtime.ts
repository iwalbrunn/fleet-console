import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { sessionStore } from './session-storage'
import { neuerUsageZaehler, type UsageZaehler } from './usage'
import type { FeedLine, GraphNode, SessionState } from './types'

export interface SessionRuntime {
  state: SessionState
  child: ChildProcessWithoutNullStreams | null
  subscribers: Set<(event: string) => void>
  /** tool_use_id → Rollenname, um Ergebnisse dem Knoten zuzuordnen */
  pendingAgents: Map<string, string>
  lastAssistantText: string
  stdoutBuffer: string
  orderCounter: number
  /** true, während der Prozess absichtlich für eine Umstellung beendet wird */
  wirdUmgestellt: boolean
  pipelineLaeuft: boolean
  /** Prozesse der laufenden Rollen — für Abbruch und Timeout. */
  rollenProzesse: Map<string, ChildProcessWithoutNullStreams>
  zuletztAbgelegt: number
  ablageGeplant: boolean
  kostenBasisUsd: number
  usageZaehler: UsageZaehler
  persist: () => Promise<void>
}

interface RuntimeOptions {
  orderCounter?: number
  kostenBasisUsd?: number
  persist?: () => Promise<void>
}

declare global {
  var __fleetSessions: Map<string, SessionRuntime> | undefined
}

export const registry: Map<string, SessionRuntime> =
  globalThis.__fleetSessions ?? (globalThis.__fleetSessions = new Map<string, SessionRuntime>())

export function now(): string {
  return new Date().toISOString()
}

export function leererKnoten(id: string): GraphNode {
  return {
    id,
    status: 'idle',
    phase: '',
    tokensOut: 0,
    tokensIn: 0,
    anfragen: 0,
    calls: 0,
    order: null,
    auftrag: '',
    ergebnis: '',
    volltext: '',
    bericht: null,
    kostenUsd: 0,
    befunde: null,
    nachpruefungen: 0,
    quelle: null,
    startedAt: null,
    endedAt: null,
  }
}

export function createSessionRuntime(
  state: SessionState,
  options: RuntimeOptions = {}
): SessionRuntime {
  const runtime: SessionRuntime = {
    state,
    child: null,
    subscribers: new Set(),
    pendingAgents: new Map(),
    lastAssistantText: '',
    stdoutBuffer: '',
    orderCounter: options.orderCounter ?? 0,
    wirdUmgestellt: false,
    pipelineLaeuft: false,
    rollenProzesse: new Map(),
    zuletztAbgelegt: 0,
    ablageGeplant: false,
    kostenBasisUsd: options.kostenBasisUsd ?? 0,
    usageZaehler: neuerUsageZaehler(),
    persist:
      options.persist ??
      (async () => {
        try {
          await sessionStore.persist(runtime.state, runtime.lastAssistantText)
        } catch {
          /* Ablage ist ein Extra — ein Fehler hier darf den Lauf nicht kippen. */
        }
      }),
  }
  return runtime
}

const MAX_LOG = 400

export function emit(session: SessionRuntime, event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const send of session.subscribers) {
    try {
      send(payload)
    } catch {
      /* Abonnent ist weg — wird beim Abbruch entfernt. */
    }
  }
}

export function planeAblage(session: SessionRuntime): void {
  if (session.ablageGeplant) return
  session.ablageGeplant = true
  const delay = Math.max(0, 2000 - (Date.now() - session.zuletztAbgelegt))
  setTimeout(() => {
    session.ablageGeplant = false
    session.zuletztAbgelegt = Date.now()
    void session.persist()
  }, delay).unref?.()
}

export function push(session: SessionRuntime, line: Omit<FeedLine, 't'>): void {
  const entry: FeedLine = { t: now(), ...line }
  session.state.log.push(entry)
  if (session.state.log.length > MAX_LOG) {
    session.state.log.splice(0, session.state.log.length - MAX_LOG)
  }
  emit(session, 'line', entry)
  planeAblage(session)
}

export function node(session: SessionRuntime, id: string): GraphNode {
  let graphNode = session.state.nodes.find((candidate) => candidate.id === id)
  if (!graphNode) {
    graphNode = leererKnoten(id)
    session.state.nodes.push(graphNode)
  }
  return graphNode
}

export function setNode(session: SessionRuntime, id: string, patch: Partial<GraphNode>): void {
  Object.assign(node(session, id), patch)
  emit(session, 'nodes', session.state.nodes)
  planeAblage(session)
}

export async function writeRoleReport(
  session: SessionRuntime,
  role: string,
  text: string
): Promise<void> {
  try {
    const report = await sessionStore.writeRoleReport(session.state, role, text, now())
    if (report) setNode(session, role, { bericht: report })
  } catch {
    /* Ablage ist ein Extra — ein Fehler hier darf den Lauf nicht kippen. */
  }
}
