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
      env: options.env ?? { ...process.env },
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
        eventHandler(session, JSON.parse(line))
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

  child.on('error', (error) => {
    state.status = 'fehler'
    push(session, { agent: 'system', kind: 'error', text: `Prozessfehler: ${error.message}` })
    emit(session, 'state', state)
  })

  child.on('close', (code) => {
    if (session.wirdUmgestellt) return
    if (state.status !== 'abgebrochen') state.status = code === 0 ? 'fertig' : 'fehler'
    state.endedAt = now()
    setNode(session, 'orchestrator', {
      status: code === 0 ? 'done' : 'error',
      phase: code === 0 ? 'Abgeschlossen' : `Beendet mit Code ${code}`,
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
    if (openRequirements) {
      push(session, {
        agent: 'system',
        kind: 'error',
        text: `Laut Anforderungsliste noch ${openRequirements} Eintrag/Einträge offen — vor dem Abhaken prüfen.`,
      })
    }
    push(session, { agent: 'system', kind: 'result', text: `Prozess beendet (Code ${code})` })
    if (state.status === 'fertig' || state.status === 'abgebrochen') void cleanupWorktree(session)
    void session.persist()
    emit(session, 'state', state)
    emit(session, 'end', { id: state.id })
  })

  return true
}

/** Beendet einen Prozess höflich und fasst nach der Frist hart nach. */
export function terminateProcess(child: ChildProcessWithoutNullStreams): void {
  child.kill('SIGTERM')
  setTimeout(() => {
    if (!child.killed) child.kill('SIGKILL')
  }, GRACE_SEC * 1000).unref?.()
}
