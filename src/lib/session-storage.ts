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

  const persist = async (state: SessionState, lastAssistantText: string): Promise<void> => {
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
      await fs.writeFile(report, head + lastAssistantText, 'utf8')
      state.reportPath = report
    }
    await fs.writeFile(file(state.id), JSON.stringify(state, null, 2), 'utf8')
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
    await fs.writeFile(report, head + text, 'utf8')
    return report
  }

  return { file, loadAll, persist, writeRoleReport }
}

export const sessionStore = createSessionStore()
