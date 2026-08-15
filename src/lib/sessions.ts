import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { buildArgs, cliText } from './claude-cli'
import { startClaudeProcess, terminateProcess } from './claude-process'
import { requirementStore } from './session-requirements'
import {
  createSessionRuntime,
  emit,
  leererKnoten,
  now,
  planeAblage,
  push,
  registry,
  setNode,
  type SessionRuntime,
} from './session-runtime'
import { sessionStore } from './session-storage'
import { worktreeManager } from './session-worktrees'
import type { SessionState } from './types'
import { PROJECT_ROOTS, WORKTREES_DIR } from './config'

export type {
  Anforderung,
  FeedLine,
  GraphNode,
  NodeStatus,
  RollenBefund,
  RollenVerdict,
  SessionState,
} from './types'
export { buildArgs, cliPreview, cliText, orchestratorAuftrag } from './claude-cli'
export { PRUEFAUFTRAG, VERDICT_SCHEMA, verdictAlsText, verdictKurz } from './review-verdict'
export { collectWorkingState, runPipeline, type Arbeitsstand } from './review-pipeline'
export { leererKnoten } from './session-runtime'

type Session = SessionRuntime

/** Wirksames Arbeitsverzeichnis: die isolierte Arbeitskopie, wenn es eine
 *  gibt, sonst der Projektordner. */
function arbeitsdir(state: SessionState): string {
  return worktreeManager.workingDirectory(state)
}

/** Legt den Sessionzustand an und startet die Claude-CLI. */
export async function startSession(opts: {
  project: string
  model: string
  roles: string[]
  prompt: string
  skipPermissions: boolean
  worktree?: boolean
  uebergabeVon?: string
}): Promise<SessionState> {
  const id = randomUUID()
  const args = buildArgs({
    model: opts.model,
    skipPermissions: opts.skipPermissions,
    roles: opts.roles,
    anforderungenDatei: anforderungenDatei(id),
  })

  const state: SessionState = {
    id,
    claudeSessionId: null,
    project: opts.project,
    model: opts.model,
    roles: opts.roles,
    prompt: opts.prompt,
    skipPermissions: opts.skipPermissions,
    startedAt: now(),
    endedAt: null,
    status: 'startet',
    tokensIn: 0,
    tokensOut: 0,
    tokensCached: 0,
    tokensCacheWrite: 0,
    anfragen: 0,
    kostenUsd: 0,
    anforderungen: [],
    antworten: [],
    nodes: [
      {
        ...leererKnoten('orchestrator'),
        status: 'running',
        phase: 'Session startet',
        order: 0,
        auftrag: opts.prompt,
        startedAt: now(),
      },
      ...opts.roles.map((r) => leererKnoten(r)),
    ],
    log: [],
    reportPath: null,
    cli: cliText(args),
    pipelineAktiv: false,
    pipelineRollen: [],
    worktreePath: null,
    worktreeBasis: null,
  }

  const session = createSessionRuntime(state)
  registry.set(id, session)

  if (opts.worktree) {
    try {
      const wt = await worktreeManager.create(opts.project, id)
      state.worktreePath = wt.path
      state.worktreeBasis = wt.basis
      push(session, {
        agent: 'system',
        kind: 'system',
        text: `Worktree-Isolation: eigene Arbeitskopie ${wt.path} (Branch fleet/${id.slice(0, 8)})`,
      })
    } catch (err) {
      // Isolation war ausdrücklich gewünscht — dann nicht leise im
      // Original weiterarbeiten, sondern sauber scheitern.
      state.status = 'fehler'
      state.endedAt = now()
      push(session, { agent: 'system', kind: 'error', text: `Worktree konnte nicht angelegt werden: ${String(err).slice(0, 300)}` })
      void session.persist()
      return state
    }
  }

  // Übergabe aus einer früheren Session: deren offene Anforderungen werden
  // die Startliste dieser Session (Full-Context-Reset statt Compaction).
  if (opts.uebergabeVon) await uebernehmeOffeneAnforderungen(session, opts.uebergabeVon)

  if (!startClaudeProcess(session, args)) return state
  push(session, { agent: 'system', kind: 'system', text: `Arbeitsverzeichnis: ${arbeitsdir(state)}` })

  // Der Prompt geht unverändert als erste Nachricht in den Stream-Input —
  // die Delegations-Regeln stehen im Systemprompt, nicht in der Nachricht.
  sendMessage(id, opts.prompt)

  return state
}

