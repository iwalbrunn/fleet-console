import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { REPORTS_DIR, RUNS_DIR } from './config'
import type { SessionState } from './types'

const ROLLENNAME = /^[A-Za-z0-9_-]+$/

interface SessionStoreOptions {
  runsDirectory?: string
  reportsDirectory?: string
}

export function createSessionStore({
  runsDirectory = RUNS_DIR,
  reportsDirectory = REPORTS_DIR,
}: SessionStoreOptions = {}) {
  const file = (id: string) => path.join(runsDirectory, `${id}.json`)

  const loadAll = async (): Promise<SessionState[]> => {
    let files: string[]
    try {
      files = (await fs.readdir(runsDirectory)).filter((entry) => entry.endsWith('.json'))
    } catch {
      return []
    }

    const states: SessionState[] = []
    for (const entry of files) {
      try {
        const state = JSON.parse(
          await fs.readFile(path.join(runsDirectory, entry), 'utf8')
        ) as SessionState
        if (!state?.id) continue
        if (state.status === 'läuft' || state.status === 'startet') {
          state.status = state.claudeSessionId ? 'unterbrochen' : 'abgebrochen'
        }
        state.pipelineAktiv = false
        state.mode ??= 'direct'
        state.effort ??= 'high'
        state.verification ??= {
          status: 'idle',
          risk: 'low',
          reasons: [],
          focuses: [],
          checks: [],
          fingerprint: null,
          updatedAt: null,
        }
        state.skipPermissions = Boolean(state.skipPermissions)
        state.kostenUsd ??= 0
        state.anforderungen ??= []
        state.worktreePath ??= null
        state.worktreeBasis ??= null
        for (const node of state.nodes ?? []) {
          node.kostenUsd ??= 0
          node.befunde ??= null
          node.nachpruefungen ??= 0
        }
        states.push(state)
      } catch {
        /* Unlesbare Ablage überspringen. */
      }
    }
    return states
  }

  const pending = new Map<string, Promise<void>>()
  const persist = (state: SessionState, lastAssistantText: string): Promise<void> => {
    // Snapshot at invocation: later writes must not mutate this save midway.
    const snapshot = structuredClone(state)
    if (lastAssistantText.trim()) {
      snapshot.reportPath = path.join(reportsDirectory, `${state.id}.md`)
      state.reportPath = snapshot.reportPath
    }
    const next = (pending.get(state.id) ?? Promise.resolve())
      .catch(() => {})
      .then(() => save(snapshot, lastAssistantText))
    pending.set(state.id, next)
    void next
      .finally(() => {
        if (pending.get(state.id) === next) pending.delete(state.id)
      })
      .catch(() => {})
    return next
  }
  const atomicWrite = async (target: string, content: string) => {
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 })
      await fs.rename(temporary, target)
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {})
    }
  }
  const save = async (state: SessionState, lastAssistantText: string): Promise<void> => {
    await fs.mkdir(runsDirectory, { recursive: true })
    await fs.mkdir(reportsDirectory, { recursive: true })
    if (lastAssistantText.trim()) {
      const report = path.join(reportsDirectory, `${state.id}.md`)
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
      await atomicWrite(report, head + lastAssistantText)
      state.reportPath = report
    }
    await atomicWrite(file(state.id), JSON.stringify(state, null, 2))
  }

  const writeRoleReport = async (
    state: SessionState,
    role: string,
    text: string,
    timestamp: string
  ): Promise<string | null> => {
    if (!text.trim() || !ROLLENNAME.test(role)) return null
    await fs.mkdir(reportsDirectory, { recursive: true })
    const report = path.join(reportsDirectory, `${state.id}-${role}.md`)
    const head = [
      `# ${role}`,
      '',
      `- Lauf: ${state.id}`,
      `- Projekt: ${state.project}`,
      `- Zeit: ${timestamp}`,
      '',
      '---',
      '',
    ].join('\n')
    await atomicWrite(report, head + text)
    return report
  }

  return { file, loadAll, persist, writeRoleReport }
}

export const sessionStore = createSessionStore()
