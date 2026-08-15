import { execFile as execFileCb, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { listRoles } from './settings'
import {
  ANFORDERUNGEN_DIR,
  AUTOCOMPACT,
  CLAUDE_BIN,
  DIFF_MAX,
  GRACE_SEC,
  HOME,
  PIPELINE_MODEL,
  PIPELINE_PARALLEL,
  PROJECT_ROOTS,
  REPORTS_DIR,
  ROLE_TIMEOUT_SEC,
  RUNS_DIR,
  WORKTREES_DIR,
} from './config'

/** Rollennamen landen in Dateipfaden und CLI-Argumenten — alles außerhalb
 *  dieses Musters wird nirgends hingeschrieben und nirgends gestartet. */
const ROLLENNAME = /^[A-Za-z0-9_-]+$/

export type NodeStatus = 'idle' | 'running' | 'done' | 'error' | 'timeout'

export interface RollenBefund {
  schweregrad: 'kritisch' | 'hoch' | 'mittel' | 'niedrig'
  datei: string
  zeile?: number | null
  titel: string
  beschreibung: string
  /** `neu` beim Erstlauf; bei der Nachprüfung `behoben` oder `offen`. */
  status?: 'neu' | 'offen' | 'behoben'
}

export interface RollenVerdict {
  verdict: 'ok' | 'befunde'
  befunde: RollenBefund[]
  zusammenfassung?: string
}

/** Eintrag der Anforderungsliste. Die Console trägt jede Nutzer-Nachricht
 *  deterministisch ein — eine Anforderung ist ein Datensatz in einer Datei,
 *  keine Chat-Zeile, die der Verdichtung zum Opfer fällt. Der Orchestrator
 *  pflegt nur den Status. */
export interface Anforderung {
  id: string
  t: string
  text: string
  status: 'offen' | 'erledigt' | 'verworfen'
  /** Kurzbegründung des Orchestrators, v. a. bei `verworfen`. */
  notiz?: string
}

export interface GraphNode {
  id: string
  status: NodeStatus
  phase: string
  /** Ausgabe-Tokens dieser Rolle. */
  tokensOut: number
  /** Frisch verarbeitete Eingabe dieser Rolle (ohne Cache-Lesen). */
  tokensIn: number
  /** API-Anfragen dieser Rolle. */
  anfragen: number
  calls: number
  /** Reihenfolge der Beauftragung (1 = zuerst), null solange ungenutzt. */
  order: number | null
  /** Auftrag, den der Orchestrator gestellt hat. */
  auftrag: string
  /** Erste Zeilen dessen, was zurückkam. */
  ergebnis: string
  /** Vollständige Rückmeldung — ungekürzt. */
  volltext: string
  /** Abgelegter Bericht dieser Rolle, sofern geschrieben. */
  bericht: string | null
  /** Kosten dieser Rolle in USD (API-Listenpreis, aus dem result-Event). */
  kostenUsd: number
  /** Strukturiertes Review-Ergebnis des letzten Rollenlaufs, sofern die
   *  Rolle mit Schema lief. Grundlage der Nachprüfung — nicht der Freitext. */
  befunde: RollenBefund[] | null
  /** Wie oft diese Rolle in der Session schon nachgeprüft hat. Ab der
   *  Grenze gehört der Rest an den Menschen, nicht in weitere Runden. */
  nachpruefungen: number
  /** Woher der Lauf kam: Agent-Tool des Orchestrators oder eigener Rollenlauf. */
  quelle: 'agent-tool' | 'rollenlauf' | null
  startedAt: string | null
  endedAt: string | null
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
  /** `unterbrochen` = der Serverprozess ist gegangen, die Unterhaltung lebt
   *  aber noch bei Claude und lässt sich per --resume fortsetzen. */
  status: 'startet' | 'läuft' | 'fertig' | 'fehler' | 'abgebrochen' | 'unterbrochen'
  /** Frisch verarbeitete Eingabe (ohne Cache). */
  tokensIn: number
  tokensOut: number
  /** Höchster Cache-Lesewert einer Anfrage — nicht aufsummiert. */
  tokensCached: number
  /** In den Cache geschriebene Tokens, aufsummiert. */
  tokensCacheWrite: number
  /** Anzahl API-Anfragen — der eigentliche Treiber langer Sitzungen. */
  anfragen: number
  /** Kosten in USD zum API-Listenpreis. Beim Abo-Login ist das kein echter
   *  Rechnungsbetrag, aber das ehrlichste Maß für den Verbrauch je Lauf. */
  kostenUsd: number
  /** Spiegel der Anforderungsdatei für die Anzeige. Quelle der Wahrheit ist
   *  die Datei — sie ist es, die der Orchestrator liest und pflegt. */
  anforderungen: Anforderung[]
  /** Isolierte Arbeitskopie (git worktree), wenn beim Start gewählt.
   *  `project` bleibt das Original — für Anzeige und Projektauswahl. */
  worktreePath: string | null
  /** HEAD des Projekts beim Anlegen des Worktrees — Vergleichsbasis fürs
   *  Aufräumen: keine Commits und kein Diff heißt „unverändert, weg damit". */
  worktreeBasis: string | null
  nodes: GraphNode[]
  /** Vollständige Antworten des Orchestrators — ungekürzt, für die Anzeige. */
  antworten: { t: string; text: string }[]
  log: FeedLine[]
  reportPath: string | null
  cli: string
  /** Läuft gerade ein Rollenlauf? Sperrt den Knopf in der Oberfläche. */
  pipelineAktiv: boolean
  /** Rollen des laufenden bzw. letzten Rollenlaufs. */
  pipelineRollen: string[]
}

interface Session {
  state: SessionState
  child: ChildProcessWithoutNullStreams | null
  subscribers: Set<(ev: string) => void>
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
  /** Zeitpunkt der letzten Ablage, gegen zu häufiges Schreiben. */
  zuletztAbgelegt: number
  ablageGeplant: boolean
  /** Kosten abgeschlossener Prozesse und Rollenläufe. Das result-Event
   *  meldet die Kosten je PROZESS kumulativ — nach einem Neustart (--resume)
   *  zählt es wieder von null, deshalb die Basis. */
  kostenBasisUsd: number
}

const MAX_LOG = 400

// Über HMR hinweg stabil halten, sonst verliert der Dev-Server laufende Sessions.
const registry: Map<string, Session> =
  (globalThis as any).__fleetSessions ?? ((globalThis as any).__fleetSessions = new Map())

function now() {
  return new Date().toISOString()
}

function push(s: Session, line: Omit<FeedLine, 't'>) {
  const entry: FeedLine = { t: now(), ...line }
  s.state.log.push(entry)
  if (s.state.log.length > MAX_LOG) s.state.log.splice(0, s.state.log.length - MAX_LOG)
  emit(s, 'line', entry)
  planeAblage(s)
}

/** Legt den Stand höchstens alle zwei Sekunden ab. Ohne das ist nach einem
 *  Serverneustart alles weg, was die Session bis dahin erarbeitet hat —
 *  inklusive der Kennung, mit der sie sich fortsetzen ließe. */
function planeAblage(s: Session) {
  if (s.ablageGeplant) return
  s.ablageGeplant = true
  const wartezeit = Math.max(0, 2000 - (Date.now() - s.zuletztAbgelegt))
  setTimeout(() => {
    s.ablageGeplant = false
    s.zuletztAbgelegt = Date.now()
    void persist(s)
  }, wartezeit).unref?.()
}

function emit(s: Session, event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const send of s.subscribers) {
    try {
      send(payload)
    } catch {
      /* Abonnent ist weg — wird beim Abbruch entfernt */
    }
  }
}

function node(s: Session, id: string): GraphNode {
  let n = s.state.nodes.find((x) => x.id === id)
  if (!n) {
    n = leererKnoten(id)
    s.state.nodes.push(n)
  }
  return n
}

function setNode(s: Session, id: string, patch: Partial<GraphNode>) {
  Object.assign(node(s, id), patch)
  emit(s, 'nodes', s.state.nodes)
  planeAblage(s)
}

/** Steht als Systemanweisung in JEDER Runde — nicht nur in der ersten
 *  Nachricht. Die Umsetzung bleibt beim Orchestrator selbst; die Prüfrollen
 *  laufen als eigene Sessions (Rollenlauf), nicht über sein Agent-Tool.
 *  Der frühere Delegations-Zwang hat aus jeder Folgefrage eine Review-Runde
 *  gemacht und die eigentliche Umsetzung verdrängt. */