/** Übernimmt die offenen Einträge einer früheren Session als Startliste der
 *  neuen. Quelle ist der SERVERSEITIGE Stand der alten Session — nicht die
 *  Datei, in der das Modell schreiben durfte. */
async function uebernehmeOffeneAnforderungen(s: Session, vonId: string) {
  // vonId kommt aus dem Request-Body und wird Teil eines Dateipfads.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(vonId)) return
  try {
    let alteListe = registry.get(vonId)?.state.anforderungen
    if (!alteListe) {
      const stored = (await sessionStore.loadAll()).find((state) => state.id === vonId)
      alteListe = Array.isArray(stored?.anforderungen) ? stored.anforderungen : []
    }
    const liste = requirementStore.inherit(alteListe, vonId, now())
    if (!liste.length) return
    s.state.anforderungen = liste
    await requirementStore.write(s.state.id, liste)
    push(s, {
      agent: 'system',
      kind: 'system',
      text: `Übergabe: ${liste.length} offene Anforderung(en) aus Session ${vonId.slice(0, 8)} übernommen`,
    })
  } catch {
    /* Übergabe ist ein Extra */
  }
}

/** Startet eine laufende Unterhaltung mit geänderten Einstellungen neu. */
export async function reconfigureSession(
  id: string,
  opts: { model?: string; skipPermissions?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  const s = registry.get(id)
  if (!s) return { ok: false, error: 'Session unbekannt' }
  if (!s.state.claudeSessionId) return { ok: false, error: 'Session hat noch keine Kennung von Claude' }

  const model = opts.model ?? s.state.model
  const skipPermissions = opts.skipPermissions ?? s.state.skipPermissions
  if (model === s.state.model && skipPermissions === s.state.skipPermissions) return { ok: true }

  s.wirdUmgestellt = true
  const alt = s.child
  s.child = null
  alt?.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 400))
  alt?.kill('SIGKILL')

  s.state.model = model
  s.state.skipPermissions = skipPermissions
  // Der neue Prozess zählt seine Kosten wieder von null.
  s.kostenBasisUsd = s.state.kostenUsd
  push(s, {
    agent: 'system',
    kind: 'system',
    text: `Einstellungen geändert · Modell ${model}, Auto-Permissions ${skipPermissions ? 'an' : 'aus'} · Unterhaltung wird fortgesetzt`,
  })

  const args = [
    ...buildArgs({ model, skipPermissions, roles: s.state.roles, anforderungenDatei: anforderungenDatei(id) }),
    '--resume',
    s.state.claudeSessionId,
  ]
  s.wirdUmgestellt = false
  const ok = startClaudeProcess(s, args)
  emit(s, 'state', s.state)
  return ok ? { ok: true } : { ok: false, error: 'Neustart fehlgeschlagen' }
}

export function sendMessage(id: string, text: string): boolean {
  const s = registry.get(id)
  if (!s?.child?.stdin.writable) return false
  const msg = {
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
  }
  s.child.stdin.write(JSON.stringify(msg) + '\n')
  push(s, { agent: 'du', kind: 'system', text })
  // Jede Nutzer-Nachricht wird deterministisch zur Anforderung — die
  // Einordnung (verworfen bei „ja bitte") ist Sache des Orchestrators.
  void ergaenzeAnforderung(s, text)
  return true
}

/** Ablageort der Anforderungsliste — die Datei, die der Orchestrator liest
 *  und pflegt. Absoluter Pfad, weil die Session im Projektordner läuft. */
export function anforderungenDatei(id: string): string {
  return requirementStore.file(id)
}

/** Erst die Status-Pflege des Orchestrators einsammeln, dann anhängen und
 *  die kanonische Liste zurückschreiben. */
async function ergaenzeAnforderung(s: Session, text: string) {
  try {
    s.state.anforderungen = await requirementStore.append(s.state.id, s.state.anforderungen, text, now())
    emit(s, 'anforderungen', s.state.anforderungen)
    planeAblage(s)
  } catch {
    /* Liste ist ein Extra — ein Fehler hier darf die Nachricht nicht kippen */
  }
}

