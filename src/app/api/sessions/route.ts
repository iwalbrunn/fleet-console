import { NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import path from 'node:path'
import { isWithinProjectRoots } from '@/lib/config'
import { rejectCrossOrigin } from '@/lib/http'
import { listSessions, startSession } from '@/lib/sessions'
import type { EffortLevel, ExecutionMode } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ sessions: await listSessions() })
}

export async function POST(req: Request) {
  const blocked = rejectCrossOrigin(req)
  if (blocked) return blocked

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Ungültiger Request-Body' }, { status: 400 })

  const project = String(body.project ?? '')
  const prompt = String(body.prompt ?? '').trim()
  const model = String(body.model ?? 'fable')
  const modeRaw = String(body.mode ?? 'direct')
  const mode: ExecutionMode = ['direct', 'verified', 'parallel'].includes(modeRaw)
    ? (modeRaw as ExecutionMode)
    : 'direct'
  const effortRaw = String(body.effort ?? 'high')
  const effort: EffortLevel = ['low', 'medium', 'high', 'xhigh', 'max'].includes(effortRaw)
    ? (effortRaw as EffortLevel)
    : 'high'
  const roles: string[] = Array.isArray(body.roles) ? body.roles.map(String) : []
  const skipPermissions = Boolean(body.skipPermissions)
  const worktree = Boolean(body.worktree)
  // Wird Teil eines Dateipfads — alles außer einer Session-UUID fliegt raus.
  const uebergabeRoh = body.uebergabeVon ? String(body.uebergabeVon) : undefined
  if (
    uebergabeRoh &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uebergabeRoh)
  ) {
    return NextResponse.json(
      { error: 'uebergabeVon ist keine gültige Session-Kennung' },
      { status: 400 }
    )
  }
  const uebergabeVon = uebergabeRoh

  if (!prompt) return NextResponse.json({ error: 'Prompt fehlt' }, { status: 400 })
  // Der Pfad wird cwd eines Claude-Prozesses: nur konfigurierte Wurzeln.
  if (!project || !path.isAbsolute(project) || !isWithinProjectRoots(project)) {
    return NextResponse.json(
      { error: 'Projektordner liegt außerhalb der konfigurierten Projektwurzeln' },
      { status: 400 }
    )
  }
  try {
    const stat = await fs.stat(project)
    if (!stat.isDirectory()) throw new Error('kein Verzeichnis')
  } catch {
    return NextResponse.json({ error: `Projektordner nicht gefunden: ${project}` }, { status: 400 })
  }

  const state = await startSession({
    project,
    model,
    mode,
    effort,
    roles,
    prompt,
    skipPermissions,
    worktree,
    uebergabeVon,
  })
  if (state.status === 'fehler') {
    const fehler = state.log
      .filter((l) => l.kind === 'error')
      .map((l) => l.text)
      .join(' · ')
    return NextResponse.json(
      { error: fehler || 'Start fehlgeschlagen', session: state },
      { status: 500 }
    )
  }
  return NextResponse.json({ session: state })
}