export function orchestratorAuftrag(roles: string[], anforderungenDatei?: string): string {
  const liste = roles.map((r) => `\`${r}\``).join(', ')
  const teile = [
    'Du bist die umsetzende Session dieser Aufgabe. Setze Anforderungen selbst um —',
    'Recherche-Subagenten (z. B. Explore) darfst du dafür frei nutzen.',
    '',
  ]
  if (roles.length) {
    teile.push(
      `Die Prüfrollen (${liste}) laufen als separate, parallele Sessions („Rollenlauf")`,
      'außerhalb dieser Unterhaltung. Beauftrage sie NICHT über das Agent-Tool — auch nicht',
      'am Ende der Aufgabe. Einzige Ausnahme: der Nutzer verlangt es ausdrücklich in seiner Nachricht.',
      '',
    )
  }
  teile.push('Regeln — auch für Folgeaufträge:')
  if (anforderungenDatei) {
    teile.push(
      `- Die Anforderungsliste dieser Session liegt in ${anforderungenDatei}`,
      '  (JSON-Array; Felder id, t, text, status, notiz). Die Konsole trägt jede Nutzer-Nachricht',
      '  dort automatisch mit status "offen" ein. Pflege NUR die Felder status und notiz:',
      '  "erledigt" erst, wenn umgesetzt und geprüft; "verworfen" mit kurzer notiz, wenn eine',
      '  Nachricht keine eigene Anforderung ist (z. B. eine reine Bestätigung). Füge keine',
      '  Einträge hinzu und lösche keine.',
      '- Prüfe vor jedem „fertig" die Liste: kein offener Eintrag darf unerledigt und unerwähnt bleiben.',
    )
  } else {
    teile.push(
      '- Führe bei mehrteiligen Aufträgen eine Aufgabenliste und trage jede nachgereichte Anforderung',
      '  sofort dort ein. Prüfe vor jedem „fertig" die Liste: keine Anforderung — auch keine aus',
      '  früheren Nachrichten — darf unerledigt und unerwähnt bleiben.',
    )
  }
  teile.push(
    '- Nach Code-Änderungen laufen die vorhandenen deterministischen Prüfungen des Projekts',
    '  (Tests, Lint, Build) — kein zusätzliches Selbst-Review darüber hinaus.',
    '- Sag am Ende jeder Runde in je einem Satz, was umgesetzt ist und was noch offen ist.',
  )
  return teile.join('\n')
}

export function buildArgs(opts: {
  model: string
  skipPermissions: boolean
  roles?: string[]
  anforderungenDatei?: string
}): string[] {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--input-format',
    'stream-json',
    '--verbose',
    '--model',
    opts.model,
  ]
  if (opts.roles?.length || opts.anforderungenDatei) {
    args.push('--append-system-prompt', orchestratorAuftrag(opts.roles ?? [], opts.anforderungenDatei))
  }
  if (opts.roles?.length) {
    // Ohne das schweigt der Stream, solange ein Subagent arbeitet: seine
    // Ereignisse kommen dann mit parent_tool_use_id herein und lassen sich
    // dem Knoten zuordnen — Phase, Werkzeuge und Tokens je Rolle.
    args.push('--forward-subagent-text')
  }
  // Früher verdichten hält den Kontext je Anfrage klein — der größte Hebel
  // gegen davonlaufenden Verbrauch in langen Sitzungen.
  args.push('--autocompact', AUTOCOMPACT)
  if (opts.skipPermissions) args.push('--dangerously-skip-permissions')
  return args
}

/** Aufruf als Text für die Anzeige. Der Rollenauftrag hinter
 *  `--append-system-prompt` ist ein Absatz Fließtext — ungekürzt sprengt er
 *  jeden Kasten und verdeckt die Flags, auf die es ankommt. */
export function cliText(args: string[]): string {
  const teile: string[] = []
  for (let i = 0; i < args.length; i++) {
    teile.push(args[i])
    if (args[i] === '--append-system-prompt' && i + 1 < args.length) {
      teile.push('«Rollenauftrag»')
      i++
    }
  }
  return [CLAUDE_BIN, ...teile].join(' ')
}

export function cliPreview(opts: { model: string; skipPermissions: boolean; roles?: string[] }): string {
  return cliText(buildArgs(opts))
}

/** Wirksames Arbeitsverzeichnis: die isolierte Arbeitskopie, wenn es eine
 *  gibt, sonst der Projektordner. */
function arbeitsdir(state: SessionState): string {
  return state.worktreePath ?? state.project
}

/** Legt eine isolierte Arbeitskopie an: eigener Branch `fleet/<kurz>` ab dem
 *  aktuellen HEAD. Die Basis wird gemerkt, damit das Aufräumen später
 *  „unverändert" erkennen kann. */
async function erstelleWorktree(project: string, id: string): Promise<{ pfad: string; basis: string }> {
  const kurz = id.slice(0, 8)
  const pfad = path.join(WORKTREES_DIR, kurz)
  await fs.mkdir(WORKTREES_DIR, { recursive: true })
  const basis = (await execFile('git', ['-C', project, 'rev-parse', 'HEAD'], { timeout: 15000 })).stdout.trim()
  await execFile('git', ['-C', project, 'worktree', 'add', '-b', `fleet/${kurz}`, pfad], { timeout: 30000 })
  return { pfad, basis }
}

/** Räumt die Arbeitskopie am Sessionende weg — aber nur, wenn sie weder
 *  uncommittete Änderungen noch eigene Commits hat. Alles andere bleibt
 *  liegen und wird mit Pfad gemeldet. */
async function raeumeWorktreeAuf(s: Session) {
  const { worktreePath: wt, worktreeBasis: basis, project } = s.state
  if (!wt) return
  try {
    const status = (await execFile('git', ['-C', wt, 'status', '--porcelain'], { timeout: 15000 })).stdout.trim()
    const head = (await execFile('git', ['-C', wt, 'rev-parse', 'HEAD'], { timeout: 15000 })).stdout.trim()
    if (status || (basis && head !== basis)) {
      push(s, {
        agent: 'system',
        kind: 'system',
        text: `Worktree behalten — er enthält Arbeit: ${wt} (Branch fleet/${s.state.id.slice(0, 8)})`,
      })
      return
    }
    await execFile('git', ['-C', project, 'worktree', 'remove', '--force', wt], { timeout: 20000 })
    await execFile('git', ['-C', project, 'branch', '-D', `fleet/${s.state.id.slice(0, 8)}`], { timeout: 15000 }).catch(
      () => {},
    )
    s.state.worktreePath = null
    push(s, { agent: 'system', kind: 'system', text: 'Worktree unverändert — aufgeräumt.' })
    planeAblage(s)
  } catch {
    /* Aufräumen ist ein Extra — ein hängender Worktree kippt nichts */
  }
}

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

  const session: Session = {
    state,
    child: null,
    subscribers: new Set(),
    pendingAgents: new Map(),
    lastAssistantText: '',
    stdoutBuffer: '',
    orderCounter: 0,
    wirdUmgestellt: false,
    pipelineLaeuft: false,
    rollenProzesse: new Map(),
    zuletztAbgelegt: 0,
    ablageGeplant: false,
    kostenBasisUsd: 0,
  }
  registry.set(id, session)

  if (opts.worktree) {
    try {
      const wt = await erstelleWorktree(opts.project, id)
      state.worktreePath = wt.pfad
      state.worktreeBasis = wt.basis
      push(session, {
        agent: 'system',
        kind: 'system',
        text: `Worktree-Isolation: eigene Arbeitskopie ${wt.pfad} (Branch fleet/${id.slice(0, 8)})`,
      })
    } catch (err) {
      // Isolation war ausdrücklich gewünscht — dann nicht leise im
      // Original weiterarbeiten, sondern sauber scheitern.
      state.status = 'fehler'
      state.endedAt = now()
      push(session, { agent: 'system', kind: 'error', text: `Worktree konnte nicht angelegt werden: ${String(err).slice(0, 300)}` })
      void persist(session)
      return state
    }
  }

  // Übergabe aus einer früheren Session: deren offene Anforderungen werden
  // die Startliste dieser Session (Full-Context-Reset statt Compaction).
  if (opts.uebergabeVon) await uebernehmeOffeneAnforderungen(session, opts.uebergabeVon)

  if (!starteProzess(session, args)) return state
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
      const roh = JSON.parse(await fs.readFile(path.join(RUNS_DIR, `${vonId}.json`), 'utf8')) as SessionState
      alteListe = Array.isArray(roh?.anforderungen) ? roh.anforderungen : []
    }
    const offene = alteListe.filter((a) => a.status === 'offen' && typeof a.text === 'string')
    if (!offene.length) return
    const liste: Anforderung[] = offene.map((a, i) => ({
      id: `a${i + 1}`,
      t: now(),
      text: a.text,
      status: 'offen',
      notiz: `übernommen aus Session ${vonId.slice(0, 8)}`,
    }))
    s.state.anforderungen = liste
    await schreibeAnforderungen(s)
    push(s, {
      agent: 'system',
      kind: 'system',
      text: `Übergabe: ${liste.length} offene Anforderung(en) aus Session ${vonId.slice(0, 8)} übernommen`,
    })
  } catch {
    /* Übergabe ist ein Extra */
  }
}

