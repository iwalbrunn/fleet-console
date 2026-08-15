// @vitest-environment node
import { execFile as execFileCallback } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createWorktreeManager } from '../session-worktrees'

const execFile = promisify(execFileCallback)

describe('Worktree-Verwaltung', () => {
  let directory: string
  let project: string
  let worktreesDirectory: string

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fleet-worktrees-'))
    project = path.join(directory, 'project')
    worktreesDirectory = path.join(directory, 'worktrees')
    await fs.mkdir(project)
    await execFile('git', ['init', '-b', 'main'], { cwd: project })
    await execFile('git', ['config', 'user.email', 'fleet@example.test'], { cwd: project })
    await execFile('git', ['config', 'user.name', 'Fleet Test'], { cwd: project })
    await fs.writeFile(path.join(project, 'README.md'), '# Test\n', 'utf8')
    await execFile('git', ['add', 'README.md'], { cwd: project })
    await execFile('git', ['commit', '-m', 'Initial'], { cwd: project })
  })

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true })
  })

  test('entfernt einen unveränderten Worktree samt temporärem Branch', async () => {
    const manager = createWorktreeManager(worktreesDirectory)
    const id = '12345678-1234-4123-8123-123456789abc'
    const created = await manager.create(project, id)

    const result = await manager.cleanup({
      id,
      project,
      worktreePath: created.path,
      worktreeBasis: created.basis,
    })

    expect(result).toEqual({ kind: 'removed' })
    await expect(fs.stat(created.path)).rejects.toThrow()
    const branches = (
      await execFile('git', ['branch', '--list', 'fleet/12345678'], { cwd: project })
    ).stdout
    expect(branches.trim()).toBe('')
  })

  test('behält einen Worktree mit uncommittierten Änderungen', async () => {
    const manager = createWorktreeManager(worktreesDirectory)
    const id = 'abcdef12-1234-4123-8123-123456789abc'
    const created = await manager.create(project, id)
    await fs.writeFile(path.join(created.path, 'change.txt'), 'nicht verlieren\n', 'utf8')

    const result = await manager.cleanup({
      id,
      project,
      worktreePath: created.path,
      worktreeBasis: created.basis,
    })

    expect(result).toEqual({
      kind: 'kept',
      path: created.path,
      branch: 'fleet/abcdef12',
    })
    expect((await fs.stat(created.path)).isDirectory()).toBe(true)
  })

  test('behält einen sauberen Worktree mit eigenen Commits', async () => {
    const manager = createWorktreeManager(worktreesDirectory)
    const id = 'fedcba98-1234-4123-8123-123456789abc'
    const created = await manager.create(project, id)
    await fs.writeFile(path.join(created.path, 'committed.txt'), 'bleibt erhalten\n', 'utf8')
    await execFile('git', ['add', 'committed.txt'], { cwd: created.path })
    await execFile('git', ['commit', '-m', 'Worktree change'], { cwd: created.path })

    const result = await manager.cleanup({
      id,
      project,
      worktreePath: created.path,
      worktreeBasis: created.basis,
    })

    expect(result.kind).toBe('kept')
    expect((await fs.stat(created.path)).isDirectory()).toBe(true)
  })
})
