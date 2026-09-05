import { neuerUsageZaehler, usageDelta } from './usage'
import fs from 'node:fs/promises'
import path from 'node:path'
import { PROJECTS_DIR, shortProjectName } from './config'

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

type Line = Record<string, any>

const cache = new Map<string, { mtimeMs: number; run: RunSummary | null }>()

async function listTranscriptFiles(): Promise<string[]> {
  let dirs: string[]
  try {
    dirs = await fs.readdir(PROJECTS_DIR)
  } catch {
    return []
  }
  const files: string[] = []
  for (const d of dirs) {
    const full = path.join(PROJECTS_DIR, d)
    try {
      const entries = await fs.readdir(full)
      for (const e of entries) if (e.endsWith('.jsonl')) files.push(path.join(full, e))
    } catch {
      /* Ordner verschwunden — überspringen */
    }
  }
  return files
}

function parseLines(raw: string): Line[] {
  const out: Line[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      /* abgeschnittene letzte Zeile einer laufenden Session — ignorieren */
    }
  }
  return out
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text)
    .join('\n')
}

function toolUses(lines: Line[]) {
  const uses: { name: string; input: any }[] = []
  for (const l of lines) {
    if (l.type !== 'assistant') continue
    const content = l.message?.content
    if (!Array.isArray(content)) continue
    for (const b of content) {
      if (b?.type === 'tool_use' && typeof b.name === 'string')
        uses.push({ name: b.name, input: b.input ?? {} })
    }
  }
  return uses
}

function firstUserPrompt(lines: Line[]): string {
  for (const l of lines) {
    if (l.type !== 'user' || l.isMeta) continue
    const t = textOf(l.message?.content).trim()
    if (!t) continue
    if (t.startsWith('<') || t.startsWith('Caveat:')) continue
    return t.replace(/\s+/g, ' ').slice(0, 140)
  }
  return '(ohne Prompt)'
}

/** Offener Werkzeugaufruf am Ende = die Session wurde mittendrin beendet. */
function hasDanglingToolCall(lines: Line[]): boolean {
  const open = new Set<string>()
  for (const l of lines) {
    const content = l.message?.content
    if (!Array.isArray(content)) continue
    for (const b of content) {
      if (b?.type === 'tool_use' && b.id) open.add(String(b.id))
      if (b?.type === 'tool_result' && b.tool_use_id) open.delete(String(b.tool_use_id))
    }
  }
  return open.size > 0
}

function summarize(file: string, lines: Line[]): RunSummary | null {
  if (!lines.length) return null
  const withTs = lines.filter((l) => typeof l.timestamp === 'string')
  if (!withTs.length) return null

  const started = withTs[0].timestamp as string
  const ended = withTs[withTs.length - 1].timestamp as string
  const cwd = (lines.find((l) => typeof l.cwd === 'string')?.cwd as string) ?? '?'

  let tokensIn = 0
  let tokensOut = 0
  let tokensCached = 0
  const counter = neuerUsageZaehler()
  for (const l of lines) {
    const u = l.message?.usage
    if (!u) continue
    // cache_read wiederholt bei jeder Anfrage denselben Kontext — aufsummiert
    // ergäbe das ein Vielfaches dessen, was tatsächlich verarbeitet wurde.
    const delta = usageDelta(counter, l.message?.id, u)
    tokensIn += delta.in + delta.cacheWrite
    tokensCached += delta.cacheRead
    tokensOut += delta.out
  }

  const uses = toolUses(lines)
  const agentCalls = uses.filter((u) => u.name === 'Agent' || u.name === 'Task').length
  const securityChecked = uses.some(
    (u) =>
      (u.name === 'Agent' || u.name === 'Task') &&
      String(u.input?.subagent_type ?? u.input?.description ?? '').includes('security')
  )

  return {
    id: path.basename(file, '.jsonl'),
    file,
    project: cwd,
    projectShort: shortProjectName(cwd),
    started,
    ended,
    durationMs: Math.max(0, new Date(ended).getTime() - new Date(started).getTime()),
    title: firstUserPrompt(lines),
    tokensIn,
    tokensOut,
    tokensCached,
    toolCalls: uses.length,
    agentCalls,
    security: securityChecked ? 'geprüft' : 'offen',
    // Interaktive Sessions haben keine Endmarke. Als abgebrochen gilt daher
    // nur, wo ein Werkzeugaufruf ohne zugehöriges Ergebnis stehen blieb.
    status: hasDanglingToolCall(lines) ? 'abgebrochen' : 'abgeschlossen',
    gitBranch: (lines.find((l) => l.gitBranch)?.gitBranch as string) ?? null,
  }
}