/** Startet den CLI-Prozess und hängt die Ereignisverarbeitung daran.
 *  Wird beim Start und beim Fortsetzen mit geänderten Einstellungen benutzt. */
function starteProzess(session: Session, args: string[]): boolean {
  const state = session.state
  let child: ChildProcessWithoutNullStreams
  try {
    child = spawn(CLAUDE_BIN, args, {
      cwd: arbeitsdir(state),
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (err) {
    state.status = 'fehler'
    state.endedAt = now()
    push(session, { agent: 'system', kind: 'error', text: `Start fehlgeschlagen: ${String(err)}` })
    return false
  }

  session.child = child
  session.stdoutBuffer = ''
  state.status = 'läuft'
  state.cli = cliText(args)
  push(session, { agent: 'system', kind: 'system', text: `$ ${state.cli}` })

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    session.stdoutBuffer += chunk
    const parts = session.stdoutBuffer.split('\n')
    session.stdoutBuffer = parts.pop() ?? ''
    for (const line of parts) {
      if (!line.trim()) continue
      try {
        handleEvent(session, JSON.parse(line))
      } catch {
        push(session, { agent: 'stdout', kind: 'text', text: line.slice(0, 400) })
      }
    }
  })

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    for (const line of chunk.split('\n')) {
      if (line.trim()) push(session, { agent: 'stderr', kind: 'error', text: line.slice(0, 400) })
    }
  })

  child.on('error', (err) => {
    state.status = 'fehler'
    push(session, { agent: 'system', kind: 'error', text: `Prozessfehler: ${err.message}` })
    emit(session, 'state', state)
  })

  child.on('close', (code) => {
    // Beim Umkonfigurieren beenden wir absichtlich — dann nicht abschließen.
    if (session.wirdUmgestellt) return
    if (state.status !== 'abgebrochen') state.status = code === 0 ? 'fertig' : 'fehler'
    state.endedAt = now()
    setNode(session, 'orchestrator', {
      status: code === 0 ? 'done' : 'error',
      phase: code === 0 ? 'Abgeschlossen' : `Beendet mit Code ${code}`,
    })
    // Rollen, die nie zurückgemeldet haben, nicht als erledigt zurücklassen.
    for (const n of state.nodes) {
      if (n.id === 'orchestrator' || n.status !== 'running' || n.quelle === 'rollenlauf') continue
      setNode(session, n.id, { status: 'error', phase: 'ohne Rückmeldung beendet', endedAt: now() })
    }
    const offeneAnf = state.anforderungen.filter((a) => a.status === 'offen').length
    if (offeneAnf) {
      push(session, {
        agent: 'system',
        kind: 'error',
        text: `Laut Anforderungsliste noch ${offeneAnf} Eintrag/Einträge offen — vor dem Abhaken prüfen.`,
      })
    }
    push(session, { agent: 'system', kind: 'result', text: `Prozess beendet (Code ${code})` })
    // Nur bei bewusstem Ende aufräumen — eine unterbrochene Session soll
    // ihren Worktree für --resume behalten.
    if (state.status === 'fertig' || state.status === 'abgebrochen') void raeumeWorktreeAuf(session)
    void persist(session)
    emit(session, 'state', state)
    emit(session, 'end', { id: state.id })
  })

  return true
}

/** Modell oder Berechtigungen im Lauf ändern: Prozess neu starten und die
 *  bisherige Unterhaltung über --resume fortsetzen. */
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
  const ok = starteProzess(s, args)
  emit(s, 'state', s.state)
  return ok ? { ok: true } : { ok: false, error: 'Neustart fehlgeschlagen' }
}

