export interface GraphNode {
  id: string
  status: 'idle' | 'running' | 'done' | 'error' | 'timeout'
  phase: string
  tokensOut: number
  tokensIn: number
  anfragen: number
  calls: number
  order: number | null
  auftrag: string
  ergebnis: string
  volltext: string
  bericht: string | null
  quelle: 'agent-tool' | 'rollenlauf' | null
  startedAt: string | null
  endedAt: string | null
}

export interface FeedLine {
  t: string
  agent: string
  text: string
  kind: 'system' | 'text' | 'tool' | 'agent' | 'result' | 'error'
}

export interface SessionState {
  id: string
  claudeSessionId: string | null
  project: string
  model: string
  roles: string[]
  prompt: string
  skipPermissions: boolean
  startedAt: string
  endedAt: string | null
  status: 'startet' | 'läuft' | 'fertig' | 'fehler' | 'abgebrochen' | 'unterbrochen'
  tokensIn: number
  tokensOut: number
  tokensCached: number
  tokensCacheWrite: number
  anfragen: number
  nodes: GraphNode[]
  antworten: { t: string; text: string }[]
  log: FeedLine[]
  reportPath: string | null
  cli: string
  pipelineAktiv: boolean
  pipelineRollen: string[]
}

export interface Role {
  name: string
  description: string
  model: string | null
  tools: string[]
  file: string
}

export interface ProjectEntry {
  id: string
  label: string
  repo: string | null
  paths: string[]
  path: string
  git: boolean
}

export interface RunSummary {
  id: string
  file: string
  project: string
  projectShort: string
  started: string
  ended: string
  durationMs: number
  title: string
  tokensIn: number
  tokensOut: number
  tokensCached: number
  toolCalls: number
  agentCalls: number
  security: 'geprüft' | 'offen'
  status: 'abgeschlossen' | 'abgebrochen'
  gitBranch: string | null
}

export interface RunDetail extends RunSummary {
  summary: string[]
  artifacts: string[]
  findings: { sev: string; text: string }[]
  agents: { name: string; calls: number }[]
  tools: { name: string; calls: number }[]
}

export interface HookEntry {
  event: string
  matcher: string
  type: string
  command: string
  timeout?: number
  statusMessage?: string
}

export interface HooksView {
  file: string
  raw: string
  entries: HookEntry[]
  gateInstalled: boolean
  gateScript: string | null
  gateRuns: { date: string; text: string; result: string }[]
}

export interface NightRun {
  name: string
  schedule: string
  command: string
  line: string
}

export interface VpsStatus {
  enabled: boolean
  host: string
  connected: boolean
  error: string | null
  runs: NightRun[]
  otherLines: number
  lastRun: string | null
  claudeVersion: string | null
  template: string
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)} k`
  return String(n)
}

export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${m % 60} min`
}

export function fmtDate(iso: string, locale: string = 'de-DE'): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function fmtTime(iso: string, locale: string = 'de-DE'): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--:--:--'
  return d.toLocaleTimeString(locale, { hour12: false })
}
