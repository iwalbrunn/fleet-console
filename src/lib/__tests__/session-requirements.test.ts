// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createRequirementStore } from '../session-requirements'
import type { Anforderung } from '../types'

describe('Anforderungsablage', () => {
  let directory: string

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fleet-requirements-'))
  })

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true })
  })

  test('übernimmt vom Modell nur Status und Notiz bekannter Anforderungen', async () => {
    const store = createRequirementStore(directory)
    const canonical: Anforderung[] = [
      {
        id: 'a1',
        t: '2026-08-15T08:00:00.000Z',
        text: 'Session-Typen vereinheitlichen',
        status: 'offen',
      },
    ]
    await fs.writeFile(
      store.file('session-1'),
      JSON.stringify([
        {
          ...canonical[0],
          text: 'Manipulierter Text',
          status: 'erledigt',
          notiz: 'x'.repeat(400),
        },
        {
          id: 'a2',
          t: '2026-08-15T08:01:00.000Z',
          text: 'Eingeschleuste Anforderung',
          status: 'offen',
        },
      ]),
      'utf8'
    )

    const merged = await store.merge('session-1', canonical)

    expect(merged).toEqual([
      {
        ...canonical[0],
        status: 'erledigt',
        notiz: 'x'.repeat(300),
      },
    ])
  })

  test('hängt nach dem Einlesen des Modellstatus eine neue Anforderung kanonisch an', async () => {
    const store = createRequirementStore(directory)
    const canonical: Anforderung[] = [
      {
        id: 'a1',
        t: '2026-08-15T08:00:00.000Z',
        text: 'Erste Anforderung',
        status: 'offen',
      },
    ]
    await store.write('session-1', [{ ...canonical[0], status: 'erledigt' }])

    const updated = await store.append(
      'session-1',
      canonical,
      'Zweite Anforderung',
      '2026-08-15T08:05:00.000Z'
    )

    expect(updated).toEqual([
      { ...canonical[0], status: 'erledigt' },
      {
        id: 'a2',
        t: '2026-08-15T08:05:00.000Z',
        text: 'Zweite Anforderung',
        status: 'offen',
      },
    ])
    expect(JSON.parse(await fs.readFile(store.file('session-1'), 'utf8'))).toEqual(updated)
  })

  test('übernimmt bei einer Übergabe ausschließlich offene Anforderungen', () => {
    const store = createRequirementStore(directory)
    const source: Anforderung[] = [
      { id: 'a1', t: 'alt', text: 'Bereits fertig', status: 'erledigt' },
      { id: 'a2', t: 'alt', text: 'Noch offen', status: 'offen' },
    ]

    expect(store.inherit(source, '12345678-abcd', '2026-08-15T08:10:00.000Z')).toEqual([
      {
        id: 'a1',
        t: '2026-08-15T08:10:00.000Z',
        text: 'Noch offen',
        status: 'offen',
        notiz: 'übernommen aus Session 12345678',
      },
    ])
  })
})