function handleEvent(s: Session, ev: any) {
  const state = s.state

  if (ev.type === 'system') {
    if (ev.session_id) state.claudeSessionId = ev.session_id
    if (ev.subtype === 'init') {
      setNode(s, 'orchestrator', { phase: 'Kontext geladen' })
      // Kontext-Parität sichtbar machen: was die Headless-Session wirklich
      // geladen hat. „Schlechter als interaktiv" heißt oft nur: anderer
      // Kontext — das soll hier auffallen, nicht erst am Ergebnis.
      const teile = [
        `Session ${String(ev.session_id ?? '').slice(0, 8)}`,
        `Modell ${ev.model ?? state.model}`,
        Array.isArray(ev.tools) ? `${ev.tools.length} Tools` : null,
        Array.isArray(ev.agents) ? `${ev.agents.length} Subagenten` : null,
        Array.isArray(ev.slash_commands) ? `${ev.slash_commands.length} Skills/Befehle` : null,
        ev.permissionMode ? `Permissions ${ev.permissionMode}` : null,
        ev.cwd ? `cwd ${String(ev.cwd).replace(HOME, '~')}` : null,
      ].filter(Boolean)
      push(s, { agent: 'orchestrator', kind: 'system', text: teile.join(' · ') })
    }
    return
  }

  if (ev.type === 'assistant') {
    // Mit --forward-subagent-text kommen die Ereignisse der Subagenten im
    // selben Strom herein, erkennbar an parent_tool_use_id. Sie gehören dem
    // Rollenknoten, nicht dem Orchestrator.
    const rolle = ev.parent_tool_use_id ? s.pendingAgents.get(String(ev.parent_tool_use_id)) : undefined

    const usage = ev.message?.usage
    if (usage) {
      // Frische Eingabe und Cache getrennt zählen: cache_read wiederholt sich
      // bei jeder Anfrage, aufsummiert ergäbe das absurde Zahlen.
      state.anfragen += 1
      state.tokensIn += usage.input_tokens ?? 0
      state.tokensCacheWrite += usage.cache_creation_input_tokens ?? 0
      state.tokensCached = Math.max(state.tokensCached, usage.cache_read_input_tokens ?? 0)
      state.tokensOut += usage.output_tokens ?? 0
      // Auch der Orchestrator bekommt seine eigene Rechnung — sonst steht die
      // Koordination selbst nie in den Zahlen.
      const zielKnoten = rolle ?? 'orchestrator'
      const n = node(s, zielKnoten)
      setNode(s, zielKnoten, {
        anfragen: n.anfragen + 1,
        tokensIn: n.tokensIn + (usage.input_tokens ?? 0),
        tokensOut: n.tokensOut + (usage.output_tokens ?? 0),
      })
      emit(s, 'tokens', {
        in: state.tokensIn,
        out: state.tokensOut,
        cached: state.tokensCached,
        cacheWrite: state.tokensCacheWrite,
        anfragen: state.anfragen,
        kosten: state.kostenUsd,
      })
    }
    const content = ev.message?.content
    if (!Array.isArray(content)) return

    // Arbeit eines Subagenten: als Phase des Knotens zeigen, nicht als
    // Antwort des Orchestrators sammeln.
    if (rolle) {
      for (const block of content) {
        if (block?.type === 'text' && block.text?.trim()) {
          const zeile = String(block.text).trim().split('\n')[0].slice(0, 80)
          setNode(s, rolle, { phase: zeile })
          push(s, { agent: rolle, kind: 'text', text: zeile })
        }
        if (block?.type === 'tool_use') {
          const ziel = describeTool(String(block.name), block.input)
          setNode(s, rolle, { phase: ziel.slice(0, 80) })
          push(s, { agent: rolle, kind: 'tool', text: `→ ${ziel}` })
        }
      }
      return
    }

    for (const block of content) {
      if (block?.type === 'text' && block.text?.trim()) {
        const volltext = String(block.text)
        s.lastAssistantText = volltext
        state.antworten.push({ t: now(), text: volltext })
        emit(s, 'antwort', state.antworten[state.antworten.length - 1])
        // Im technischen Feed nur ein Verweis — der Text steht in der Antwort.
        push(s, {
          agent: 'orchestrator',
          kind: 'text',
          text: `antwortet (${volltext.length} Zeichen) · ${volltext.trim().split('\n')[0].slice(0, 90)}`,
        })
      }
      if (block?.type === 'tool_use') {
        const name = String(block.name)
        if (name === 'Agent' || name === 'Task') {
          // subagent_type ist modellgesteuert und wird zum Knoten-Namen und
          // Berichts-Dateinamen — alles Unerwartete wird zusammengefasst.
          const roleRoh = String(block.input?.subagent_type ?? 'allgemein')
          const role = ROLLENNAME.test(roleRoh) ? roleRoh : 'allgemein'
          const desc = String(block.input?.description ?? block.input?.prompt ?? '').slice(0, 90)
          if (block.id) s.pendingAgents.set(String(block.id), role)
          const n = node(s, role)
          s.orderCounter += 1
          setNode(s, role, {
            status: 'running',
            phase: desc || 'arbeitet',
            calls: n.calls + 1,
            order: n.order ?? s.orderCounter,
            auftrag: String(block.input?.prompt ?? block.input?.description ?? ''),
            quelle: 'agent-tool',
            startedAt: now(),
            endedAt: null,
          })
          push(s, { agent: role, kind: 'agent', text: `beauftragt · ${desc}` })
        } else {
          const target = describeTool(name, block.input)
          setNode(s, 'orchestrator', { phase: target })
          push(s, { agent: 'orchestrator', kind: 'tool', text: `→ ${target}` })
        }
      }
    }
    return
  }

  if (ev.type === 'user') {
    const content = ev.message?.content
    if (!Array.isArray(content)) return
    for (const block of content) {
      if (block?.type !== 'tool_result') continue
      const role = s.pendingAgents.get(String(block.tool_use_id))
      if (!role) continue
      s.pendingAgents.delete(String(block.tool_use_id))
      const roh = Array.isArray(block.content)
        ? block.content.filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('\n')
        : String(block.content ?? '')
      // Wird der Subagent im Hintergrund gestartet, ist das hier nur die
      // Startquittung — kein Ergebnis. Der Knoten bleibt dann auf „läuft".
      if (/async agent launched|internal metadata/i.test(roh)) {
        setNode(s, role, { status: 'running', phase: 'arbeitet im Hintergrund' })
        push(s, { agent: role, kind: 'agent', text: 'im Hintergrund gestartet' })
        continue
      }
      const ergebnis = roh.split('\n').map((l: string) => l.trim()).filter(Boolean).slice(0, 3).join(' · ').slice(0, 300)
      setNode(s, role, {
        status: block.is_error ? 'error' : 'done',
        phase: block.is_error ? 'Fehler' : 'zurückgemeldet',
        ergebnis,
        volltext: roh,
        endedAt: now(),
      })
      void schreibeRollenbericht(s, role, roh)
      push(s, {
        agent: role,
        kind: 'agent',
        text: block.is_error ? 'mit Fehler beendet' : `meldet zurück · ${ergebnis.slice(0, 120)}`,
      })
    }
    return
  }

  if (ev.type === 'result') {
    const usage = ev.usage
    // total_cost_usd zählt je Prozess kumulativ — Basis addieren, nicht aufsummieren.
    if (typeof ev.total_cost_usd === 'number') {
      state.kostenUsd = s.kostenBasisUsd + ev.total_cost_usd
    }
    if (usage) {
      state.tokensOut = Math.max(state.tokensOut, usage.output_tokens ?? 0)
      emit(s, 'tokens', {
        in: state.tokensIn,
        out: state.tokensOut,
        cached: state.tokensCached,
        cacheWrite: state.tokensCacheWrite,
        anfragen: state.anfragen,
        kosten: state.kostenUsd,
      })
    }
    push(s, {
      agent: 'system',
      kind: 'result',
      text: `Ergebnis: ${ev.subtype ?? 'ok'}${ev.duration_ms ? ` · ${Math.round(ev.duration_ms / 1000)}s` : ''}`,
    })
    // Ende der Runde. Wer bis hierhin kein tool_result hatte, hat auch keins
    // bekommen — das wird gesagt, statt den Knoten stillschweigend auf
    // „fertig" zu setzen. Rollenläufe laufen unabhängig weiter.
    const offen = new Set(s.pendingAgents.values())
    for (const n of state.nodes) {
      if (n.id === 'orchestrator' || n.status !== 'running') continue
      if (n.quelle === 'rollenlauf') continue
      if (offen.has(n.id)) {
        setNode(s, n.id, { phase: 'im Hintergrund — kein Ergebnis in dieser Runde' })
        push(s, { agent: n.id, kind: 'error', text: 'Runde endete ohne Rückmeldung dieser Rolle' })
        continue
      }
      setNode(s, n.id, { status: 'done', phase: 'zurückgemeldet', endedAt: now() })
    }
    setNode(s, 'orchestrator', { phase: 'Antwort abgeschlossen' })
    // Der Orchestrator kann in dieser Runde Status in der Liste gepflegt haben.
    void aktualisiereAnforderungen(s)
    // Kein Vorwurf mehr, wenn der Orchestrator nicht delegiert hat — das ist
    // jetzt der Normalfall. Reviews holt der Rollenlauf, das UI bietet ihn an.
    // Nur ein GERADE laufender Rollenlauf unterdrückt den Hinweis: ein
    // vergangener sagt nichts über die Änderungen dieser Runde.
    const delegiert = state.nodes.some((n) => n.id !== 'orchestrator' && n.calls > 0)
    if (state.roles.length && !delegiert && !state.pipelineAktiv) {
      push(s, {
        agent: 'system',
        kind: 'system',
        text: 'Runde beendet — Review über den Rollenlauf steht noch aus.',
      })
    }
    emit(s, 'state', state)
  }
}

function describeTool(name: string, input: any): string {
  if (!input) return name
  if (name === 'Bash') return `Bash(${String(input.command ?? '').slice(0, 70)})`
  const file = input.file_path ?? input.path ?? input.pattern ?? input.notebook_path
  if (file) return `${name} ${String(file).replace(process.env.HOME ?? '', '~')}`
  if (input.url) return `${name} ${input.url}`
  if (input.query) return `${name} "${String(input.query).slice(0, 50)}"`
  return name
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
  return path.join(ANFORDERUNGEN_DIR, `${id}.json`)
}

const ANF_STATUS = new Set(['offen', 'erledigt', 'verworfen'])

/** Übernimmt aus der Datei NUR status und notiz zu Einträgen, die der Server
 *  kennt. Die Einträge selbst führt die Konsole — der Prompt verbietet dem
 *  Modell zwar mehr, aber verlassen wird sich darauf nicht: sonst überlebt
 *  eine aus Repo-Inhalten injizierte „Anforderung" den Kontext-Reset. */
async function mergeAnforderungenVonDatei(s: Session) {
  let roh: unknown
  try {
    roh = JSON.parse(await fs.readFile(anforderungenDatei(s.state.id), 'utf8'))
  } catch {
    return
  }
  if (!Array.isArray(roh)) return
  for (const e of s.state.anforderungen) {
    const f = (roh as Array<Record<string, unknown>>).find((x) => x && x.id === e.id)
    if (!f) continue
    if (typeof f.status === 'string' && ANF_STATUS.has(f.status)) e.status = f.status as Anforderung['status']
    if (typeof f.notiz === 'string') e.notiz = f.notiz.slice(0, 300)
  }
}

async function schreibeAnforderungen(s: Session) {
  await fs.mkdir(ANFORDERUNGEN_DIR, { recursive: true })
  await fs.writeFile(anforderungenDatei(s.state.id), JSON.stringify(s.state.anforderungen, null, 2), 'utf8')
}

/** Erst die Status-Pflege des Orchestrators einsammeln, dann anhängen und
 *  die kanonische Liste zurückschreiben. */
async function ergaenzeAnforderung(s: Session, text: string) {
  try {
    await mergeAnforderungenVonDatei(s)
    s.state.anforderungen.push({ id: `a${s.state.anforderungen.length + 1}`, t: now(), text, status: 'offen' })
    await schreibeAnforderungen(s)
    emit(s, 'anforderungen', s.state.anforderungen)
    planeAblage(s)
  } catch {
    /* Liste ist ein Extra — ein Fehler hier darf die Nachricht nicht kippen */
  }
}