export async function listRuns(limit = 200): Promise<RunSummary[]> {
  const files = await listTranscriptFiles()
  const runs: RunSummary[] = []

  const present = new Set(files)
  for (const key of cache.keys()) if (!present.has(key)) cache.delete(key)
  let cursor = 0
  const read = async (file: string) => {
    let stat
    try {
      stat = await fs.stat(file)
    } catch {
      return
    }
    const hit = cache.get(file)
    if (hit && hit.mtimeMs === stat.mtimeMs) {
      if (hit.run) runs.push(hit.run)
      return
    }
    // Sehr große Transcripts nur teilweise lesen wäre falsch (Tokens/Dauer
    // stünden dann daneben) — sie sind selten, also ganz lesen.
    let raw: string
    try {
      raw = await fs.readFile(file, 'utf8')
    } catch {
      return
    }
    const run = summarize(file, parseLines(raw))
    cache.set(file, { mtimeMs: stat.mtimeMs, run })
    if (run) runs.push(run)
  }
  await Promise.all(
    Array.from({ length: Math.min(4, files.length) }, async () => {
      while (cursor < files.length) await read(files[cursor++])
    })
  )

  runs.sort((a, b) => b.started.localeCompare(a.started))
  return runs.slice(0, limit)
}

const SEV = /(kritisch|hoch|mittel|niedrig|critical|high|medium|low)/i

export async function getRun(id: string): Promise<RunDetail | null> {
  const files = await listTranscriptFiles()
  const file = files.find((f) => path.basename(f, '.jsonl') === id)
  if (!file) return null

  const lines = parseLines(await fs.readFile(file, 'utf8'))
  const base = summarize(file, lines)
  if (!base) return null

  const uses = toolUses(lines)

  const artifacts = Array.from(
    new Set(
      uses
        .filter((u) => u.name === 'Write' || u.name === 'Edit' || u.name === 'NotebookEdit')
        .map((u) => String(u.input?.file_path ?? ''))
        .filter(Boolean)
    )
  ).slice(0, 40)

  const toolCounts = new Map<string, number>()
  for (const u of uses) toolCounts.set(u.name, (toolCounts.get(u.name) ?? 0) + 1)

  const agentCounts = new Map<string, number>()
  for (const u of uses) {
    if (u.name !== 'Agent' && u.name !== 'Task') continue
    const name = String(u.input?.subagent_type ?? 'allgemein')
    agentCounts.set(name, (agentCounts.get(name) ?? 0) + 1)
  }

  // Letzte Assistant-Absätze als Zusammenfassung
  const summary: string[] = []
  for (let i = lines.length - 1; i >= 0 && summary.length < 4; i--) {
    if (lines[i].type !== 'assistant') continue
    const t = textOf(lines[i].message?.content).trim()
    if (!t) continue
    for (const para of t
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .reverse()) {
      if (summary.length >= 4) break
      if (para.length < 12) continue
      summary.unshift(para.replace(/^[-*#>\s]+/, '').slice(0, 220))
    }
  }

  // Befunde aus Subagenten-Ergebnissen (Sidechain) mit Schweregrad-Wort
  const findings: { sev: string; text: string }[] = []
  for (const l of lines) {
    if (!l.isSidechain && l.type !== 'user') continue
    const t = textOf(l.message?.content)
    if (!t) continue
    for (const line of t.split('\n')) {
      const m = line.match(SEV)
      if (!m || line.length < 20 || line.length > 240) continue
      findings.push({ sev: m[1].toLowerCase(), text: line.replace(/^[-*\s]+/, '').trim() })
      if (findings.length >= 8) break
    }
    if (findings.length >= 8) break
  }

  return {
    ...base,
    summary,
    artifacts,
    findings,
    agents: [...agentCounts].map(([name, calls]) => ({ name, calls })),
    tools: [...toolCounts]
      .map(([name, calls]) => ({ name, calls }))
      .sort((a, b) => b.calls - a.calls),
  }
}