/** Bricht Hauptprozess und laufende Rollenprozesse derselben Session ab. */
export function stopSession(id: string): boolean {
  const s = registry.get(id)
  if (!s) return false
  if (!s.child && !s.pipelineLaeuft) return false
  s.state.status = 'abgebrochen'
  // Laufende Rollen mitnehmen — sonst arbeiten sie nach dem Abbruch weiter
  // und verbrauchen Kontingent für eine Session, die niemand mehr ansieht.
  for (const [rolle, kind] of s.rollenProzesse) {
    terminateProcess(kind)
    setNode(s, rolle, { status: 'error', phase: 'abgebrochen', endedAt: now() })
  }
  s.rollenProzesse.clear()
  if (s.child) terminateProcess(s.child)
  return true
}

export function getSession(id: string): SessionState | null {
  return registry.get(id)?.state ?? null
}

/** Sessions im Speicher haben Vorrang; von der Platte kommt dazu, was der
 *  laufende Serverprozess nicht mehr kennt. */
export async function listSessions(): Promise<SessionState[]> {
  const live = [...registry.values()].map((s) => s.state)
  const bekannt = new Set(live.map((s) => s.id))
  const alt = (await sessionStore.loadAll()).filter((s) => !bekannt.has(s.id))
  return [...live, ...alt].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

/** Nimmt eine unterbrochene Session wieder auf: der Stand kommt von der
 *  Platte, die Unterhaltung über `--resume` von Claude. Schlägt der Resume
 *  fehl, wird das gesagt statt still in eine leere Session zu laufen. */
export async function resumeSession(id: string): Promise<{ ok: boolean; error?: string; state?: SessionState }> {
  if (registry.has(id)) return { ok: true, state: registry.get(id)!.state }

  const alt = (await sessionStore.loadAll()).find((s) => s.id === id)
  if (!alt) return { ok: false, error: 'Lauf nicht in der Ablage gefunden' }
  if (!alt.claudeSessionId) return { ok: false, error: 'Dieser Lauf hat keine Claude-Kennung — er lässt sich nicht fortsetzen' }
  // Die Ablage ist eine Datei, in die theoretisch auch eine (permissive)
  // Session schreiben konnte — Pfade daraus werden deshalb nicht geglaubt,
  // sondern gegen die konfigurierten Wurzeln geprüft, bevor sie cwd werden.
  const projektErlaubt = PROJECT_ROOTS.some(
    (wurzel) => alt.project === wurzel || alt.project.startsWith(wurzel + path.sep),
  )
  const worktreeErlaubt = !alt.worktreePath || alt.worktreePath.startsWith(WORKTREES_DIR + path.sep)
  if (!projektErlaubt || !worktreeErlaubt) {
    return { ok: false, error: 'Ablage verweist auf ein Arbeitsverzeichnis außerhalb der erlaubten Wurzeln — Fortsetzen verweigert.' }
  }
  try {
    await fs.stat(alt.worktreePath ?? alt.project)
  } catch {
    return { ok: false, error: `Arbeitsverzeichnis fehlt: ${alt.worktreePath ?? alt.project}` }
  }

  const claudeSessionId = alt.claudeSessionId
  const state: SessionState = { ...alt, status: 'startet', endedAt: null, pipelineAktiv: false }
  const session = createSessionRuntime(state, {
    orderCounter: state.nodes.reduce((max, n) => Math.max(max, n.order ?? 0), 0),
    kostenBasisUsd: state.kostenUsd,
  })
  registry.set(id, session)

  const args = [
    ...buildArgs({
      model: state.model,
      skipPermissions: state.skipPermissions,
      roles: state.roles,
      anforderungenDatei: anforderungenDatei(id),
    }),
    '--resume',
    claudeSessionId,
  ]
  push(session, {
    agent: 'system',
    kind: 'system',
    text: `Session wird fortgesetzt · ${claudeSessionId.slice(0, 8)}`,
  })
  if (!startClaudeProcess(session, args)) {
    registry.delete(id)
    return { ok: false, error: 'Neustart des Prozesses fehlgeschlagen' }
  }
  setNode(session, 'orchestrator', { status: 'running', phase: 'fortgesetzt' })
  return { ok: true, state }
}

export function subscribe(id: string, send: (chunk: string) => void): (() => void) | null {
  const s = registry.get(id)
  if (!s) return null
  s.subscribers.add(send)
  send(`event: state\ndata: ${JSON.stringify(s.state)}\n\n`)
  return () => s.subscribers.delete(send)
}