/** Nach jeder Runde: Status-Änderungen des Orchestrators übernehmen. */
async function aktualisiereAnforderungen(s: Session) {
  await mergeAnforderungenVonDatei(s)
  emit(s, 'anforderungen', s.state.anforderungen)
  planeAblage(s)
}

/** Beendet einen Prozess höflich und fasst nach der Frist hart nach. */
function beende(child: ChildProcessWithoutNullStreams, grund: string) {
  child.kill('SIGTERM')
  setTimeout(() => {
    if (!child.killed) child.kill('SIGKILL')
    void grund
  }, GRACE_SEC * 1000).unref?.()
}

export function stopSession(id: string): boolean {
  const s = registry.get(id)
  if (!s) return false
  if (!s.child && !s.pipelineLaeuft) return false
  s.state.status = 'abgebrochen'
  // Laufende Rollen mitnehmen — sonst arbeiten sie nach dem Abbruch weiter
  // und verbrauchen Kontingent für eine Session, die niemand mehr ansieht.
  for (const [rolle, kind] of s.rollenProzesse) {
    beende(kind, 'Abbruch der Session')
    setNode(s, rolle, { status: 'error', phase: 'abgebrochen', endedAt: now() })
  }
  s.rollenProzesse.clear()
  if (s.child) beende(s.child, 'Abbruch der Session')
  return true
}

export function getSession(id: string): SessionState | null {
  return registry.get(id)?.state ?? null
}

/** Abgelegte Läufe von der Platte. Sessions, die dort als laufend stehen,
 *  aber nicht mehr im Speicher sind, hat ein Serverneustart erwischt — sie
 *  gelten als unterbrochen und lassen sich fortsetzen. */
async function abgelegteSessions(): Promise<SessionState[]> {
  let dateien: string[]
  try {
    dateien = (await fs.readdir(RUNS_DIR)).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const out: SessionState[] = []
  for (const f of dateien) {
    try {
      const roh = JSON.parse(await fs.readFile(path.join(RUNS_DIR, f), 'utf8')) as SessionState
      if (!roh?.id) continue
      if (roh.status === 'läuft' || roh.status === 'startet') {
        roh.status = roh.claudeSessionId ? 'unterbrochen' : 'abgebrochen'
      }
      roh.pipelineAktiv = false
      roh.skipPermissions = Boolean(roh.skipPermissions)
      // Läufe aus der Zeit vor Kostenerfassung, Verdict-JSON und Liste.
      roh.kostenUsd ??= 0
      roh.anforderungen ??= []
      roh.worktreePath ??= null
      roh.worktreeBasis ??= null
      for (const n of roh.nodes ?? []) {
        n.kostenUsd ??= 0
        n.befunde ??= null
        n.nachpruefungen ??= 0
      }
      out.push(roh)
    } catch {
      /* unlesbare Ablage überspringen */
    }
  }
  return out
}

/** Sessions im Speicher haben Vorrang; von der Platte kommt dazu, was der
 *  laufende Serverprozess nicht mehr kennt. */
export async function listSessions(): Promise<SessionState[]> {
  const live = [...registry.values()].map((s) => s.state)
  const bekannt = new Set(live.map((s) => s.id))
  const alt = (await abgelegteSessions()).filter((s) => !bekannt.has(s.id))
  return [...live, ...alt].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

/** Nimmt eine unterbrochene Session wieder auf: der Stand kommt von der
 *  Platte, die Unterhaltung über `--resume` von Claude. Schlägt der Resume
 *  fehl, wird das gesagt statt still in eine leere Session zu laufen. */
export async function resumeSession(id: string): Promise<{ ok: boolean; error?: string; state?: SessionState }> {
  if (registry.has(id)) return { ok: true, state: registry.get(id)!.state }

  const alt = (await abgelegteSessions()).find((s) => s.id === id)
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
  const session: Session = {
    state,
    child: null,
    subscribers: new Set(),
    pendingAgents: new Map(),
    lastAssistantText: '',
    stdoutBuffer: '',
    orderCounter: state.nodes.reduce((max, n) => Math.max(max, n.order ?? 0), 0),
    wirdUmgestellt: false,
    pipelineLaeuft: false,
    rollenProzesse: new Map(),
    zuletztAbgelegt: 0,
    ablageGeplant: false,
    kostenBasisUsd: state.kostenUsd,
  }
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
  if (!starteProzess(session, args)) {
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

/** Legt die vollständige Rückmeldung einer Rolle als eigene Datei ab. Im
 *  Knoten steht nur ein Auszug — der Volltext ist oft das eigentlich
 *  Interessante und war bisher nach dem Lauf verloren. */
async function schreibeRollenbericht(s: Session, rolle: string, text: string) {
  if (!text.trim()) return
  // Der Rollenname wird Teil des Dateipfads — hier ist die letzte Stelle,
  // an der ein präparierter Name (../../…) noch abgefangen werden kann.
  if (!ROLLENNAME.test(rolle)) return
  try {
    await fs.mkdir(REPORTS_DIR, { recursive: true })
    const datei = path.join(REPORTS_DIR, `${s.state.id}-${rolle}.md`)
    const kopf = [
      `# ${rolle}`,
      '',
      `- Lauf: ${s.state.id}`,
      `- Projekt: ${s.state.project}`,
      `- Zeit: ${now()}`,
      '',
      '---',
      '',
    ].join('\n')
    await fs.writeFile(datei, kopf + text, 'utf8')
    setNode(s, rolle, { bericht: datei })
  } catch {
    /* Ablage ist ein Extra — ein Fehler hier darf den Lauf nicht kippen */
  }
}

async function persist(s: Session) {
  const { state } = s
  try {
    await fs.mkdir(RUNS_DIR, { recursive: true })
    await fs.mkdir(REPORTS_DIR, { recursive: true })
    if (s.lastAssistantText.trim()) {
      const report = path.join(REPORTS_DIR, `${state.id}.md`)
      const head = [
        `# ${state.prompt.slice(0, 80)}`,
        '',
        `- Projekt: ${state.project}`,
        `- Modell: ${state.model}`,
        `- Rollen: ${state.roles.join(', ') || '—'}`,
        `- Start: ${state.startedAt}`,
        `- Ende: ${state.endedAt}`,
        `- Tokens: ${state.tokensIn} ein / ${state.tokensOut} aus / ${state.tokensCached} aus dem Cache`,
        '',
        '---',
        '',
      ].join('\n')
      await fs.writeFile(report, head + s.lastAssistantText, 'utf8')
      state.reportPath = report
    }
    await fs.writeFile(path.join(RUNS_DIR, `${state.id}.json`), JSON.stringify(state, null, 2), 'utf8')
  } catch {
    /* Ablage ist ein Extra — ein Fehler hier darf den Lauf nicht kippen */
  }
}


// ---------------------------------------------------------------- Pipeline

const execFile = promisify(execFileCb)

/** Standardauftrag eines Rollenlaufs, wenn der Stand NICHT mitgegeben wird.
 *  Jeder andere Text ist erlaubt — damit taugt der Lauf auch für Umsetzung,
 *  nicht nur für die Diff-Prüfung. */
export const PRUEFAUFTRAG = [
  'Prüfe ausschließlich die uncommitteten Änderungen in diesem Projekt.',
  'Ermittle sie selbst mit `git diff HEAD` sowie `git status --porcelain` für neue Dateien.',
  'Lies nur die Dateien, die im Diff vorkommen — nicht die ganze Codebasis.',
  'Dein Ergebnis wird als strukturiertes JSON erfasst (Schema ist vorgegeben):',
  'Befunde ab Schweregrad Mittel, je Befund Datei, Zeile, Titel und 1–2 Sätze Beschreibung.',
  'Wenn nichts zu beanstanden ist: verdict "ok" mit leerer Befundliste. Nimm keine Änderungen vor.',
].join(' ')

/** Schema für das Review-Ergebnis eines Rollenlaufs. Erzwingt Struktur, damit
 *  Code — nicht das Modell — über Terminierung und Anzeige entscheidet. */
export const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['ok', 'befunde'] },
    befunde: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        properties: {
          schweregrad: { type: 'string', enum: ['kritisch', 'hoch', 'mittel', 'niedrig'] },
          datei: { type: 'string' },
          zeile: { type: ['integer', 'null'] },
          titel: { type: 'string' },
          beschreibung: { type: 'string' },
          status: { type: 'string', enum: ['neu', 'offen', 'behoben'] },
        },
        required: ['schweregrad', 'datei', 'titel', 'beschreibung'],
        additionalProperties: false,
      },
    },
    zusammenfassung: { type: 'string' },
  },
  required: ['verdict', 'befunde'],
  additionalProperties: false,
} as const

