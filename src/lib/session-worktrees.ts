import { execFile as execFileCallback } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { WORKTREES_DIR } from './config'

const execFile = promisify(execFileCallback)

export interface WorktreeState {
  id: string
  project: string
  worktreePath: string | null
  worktreeBasis: string | null
}

export type WorktreeCleanupResult =
  | { kind: 'none' }
  | { kind: 'removed' }
  | { kind: 'kept'; path: string; branch: string }
  | { kind: 'error' }

export function createWorktreeManager(directory: string = WORKTREES_DIR) {
  const branch = (id: string) => `fleet/${id.slice(0, 8)}`

  const workingDirectory = (state: Pick<WorktreeState, 'project' | 'worktreePath'>): string =>
    state.worktreePath ?? state.project

  const create = async (project: string, id: string): Promise<{ path: string; basis: string }> => {
    const worktreePath = path.join(directory, id.slice(0, 8))
    await fs.mkdir(directory, { recursive: true })
    const basis = (
      await execFile('git', ['-C', project, 'rev-parse', 'HEAD'], { timeout: 15000 })
    ).stdout.trim()
    await execFile('git', ['-C', project, 'worktree', 'add', '-b', branch(id), worktreePath], {
      timeout: 30000,
    })
    return { path: worktreePath, basis }
  }

  const cleanup = async (state: WorktreeState): Promise<WorktreeCleanupResult> => {
    const worktreePath = state.worktreePath
    if (!worktreePath) return { kind: 'none' }
    try {
      const status = (
        await execFile('git', ['-C', worktreePath, 'status', '--porcelain'], { timeout: 15000 })
      ).stdout.trim()
      const head = (
        await execFile('git', ['-C', worktreePath, 'rev-parse', 'HEAD'], { timeout: 15000 })
      ).stdout.trim()
      if (status || (state.worktreeBasis && head !== state.worktreeBasis)) {
        return { kind: 'kept', path: worktreePath, branch: branch(state.id) }
      }
      await execFile('git', ['-C', state.project, 'worktree', 'remove', '--force', worktreePath], {
        timeout: 20000,
      })
      await execFile('git', ['-C', state.project, 'branch', '-D', branch(state.id)], {
        timeout: 15000,
      }).catch(() => {})
      return { kind: 'removed' }
    } catch {
      return { kind: 'error' }
    }
  }

  return { workingDirectory, create, cleanup }
}

export const worktreeManager = createWorktreeManager()
