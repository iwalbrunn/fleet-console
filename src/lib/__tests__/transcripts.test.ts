// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, test, vi } from 'vitest'
const config = vi.hoisted(() => ({ PROJECTS_DIR: '', shortProjectName: (s: string) => s }))
vi.mock('../config', () => config)
import { listRuns } from '../transcripts'
test('history deduplicates token counts across content blocks', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fleet-transcripts-'))
  config.PROJECTS_DIR = dir
  try {
    await fs.mkdir(path.join(dir, 'project'))
    const event = {
      type: 'assistant',
      cwd: '/project',
      timestamp: '2026-09-05T08:00:00Z',
      message: {
        id: 'a',
        usage: {
          input_tokens: 10,
          output_tokens: 50,
          cache_creation_input_tokens: 5,
          cache_read_input_tokens: 200,
        },
        content: [],
      },
    }
    await fs.writeFile(
      path.join(dir, 'project', 'a.jsonl'),
      [event, event, { ...event, message: { ...event.message, id: 'b' } }]
        .map((v) => JSON.stringify(v))
        .join('\n')
    )
    expect((await listRuns())[0]).toMatchObject({ tokensIn: 30, tokensOut: 100, tokensCached: 400 })
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