/** Macht aus dem Verdict-JSON den lesbaren Bericht für Anzeige und Ablage. */
export function verdictAlsText(v: RollenVerdict): string {
  if (v.verdict === 'ok' || !v.befunde.length) {
    return `Verdict: ok — ${v.zusammenfassung ?? 'keine Befunde ab Schweregrad Mittel.'}`
  }
  const zeilen = v.befunde.map((b) => {
    const ort = b.zeile ? `${b.datei}:${b.zeile}` : b.datei
    const status = b.status && b.status !== 'neu' ? ` (${b.status})` : ''
    return `- [${b.schweregrad}]${status} ${ort} — ${b.titel}: ${b.beschreibung}`
  })
  const kopf = v.zusammenfassung ? `${v.zusammenfassung}\n\n` : ''
  return `${kopf}${zeilen.join('\n')}`
}

/** Einzeiler für den Knoten: Verdict plus Zählung statt der ersten Textzeilen. */
export function verdictKurz(v: RollenVerdict): string {
  if (v.verdict === 'ok' || !v.befunde.length) return '✓ ok — keine Befunde'
  const behoben = v.befunde.filter((b) => b.status === 'behoben').length
  const offen = v.befunde.length - behoben
  const schwer = v.befunde.filter((b) => b.status !== 'behoben' && (b.schweregrad === 'kritisch' || b.schweregrad === 'hoch')).length
  const teile = [`${offen} Befund(e)`]
  if (schwer) teile.push(`davon ${schwer} hoch/kritisch`)
  if (behoben) teile.push(`${behoben} behoben`)
  return teile.join(' · ')
}

/** Derselbe Auftrag, wenn der Arbeitsstand unten schon angehängt ist. Ohne
 *  diese Fassung würde jede Rolle die Ermittlung trotzdem selbst ausführen —
 *  genau die Anfragen, die eingespart werden sollen. */
const PRUEFAUFTRAG_MIT_STAND = [
  'Prüfe ausschließlich die unten angehängten uncommitteten Änderungen dieses Projekts.',
  'Der Stand ist vollständig beigelegt — ermittle ihn NICHT noch einmal selbst.',
  'Lies eine Datei nur dann nach, wenn der beigelegte Ausschnitt für die Beurteilung nicht reicht.',
  'Dein Ergebnis wird als strukturiertes JSON erfasst (Schema ist vorgegeben):',
  'Befunde ab Schweregrad Mittel, je Befund Datei, Zeile, Titel und 1–2 Sätze Beschreibung.',
  'Wenn nichts zu beanstanden ist: verdict "ok" mit leerer Befundliste. Nimm keine Änderungen vor.',
].join(' ')

/** Auftrag für die Nachprüfung: die Rolle kennt ihre Befunde schon — sie soll
 *  nur abhaken statt den ganzen Diff noch einmal von vorn zu reviewen. */
const NACHPRUEFUNGS_AUFTRAG = [
  'NACHPRÜFUNG: Unten stehen deine Befunde aus dem letzten Lauf (als JSON) und der aktuelle',
  'Arbeitsstand. Prüfe ausschließlich: (1) Je Altbefund — behoben oder offen? Gib ihn mit',
  'status "behoben" bzw. "offen" wieder. (2) Neue Befunde (status "neu") nur an den seither',
  'geänderten Stellen. Dein Ergebnis wird als strukturiertes JSON erfasst (Schema ist',
  'vorgegeben). Nimm keine Änderungen vor.',
].join(' ')

export interface Arbeitsstand {
  text: string
  dateien: number
  pfade: string[]
  gekuerzt: boolean
}

/** Ermittelt den uncommitteten Stand EINMAL, damit ihn nicht jede Rolle
 *  einzeln zusammensuchen muss. Bei fünf Rollen war das fünfmal dieselbe
 *  Arbeit — und genau dort gingen die meisten Anfragen hin. */
async function sammleArbeitsstand(project: string): Promise<Arbeitsstand | null> {
  const git = async (args: string[]) =>
    (await execFile('git', ['-C', project, ...args], { maxBuffer: 32 * 1024 * 1024, timeout: 20000 })).stdout

  try {
    await git(['rev-parse', '--is-inside-work-tree'])
  } catch {
    return null // kein Repo — dann gibt es auch keinen Stand zum Mitgeben
  }

  let status = ''
  try {
    status = await git(['status', '--porcelain', '--untracked-files=all'])
  } catch {
    return null
  }
  const zeilen = status.split('\n').filter((l) => l.trim())
  const pfade = zeilen.map((l) => l.slice(3).trim().replace(/.* -> /, ''))
  if (!zeilen.length) return { text: '', dateien: 0, pfade: [], gekuerzt: false }

  let diff = ''
  try {
    diff = await git(['diff', 'HEAD'])
  } catch {
    /* z. B. Repo ohne ersten Commit — dann zählen nur die neuen Dateien */
  }

  const teile = ['### Geänderte Dateien\n\n```\n' + status.trim() + '\n```']
  if (diff.trim()) teile.push('### git diff HEAD\n\n```diff\n' + diff.trim() + '\n```')

  for (const zeile of zeilen) {
    if (!zeile.startsWith('??')) continue
    const datei = zeile.slice(3).trim()
    try {
      const voll = path.join(project, datei)
      const stat = await fs.stat(voll)
      if (!stat.isFile() || stat.size > 256 * 1024) continue
      const roh = await fs.readFile(voll)
      if (roh.subarray(0, 8000).includes(0)) continue // binär
      teile.push(`### Neue Datei ${datei}\n\n\`\`\`\n${roh.toString('utf8')}\n\`\`\``)
    } catch {
      /* nicht lesbar — die Rolle kann selbst nachsehen */
    }
  }

  let text = teile.join('\n\n')
  let gekuerzt = false
  if (text.length > DIFF_MAX) {
    text = text.slice(0, DIFF_MAX) + '\n\n[… gekürzt — den Rest bei Bedarf selbst nachlesen]'
    gekuerzt = true
  }
  return { text, dateien: zeilen.length, pfade, gekuerzt }
}

interface RollenErgebnis {
  text: string
  /** Validiertes Verdict-JSON, wenn die Rolle mit Schema lief. */
  struktur: RollenVerdict | null
  tokensIn: number
  tokensOut: number
  anfragen: number
  kostenUsd: number
  status: 'done' | 'error' | 'timeout'
  fehler: string | null
}

/** Führt eine Rolle als eigene, kurze Session aus. Frischer Kontext statt der
 *  gewachsenen Unterhaltung — das ist der Kostenhebel. Und der Aufruf hängt
 *  nicht davon ab, ob der Orchestrator delegieren mag. */
