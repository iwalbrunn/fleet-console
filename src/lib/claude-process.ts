import { neuerUsageZaehler } from './usage'
import { childEnvironment } from './child-env'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { handleClaudeEvent } from './claude-events'
import { cliText } from './claude-cli'
import { CLAUDE_BIN, GRACE_SEC } from './config'
import { emit, now, planeAblage, push, setNode, type SessionRuntime } from './session-runtime'
import { worktreeManager } from './session-worktrees'

interface ClaudeProcessOptions {
  binary?: string
  env?: NodeJS.ProcessEnv
  handleEvent?: (session: SessionRuntime, event: unknown) => void
}

async function cleanupWorktree(session: SessionRuntime): Promise<void> {
  const result = await worktreeManager.cleanup(session.state)
  if (result.kind === 'kept') {
    push(session, {
      agent: 'system',
      kind: 'system',
      text: `Worktree behalten — er enthält Arbeit: ${result.path} (Branch ${result.branch})`,
    })
    return
  }
  if (result.kind === 'removed') {
    session.state.worktreePath = null
    push(session, { agent: 'system', kind: 'system', text: 'Worktree unverändert — aufgeräumt.' })
    planeAblage(session)
  }
}

/** Startet den CLI-Prozess und bindet seinen JSONL-Stream an den Sessionzustand. */
export function startClaudeProcess(
  session: SessionRuntime,
  args: string[],
  options: ClaudeProcessOptions = {}
): boolean {
  const state = session.state
  const eventHandler = options.handleEvent ?? handleClaudeEvent
  let child: ChildProcessWithoutNullStreams
  try {
    child = spawn(options.binary ?? CLAUDE_BIN, args, {
      cwd: worktreeManager.workingDirectory(state),
      env: childEnvironment(options.env),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (error) {
    state.status = 'fehler'
    state.endedAt = now()
    push(session, {
      agent: 'system',
      kind: 'error',
      text: `Start fehlgeschlagen: ${String(error)}`,
    })
    return false
  }

  session.processUsage = { in: 0, out: 0, cacheWrite: 0, cacheRead: 0 }
  session.roundOutput = 0
  session.usageZaehler = neuerUsageZaehler()
  session.child = child
  let stdoutBuffer = ''
  let stderrBuffer = ''
  let stderrTail = ''
  const current = () => session.child === child && !session.wirdUmgestellt
  const stdoutLine = (line: string) => {
    if (!line.trim() || !current()) return
    try {
      eventHandler(session, JSON.parse(line))
    } catch {
      push(session, { agent: 'stdout', kind: 'text', text: line.slice(0, 400) })
    }
  }
  const stderrLine = (line: string) => {
    if (!line.trim() || !current()) return
    // stderr ist ein Diagnosekanal, kein Fehlerstatus. Maßgeblich sind
    // strukturierte Fehlerereignisse und der Exit-Code.
    push(session, { agent: 'stderr', kind: 'system', text: line.slice(0, 400) })
  }
  state.endedAt = null
  state.status = 'läuft'
  state.cli = cliText(args)
  push(session, { agent: 'system', kind: 'system', text: `$ ${state.cli}` })

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    if (!current()) return
    stdoutBuffer += chunk
    const parts = stdoutBuffer.split('\n')
    stdoutBuffer = parts.pop() ?? ''
    for (const line of parts) stdoutLine(line)
  })

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    if (!current()) return
    stderrTail = (stderrTail + chunk).slice(-1200)
    stderrBuffer += chunk
    const parts = stderrBuffer.split('\n')
    stderrBuffer = parts.pop() ?? ''
    for (const line of parts) stderrLine(line)
    if (stderrBuffer.length > 4000) {
      stderrLine(stderrBuffer)
      stderrBuffer = ''
    }
  })

  child.stdin.on('error', (error) => {
    if (!current() || state.status === 'abgebrochen') return
    push(session, {
      agent: 'system',
      kind: 'error',
      text: `Eingabe fehlgeschlagen: ${error.message}`,
    })
  })

  child.on('error', (error) => {
    if (!current()) return
    state.status = 'fehler'
    push(session, { agent: 'system', kind: 'error', text: `Prozessfehler: ${error.message}` })
    emit(session, 'state', state)
  })

  child.on('close', (code, signal) => {
    // Nur der aktuell gebundene Prozess darf den Sessionzustand abschließen.
    // Nach einer Umstellung (reconfigureSession) läuft längst ein neuer
    // Prozess — das späte close des alten darf ihn nicht beenden.
    if (session.wirdUmgestellt || session.child !== child) return
    stdoutLine(stdoutBuffer)
    stderrLine(stderrBuffer)
    session.child = null
    session.rundeAktiv = false
    const aborted = state.status === 'abgebrochen'
    const failed =
      code !== 0 || state.nodes.find((n) => n.id === 'orchestrator')?.status === 'error'
    if (!aborted) state.status = failed ? 'fehler' : 'fertig'
    state.endedAt = now()
    setNode(session, 'orchestrator', {
      status: aborted || failed ? 'error' : 'done',
      phase: aborted ? 'Abgebrochen' : failed ? `Beendet (${signal ?? code})` : 'Abgeschlossen',
    })
    for (const graphNode of state.nodes) {
      if (
        graphNode.id === 'orchestrator' ||
        graphNode.status !== 'running' ||
        graphNode.quelle === 'rollenlauf'
      ) {
        continue
      }
      setNode(session, graphNode.id, {
        status: 'error',
        phase: 'ohne Rückmeldung beendet',
        endedAt: now(),
      })
    }
    const openRequirements = state.anforderungen.filter((entry) => entry.status === 'offen').length
    if (openRequirements && !aborted) {
      push(session, {
        agent: 'system',
        kind: 'system',
        text: `Laut Anforderungsliste noch ${openRequirements} Eintrag/Einträge offen — vor dem Abhaken prüfen.`,
      })
    }
    push(session, {
      agent: 'system',
      kind: !aborted && failed ? 'error' : 'result',
      text: aborted
        ? 'Prozess abgebrochen'
        : `Prozess beendet (${signal ?? code})${failed && stderrTail.trim() ? ` · ${stderrTail.trim()}` : ''}`,
    })
    // Auch nach einem Absturz aufräumen: cleanup() behält den Worktree von
    // selbst, sobald er Änderungen enthält.
    void cleanupWorktree(session).catch((error) => {
      push(session, {
        agent: 'system',
        kind: 'error',
        text: `Worktree-Aufräumen fehlgeschlagen: ${String(error)}`,
      })
    })
    void session.persist()
    emit(session, 'state', state)
    emit(session, 'end', { id: state.id })
  })

  return true
}

/** Beendet einen Prozess höflich und fasst nach der Frist hart nach. */
export function terminateProcess(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  // killed sagt nur, dass ein Signal gesendet wurde, nicht dass der Prozess endete.
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }, GRACE_SEC * 1000)
  timer.unref?.()
  child.once('close', () => clearTimeout(timer))
}
