import { NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import { rejectCrossOrigin } from '@/lib/http'
import { listSessions, startSession } from '@/lib/sessions'

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
  const model = String(body.model ?? 'sonnet')
  const roles: string[] = Array.isArray(body.roles) ? body.roles.map(String) : []
  const skipPermissions = Boolean(body.skipPermissions)

  if (!prompt) return NextResponse.json({ error: 'Prompt fehlt' }, { status: 400 })
  try {
    const stat = await fs.stat(project)
    if (!stat.isDirectory()) throw new Error('kein Verzeichnis')
  } catch {
    return NextResponse.json({ error: `Projektordner nicht gefunden: ${project}` }, { status: 400 })
  }

  const state = startSession({ project, model, roles, prompt, skipPermissions })
  return NextResponse.json({ session: state })
}