async function laufeRolle(
  s: Session,
  rolle: string,
  model: string | null,
  auftrag: string,
  schema?: object,
): Promise<RollenErgebnis> {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--agent', rolle]
  // Ohne --model nimmt die CLI das `model:` aus der Rollendatei. Der
  // security-reviewer läuft damit auf Opus, die übrigen auf Sonnet — statt
  // alle über einen Kamm zu scheren.
  if (model) args.push('--model', model)
  // Erzwingt ein validiertes Verdict-JSON — die CLI wiederholt bei
  // Schema-Verstoß selbst, der Parser hier bleibt trivial.
  if (schema) args.push('--json-schema', JSON.stringify(schema))
  args.push('--autocompact', AUTOCOMPACT)
  if (s.state.skipPermissions) args.push('--dangerously-skip-permissions')
  // `--` beendet das Options-Parsing der CLI, damit ein Auftrag, der mit
  // `--` beginnt (z. B. `--settings=…`), als Prompt-Text ankommt statt als
  // Flag interpretiert zu werden.
  args.push('--', auftrag)

  return new Promise((resolve) => {
    let text = ''
    let struktur: RollenVerdict | null = null
    let tokensIn = 0
    let tokensOut = 0
    let anfragen = 0
    let kostenUsd = 0
    let puffer = ''
    let fehlerText = ''
    let abgelaufen = false
    let fertig = false

    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(CLAUDE_BIN, args, {
        cwd: arbeitsdir(s.state),
        // Das Security-Gate ist ein Stop-Hook, der JEDE Session auffordert,
        // den security-reviewer über das Agent-Tool zu starten. Eine Rolle
        // hat dieses Werkzeug nicht — sie verschwendet damit nur Runden, um
        // zu erklären, dass sie nicht kann. Der Rollenlauf IST die Prüfung.
        env: { ...process.env, SECURITY_REVIEW_GATE: 'off' },
      })
    } catch (err) {
      resolve({ text: '', struktur: null, tokensIn: 0, tokensOut: 0, anfragen: 0, kostenUsd: 0, status: 'error', fehler: String(err) })
      return
    }
    s.rollenProzesse.set(rolle, child)

    // Zeitgrenze: eine hängende Rolle blockiert sonst den ganzen Lauf, und
    // bei Auto-Permissions arbeitet sie unbeaufsichtigt weiter.
    const uhr =
      ROLE_TIMEOUT_SEC > 0
        ? setTimeout(() => {
            abgelaufen = true
            push(s, { agent: rolle, kind: 'error', text: `Zeitgrenze von ${ROLE_TIMEOUT_SEC}s erreicht — wird beendet` })
            beende(child, 'Zeitgrenze')
          }, ROLE_TIMEOUT_SEC * 1000)
        : null
    uhr?.unref?.()

    const abschliessen = (status: RollenErgebnis['status'], fehler: string | null) => {
      if (fertig) return
      fertig = true
      if (uhr) clearTimeout(uhr)
      s.rollenProzesse.delete(rolle)
      resolve({ text, struktur, tokensIn, tokensOut, anfragen, kostenUsd, status, fehler })
    }

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      puffer += chunk
      const teile = puffer.split('\n')
      puffer = teile.pop() ?? ''
      for (const zeile of teile) {
        if (!zeile.trim()) continue
        try {
          const ev = JSON.parse(zeile)
          if (ev.type === 'assistant') {
            anfragen += 1
            const u = ev.message?.usage
            if (u) {
              tokensOut += u.output_tokens ?? 0
              tokensIn += u.input_tokens ?? 0
            }
            for (const b of ev.message?.content ?? []) {
              if (b?.type === 'text' && b.text?.trim()) text = b.text
              if (b?.type === 'tool_use') {
                setNode(s, rolle, { phase: describeTool(String(b.name), b.input).slice(0, 60) })
              }
            }
            setNode(s, rolle, { tokensIn, tokensOut, anfragen })
          }
          if (ev.type === 'result') {
            if (typeof ev.total_cost_usd === 'number') kostenUsd = ev.total_cost_usd
            if (schema && ev.structured_output && Array.isArray(ev.structured_output.befunde)) {
              struktur = ev.structured_output as RollenVerdict
            }
          }
        } catch {
          /* Zeile überspringen */
        }
      }
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      fehlerText = (fehlerText + chunk).slice(-600)
    })

    child.on('close', (code) => {
      if (abgelaufen) return abschliessen('timeout', `nach ${ROLE_TIMEOUT_SEC}s beendet`)
      if (code === 0) return abschliessen('done', null)
      abschliessen('error', fehlerText.trim() || `Prozess endete mit Code ${code}`)
    })
    child.on('error', (err) => abschliessen('error', err.message))
  })
}

/** Startet die gewählten Rollen als eigene Sessions — parallel, mit
 *  Zeitgrenze, eigenem Auftrag und eigener Abrechnung. Das ist der Weg, der
 *  nicht davon abhängt, dass der Orchestrator das Agent-Tool benutzt. */
