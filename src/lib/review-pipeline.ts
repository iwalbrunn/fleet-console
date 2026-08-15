import {
  execFile as execFileCallback,
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { describeTool } from './claude-events'
import { terminateProcess } from './claude-process'
import {
  AUTOCOMPACT,
  CLAUDE_BIN,
  DIFF_MAX,
  HOME,
  PIPELINE_MODEL,
  PIPELINE_PARALLEL,
  ROLE_TIMEOUT_SEC,
} from './config'
import {
  NACHPRUEFUNGS_AUFTRAG,
  PRUEFAUFTRAG,
  PRUEFAUFTRAG_MIT_STAND,
  VERDICT_SCHEMA,
  verdictAlsText,
  verdictKurz,
} from './review-verdict'
import {
  emit,
  node,
  now,
  push,
  registry,
  setNode,
  writeRoleReport,
  type SessionRuntime,
} from './session-runtime'
import { worktreeManager } from './session-worktrees'
import { listRoles } from './settings'
import { neuerUsageZaehler, usageDelta } from './usage'
import type { RollenVerdict } from './types'

const execFile = promisify(execFileCallback)
const ROLLENNAME = /^[A-Za-z0-9_-]+$/

export interface Arbeitsstand {
  text: string
  dateien: number
  pfade: string[]
  gekuerzt: boolean
}

/** Ermittelt den uncommitteten Stand einmal für alle Rollen eines Review-Laufs. */
export async function collectWorkingState(project: string): Promise<Arbeitsstand | null> {
  const git = async (args: string[]) =>
    (
      await execFile('git', ['-C', project, ...args], {
        maxBuffer: 32 * 1024 * 1024,
        timeout: 20000,
      })
    ).stdout

  try {
    await git(['rev-parse', '--is-inside-work-tree'])
  } catch {
    return null
  }

  let status = ''
  try {
    status = await git(['status', '--porcelain', '--untracked-files=all'])
  } catch {
    return null
  }
  const lines = status.split('\n').filter((line) => line.trim())
  const paths = lines.map((line) =>
    line
      .slice(3)
      .trim()
      .replace(/.* -> /, '')
  )
  if (!lines.length) return { text: '', dateien: 0, pfade: [], gekuerzt: false }

  let diff = ''
  try {
    diff = await git(['diff', 'HEAD'])
  } catch {
    /* Ein Repository ohne ersten Commit hat noch keinen HEAD. */
  }

  const parts = ['### Geänderte Dateien\n\n```\n' + status.trim() + '\n```']
  if (diff.trim()) parts.push('### git diff HEAD\n\n```diff\n' + diff.trim() + '\n```')

  for (const line of lines) {
    if (!line.startsWith('??')) continue
    const file = line.slice(3).trim()
    try {
      const fullPath = path.join(project, file)
      const stat = await fs.stat(fullPath)
      if (!stat.isFile() || stat.size > 256 * 1024) continue
      const raw = await fs.readFile(fullPath)
      if (raw.subarray(0, 8000).includes(0)) continue
      parts.push(`### Neue Datei ${file}\n\n\`\`\`\n${raw.toString('utf8')}\n\`\`\``)
    } catch {
      /* Nicht lesbare Dateien kann die Rolle bei Bedarf selbst prüfen. */
    }
  }

  let text = parts.join('\n\n')
  let gekuerzt = false
  if (text.length > DIFF_MAX) {
    text = text.slice(0, DIFF_MAX) + '\n\n[… gekürzt — den Rest bei Bedarf selbst nachlesen]'
    gekuerzt = true
  }
  return { text, dateien: lines.length, pfade: paths, gekuerzt }
}
export interface RollenErgebnis {
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

export interface RoleProcessOptions {
  binary?: string
  timeoutSec?: number
}

/** Führt eine Rolle als eigene, kurze Session aus. Frischer Kontext statt der
 *  gewachsenen Unterhaltung — das ist der Kostenhebel. Und der Aufruf hängt
 *  nicht davon ab, ob der Orchestrator delegieren mag. */
export async function runRoleProcess(
  s: SessionRuntime,
  rolle: string,
  model: string | null,
  auftrag: string,
  schema?: object,
  options: RoleProcessOptions = {}
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
    const zaehler = neuerUsageZaehler()
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
      child = spawn(options.binary ?? CLAUDE_BIN, args, {
        cwd: worktreeManager.workingDirectory(s.state),
        // Das Security-Gate ist ein Stop-Hook, der JEDE Session auffordert,
        // den security-reviewer über das Agent-Tool zu starten. Eine Rolle
        // hat dieses Werkzeug nicht — sie verschwendet damit nur Runden, um
        // zu erklären, dass sie nicht kann. Der Rollenlauf IST die Prüfung.
        env: { ...process.env, SECURITY_REVIEW_GATE: 'off' },
      })
    } catch (err) {
      resolve({
        text: '',
        struktur: null,
        tokensIn: 0,
        tokensOut: 0,
        anfragen: 0,
        kostenUsd: 0,
        status: 'error',
        fehler: String(err),
      })
      return
    }
    s.rollenProzesse.set(rolle, child)

    // Zeitgrenze: eine hängende Rolle blockiert sonst den ganzen Lauf, und
    // bei Auto-Permissions arbeitet sie unbeaufsichtigt weiter.
    const timeoutSec = options.timeoutSec ?? ROLE_TIMEOUT_SEC
    const uhr =
      timeoutSec > 0
        ? setTimeout(() => {
            abgelaufen = true
            push(s, {
              agent: rolle,
              kind: 'error',
              text: `Zeitgrenze von ${timeoutSec}s erreicht — wird beendet`,
            })
            terminateProcess(child)
          }, timeoutSec * 1000)
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
            const u = ev.message?.usage
            if (u) {
              const d = usageDelta(zaehler, ev.message?.id, u)
              if (d.neueNachricht) anfragen += 1
              tokensOut += d.out
              tokensIn += d.in
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
      if (abgelaufen) return abschliessen('timeout', `nach ${timeoutSec}s beendet`)
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
  opts: { model?: string; auftrag?: string; stand?: boolean } = {}
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

  const stand =
    opts.stand === false
      ? null
      : await collectWorkingState(worktreeManager.workingDirectory(s.state))
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
    return {
      ok: false,
      error: 'Alle gewählten Rollen wurden übersprungen — der Diff berührt ihre Bereiche nicht.',
    }
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
    return {
      ok: false,
      error:
        'Keine Rolle mehr übrig — Iterations-Grenze erreicht, die offenen Befunde gehören an den Menschen.',
    }
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
      setNode(s, rolle, {
        phase: `arbeitet (eigene Session${rollenModell ? `, ${rollenModell}` : ''})`,
      })
      push(s, {
        agent: rolle,
        kind: 'agent',
        text: a.nachpruefung
          ? 'Nachprüfung der eigenen Befunde'
          : `Rollenlauf: ${grundauftrag.slice(0, 90)}`,
      })

      // Schema nur beim Standard-Prüfauftrag — ein freier Auftrag darf Prosa
      // liefern.
      const r = await runRoleProcess(
        s,
        rolle,
        gewaehltesModell,
        a.text,
        eigenerAuftrag ? undefined : VERDICT_SCHEMA
      )
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
        phase:
          r.status === 'done' ? 'zurückgemeldet' : r.status === 'timeout' ? 'Zeitgrenze' : 'Fehler',
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
        ...(a.nachpruefung && r.status === 'done'
          ? { nachpruefungen: knoten.nachpruefungen + 1 }
          : {}),
      })
      if (volltext.trim()) {
        await writeRoleReport(s, rolle, volltext)
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
            : `${r.status === 'timeout' ? 'Zeitgrenze' : 'Fehler'} · ${r.fehler ?? ''}`.slice(
                0,
                200
              ),
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
        ['mark', worktreeManager.workingDirectory(s.state), s.state.claudeSessionId],
        { timeout: 20000 }
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
  await s.persist()
  return { ok: true }
}
