import fs from 'node:fs/promises'
import path from 'node:path'
import { ANFORDERUNGEN_DIR } from './config'
import type { Anforderung } from './types'

const ANF_STATUS = new Set<Anforderung['status']>(['offen', 'erledigt', 'verworfen'])

export function createRequirementStore(directory: string = ANFORDERUNGEN_DIR) {
  const file = (id: string) => path.join(directory, `${id}.json`)

  const write = async (id: string, entries: Anforderung[]) => {
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(file(id), JSON.stringify(entries, null, 2), 'utf8')
  }

  const merge = async (id: string, canonical: Anforderung[]): Promise<Anforderung[]> => {
    const entries = canonical.map((entry) => ({ ...entry }))
    let raw: unknown
    try {
      raw = JSON.parse(await fs.readFile(file(id), 'utf8'))
    } catch {
      return entries
    }
    if (!Array.isArray(raw)) return entries

    for (const entry of entries) {
      const update = (raw as Array<Record<string, unknown>>).find(
        (candidate) => candidate?.id === entry.id
      )
      if (!update) continue
      if (
        typeof update.status === 'string' &&
        ANF_STATUS.has(update.status as Anforderung['status'])
      ) {
        entry.status = update.status as Anforderung['status']
      }
      if (typeof update.notiz === 'string') entry.notiz = update.notiz.slice(0, 300)
    }
    return entries
  }

  const append = async (
    id: string,
    canonical: Anforderung[],
    text: string,
    timestamp: string
  ): Promise<Anforderung[]> => {
    const entries = await merge(id, canonical)
    entries.push({ id: `a${entries.length + 1}`, t: timestamp, text, status: 'offen' })
    await write(id, entries)
    return entries
  }

  const inherit = (source: Anforderung[], sourceId: string, timestamp: string): Anforderung[] =>
    source
      .filter((entry) => entry.status === 'offen' && typeof entry.text === 'string')
      .map((entry, index) => ({
        id: `a${index + 1}`,
        t: timestamp,
        text: entry.text,
        status: 'offen',
        notiz: `übernommen aus Session ${sourceId.slice(0, 8)}`,
      }))

  return { file, write, merge, append, inherit }
}

export const requirementStore = createRequirementStore()