export async function runPipeline(
  id: string,
  rollen: string[],
  opts: { model?: string; auftrag?: string; stand?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  const s = registry.get(id)
  if (!s) return { ok: false, error: 'Session unbekannt' }
  if (s.pipelineLaeuft) return { ok: false, error: 'Es läuft bereits ein Rollenlauf' }
  if (!rollen.length) return { ok: false, error: 'Keine Rolle gewählt' }
  // Rollennamen kommen aus dem Request-Body und landen in --agent und in
  // Dateipfaden — nichts außerhalb des Musters wird gestartet.
  if (rollen.some((r) => !ROLLENNAME.test(r))) return { ok: false, error: 'Ungültiger Rollenname' }

  // `auto` (Standard) heißt: kein --model, die Rollendatei entscheidet.
  const gewaehltesModell = opts.model && opts.model !== 'auto' ? opts.model : null
  const eigenerAuftrag = (opts.auftrag ?? '').trim()

  const stand = opts.stand === false ? null : await sammleArbeitsstand(arbeitsdir(s.state))
  if (!eigenerAuftrag && stand && stand.dateien === 0) {
    return { ok: false, error: 'Keine uncommitteten Änderungen — es gibt nichts zu prüfen.' }
  }

  const grundauftrag = eigenerAuftrag || (stand?.text ? PRUEFAUFTRAG_MIT_STAND : PRUEFAUFTRAG)
  const auftrag = stand?.text
    ? `${grundauftrag}\n\n---\n\n## Aktueller Arbeitsstand (${stand.dateien} Datei(en))\n\n${stand.text}`
    : grundauftrag
  // Am Knoten steht nur die Anweisung — der angehängte Stand würde sonst bei
  // jedem Ereignis über den Strom gehen und in der Ablage landen.
  const auftragAnzeige = stand?.text
    ? `${grundauftrag}\n\n[+ Arbeitsstand angehängt: ${stand.dateien} Datei(en), ${stand.text.length} Zeichen${stand.gekuerzt ? ', gekürzt' : ''}]`
    : grundauftrag

  // Rollen, deren Bereich der Diff gar nicht berührt, laufen nicht mit. Nur
  // beim Standard-Prüfauftrag — ein eigener Auftrag kann alles meinen.
  let aktiveRollen = [...rollen]
  if (!eigenerAuftrag && stand?.pfade.length) {
    const uiDatei = /\.(tsx|jsx|css|scss|astro|vue|svelte|html)$/i
    if (aktiveRollen.includes('ux-ui-expert') && !stand.pfade.some((p) => uiDatei.test(p))) {
      aktiveRollen = aktiveRollen.filter((r) => r !== 'ux-ui-expert')
      push(s, {
        agent: 'ux-ui-expert',
        kind: 'system',
        text: 'übersprungen — keine UI-Dateien im Diff',
      })
      setNode(s, 'ux-ui-expert', { status: 'idle', phase: 'übersprungen · keine UI im Diff' })
    }
  }
  if (!aktiveRollen.length) {
    return { ok: false, error: 'Alle gewählten Rollen wurden übersprungen — der Diff berührt ihre Bereiche nicht.' }
  }

  // Nachprüfung statt Voll-Review: Wer in dieser Session schon einmal über
  // den Stand gelaufen ist, bekommt seine Befunde und den Folge-Diff — nicht
  // noch einmal den Komplettauftrag. Grundlage ist das Verdict-JSON; der
  // Freitext ist nur Rückfall für Läufe aus der Zeit davor.
  const vorbefunde = new Map<string, string>()
  if (!eigenerAuftrag && stand?.text) {
    for (const n of s.state.nodes) {
      if (n.quelle !== 'rollenlauf' || n.status !== 'done' || !aktiveRollen.includes(n.id)) continue
      if (n.befunde) vorbefunde.set(n.id, JSON.stringify(n.befunde, null, 1))
      else if (n.volltext.trim()) vorbefunde.set(n.id, n.volltext)
    }
  }

  // Iterations-Grenze: nach zwei Nachprüfungen entscheidet nicht noch eine
  // dritte Runde, sondern ein Mensch. Sonst ist das wieder die Dauerschleife.
  const MAX_NACHPRUEFUNGEN = 2
  for (const rolle of [...aktiveRollen]) {
    const n = s.state.nodes.find((x) => x.id === rolle)
    if (vorbefunde.has(rolle) && n && n.nachpruefungen >= MAX_NACHPRUEFUNGEN) {
      aktiveRollen = aktiveRollen.filter((r) => r !== rolle)
      push(s, {
        agent: rolle,
        kind: 'error',
        text: `Iterations-Grenze: ${MAX_NACHPRUEFUNGEN} Nachprüfungen gelaufen — offene Befunde gehören jetzt an den Menschen.`,
      })
      setNode(s, rolle, { phase: 'Iterations-Grenze · Befunde an den Menschen' })
    }
  }
  if (!aktiveRollen.length) {
    return { ok: false, error: 'Keine Rolle mehr übrig — Iterations-Grenze erreicht, die offenen Befunde gehören an den Menschen.' }
  }
  const auftragFuer = (rolle: string): { text: string; anzeige: string; nachpruefung: boolean } => {
    const vor = vorbefunde.get(rolle)
    if (vor && stand?.text) {
      const alt = vor.length > 12000 ? vor.slice(0, 12000) + '\n[… gekürzt]' : vor
      return {
        text: `${NACHPRUEFUNGS_AUFTRAG}\n\n## Deine Befunde aus dem letzten Lauf\n\n${alt}\n\n---\n\n## Aktueller Arbeitsstand (${stand.dateien} Datei(en))\n\n${stand.text}`,
        anzeige: `${NACHPRUEFUNGS_AUFTRAG}\n\n[+ voriger Bericht und Arbeitsstand angehängt]`,
        nachpruefung: true,
      }
    }
    return { text: auftrag, anzeige: auftragAnzeige, nachpruefung: false }
  }

  // Nur für die Anzeige: welches Modell greift je Rolle?
  const modellJeRolle = new Map<string, string>()
  if (!gewaehltesModell) {
    try {
      for (const r of await listRoles()) if (r.model) modellJeRolle.set(r.name, r.model)
    } catch {
      /* Rollendateien nicht lesbar — dann eben ohne Angabe */
    }
  }

  s.pipelineLaeuft = true
  s.state.pipelineAktiv = true
  s.state.pipelineRollen = aktiveRollen
  const parallel = Math.min(PIPELINE_PARALLEL, aktiveRollen.length)
  const modellText = gewaehltesModell
    ? gewaehltesModell
    : aktiveRollen.map((r) => `${r}=${modellJeRolle.get(r) ?? PIPELINE_MODEL}`).join(' ')
  push(s, {
    agent: 'system',
    kind: 'system',
    text: `Rollenlauf gestartet · ${aktiveRollen.join(', ')} · ${modellText} · ${parallel} gleichzeitig`,
  })
  if (vorbefunde.size) {
    push(s, {
      agent: 'system',
      kind: 'system',
      text: `Nachprüfung statt Voll-Review für: ${[...vorbefunde.keys()].join(', ')} — nur Befund-Status und geänderte Stellen.`,
    })
  }
  if (stand?.text) {
    push(s, {
      agent: 'system',
      kind: 'system',
      text: `Arbeitsstand einmal ermittelt und allen Rollen mitgegeben · ${stand.dateien} Datei(en), ${stand.text.length} Zeichen${stand.gekuerzt ? ' (gekürzt)' : ''}`,
    })
  }
  emit(s, 'state', s.state)

  // Reihenfolge vorab festlegen, damit die Nummerierung stabil bleibt,
  // obwohl die Rollen gleichzeitig arbeiten.
  for (const rolle of aktiveRollen) {
    const n = node(s, rolle)
    setNode(s, rolle, {
      status: 'running',
      phase: 'wartet auf einen Platz',
      calls: n.calls + 1,
      order: n.order ?? ++s.orderCounter,
      auftrag: auftragFuer(rolle).anzeige,
      quelle: 'rollenlauf',
      volltext: '',
      ergebnis: '',
      startedAt: now(),
      endedAt: null,
    })
  }

  const warteschlange = [...aktiveRollen]

  const arbeite = async () => {
    for (;;) {
      const rolle = warteschlange.shift()
      if (!rolle) return
      if (s.state.status === 'abgebrochen') {
        setNode(s, rolle, { status: 'error', phase: 'nicht mehr gestartet', endedAt: now() })
        continue
      }
      const rollenModell = gewaehltesModell ?? modellJeRolle.get(rolle) ?? null
      const a = auftragFuer(rolle)
      setNode(s, rolle, { phase: `arbeitet (eigene Session${rollenModell ? `, ${rollenModell}` : ''})` })
      push(s, {
        agent: rolle,
        kind: 'agent',
        text: a.nachpruefung ? 'Nachprüfung der eigenen Befunde' : `Rollenlauf: ${grundauftrag.slice(0, 90)}`,
      })

      // Schema nur beim Standard-Prüfauftrag — ein freier Auftrag darf Prosa
      // liefern.
      const r = await laufeRolle(s, rolle, gewaehltesModell, a.text, eigenerAuftrag ? undefined : VERDICT_SCHEMA)
      s.state.tokensOut += r.tokensOut
      s.state.tokensIn += r.tokensIn
      s.state.anfragen += r.anfragen
      // Rollenkosten in Basis UND Stand: das nächste result-Event des
      // Orchestrators rechnet „Basis + eigener Prozess" und würde sie sonst
      // wieder überschreiben.
      s.kostenBasisUsd += r.kostenUsd
      s.state.kostenUsd += r.kostenUsd
      emit(s, 'tokens', {
        in: s.state.tokensIn,
        out: s.state.tokensOut,
        cached: s.state.tokensCached,
        cacheWrite: s.state.tokensCacheWrite,
        anfragen: s.state.anfragen,
        kosten: s.state.kostenUsd,
      })

      const volltext = r.struktur ? verdictAlsText(r.struktur) : r.text
      const ergebnis = r.struktur
        ? verdictKurz(r.struktur)
        : volltext
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(0, 3)
            .join(' · ')
            .slice(0, 300)

      const knoten = node(s, rolle)
      setNode(s, rolle, {
        status: r.status === 'done' ? 'done' : r.status,
        phase: r.status === 'done' ? 'zurückgemeldet' : r.status === 'timeout' ? 'Zeitgrenze' : 'Fehler',
        ergebnis: ergebnis || (r.fehler ?? ''),
        volltext,
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
        anfragen: r.anfragen,
        kostenUsd: r.kostenUsd,
        endedAt: now(),
        // Verdict-Basis nur überschreiben, wenn dieser Lauf eine geliefert
        // hat — ein freier Auftrag löscht die Nachprüfungs-Grundlage nicht.
        ...(r.struktur ? { befunde: r.struktur.befunde } : {}),
        ...(a.nachpruefung && r.status === 'done' ? { nachpruefungen: knoten.nachpruefungen + 1 } : {}),
      })
      if (volltext.trim()) {
        await schreibeRollenbericht(s, rolle, volltext)
        const eintrag = { t: now(), text: `## ${rolle}\n\n${volltext}` }
        s.state.antworten.push(eintrag)
        emit(s, 'antwort', eintrag)
      }
      push(s, {
        agent: rolle,
        kind: r.status === 'done' ? 'agent' : 'error',
        text:
          r.status === 'done'
            ? `fertig · ${r.anfragen} Anfragen · ${r.tokensOut} Tokens aus`
            : `${r.status === 'timeout' ? 'Zeitgrenze' : 'Fehler'} · ${r.fehler ?? ''}`.slice(0, 200),
      })
    }
  }

  await Promise.all(Array.from({ length: parallel }, arbeite))

  const fehlgeschlagen = aktiveRollen.filter((r) => {
    const n = s.state.nodes.find((x) => x.id === r)
    return n && n.status !== 'done'
  })

  // Der Stop-Hook der Haupt-Session weiß nichts von diesem Review und würde
  // denselben Änderungsstand am Sitzungsende noch einmal anstoßen. Der Marker
  // sagt ihm: schon geprüft. Die Hash-Logik liegt im Gate-Skript selbst.
  if (
    aktiveRollen.includes('security-reviewer') &&
    !fehlgeschlagen.includes('security-reviewer') &&
    s.state.claudeSessionId
  ) {
    try {
      await execFile(
        path.join(HOME, '.claude', 'scripts', 'security-review-gate.sh'),
        ['mark', arbeitsdir(s.state), s.state.claudeSessionId],
        { timeout: 20000 },
      )
      push(s, {
        agent: 'system',
        kind: 'system',
        text: 'Security-Gate: Stand als geprüft markiert — der Stop-Hook prüft ihn nicht erneut.',
      })
    } catch {
      /* Marker ist ein Extra — schlimmstenfalls prüft der Hook doppelt */
    }
  }

  push(s, {
    agent: 'system',
    kind: fehlgeschlagen.length ? 'error' : 'result',
    text: fehlgeschlagen.length
      ? `Rollenlauf beendet — ohne Ergebnis: ${fehlgeschlagen.join(', ')}`
      : 'Rollenlauf abgeschlossen',
  })
  s.pipelineLaeuft = false
  s.state.pipelineAktiv = false
  emit(s, 'state', s.state)
  await persist(s)
  return { ok: true }
}
