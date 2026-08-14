import { NextResponse } from 'next/server'
import { rejectCrossOrigin } from '@/lib/http'
import { reconfigureSession, resumeSession, runPipeline, sendMessage, stopSession } from '@/lib/sessions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = rejectCrossOrigin(req)
  if (blocked) return blocked

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  if (body.action === 'stop') {
    return NextResponse.json({ ok: stopSession(id) })
  }

  // Rollenlauf: die Rollen laufen als eigene Sessions, unabhängig davon, ob
  // der Orchestrator delegieren will. Die Antwort kommt sofort, der Lauf
  // meldet sich über den Ereignisstrom.
  if (body.action === 'pipeline') {
    const rollen: string[] = Array.isArray(body.roles) ? body.roles.map(String).filter(Boolean) : []
    if (!rollen.length) return NextResponse.json({ error: 'Keine Rolle gewählt' }, { status: 400 })
    const lauf = runPipeline(id, rollen, {
      model: typeof body.model === 'string' ? body.model : undefined,
      auftrag: typeof body.auftrag === 'string' ? body.auftrag : undefined,
      stand: body.stand === false ? false : undefined,
    })
    // Nur den sofortigen Ablehnungsgrund abwarten, nicht den ganzen Lauf.
    // Das Ermitteln des Arbeitsstands braucht kurz, deshalb nicht zu knapp.
    const res = await Promise.race([
      lauf,
      new Promise<{ ok: true }>((r) => setTimeout(() => r({ ok: true }), 2500)),
    ])
    void lauf.catch(() => {})
    if (!res.ok) return NextResponse.json({ error: (res as { error?: string }).error }, { status: 409 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'resume') {
    const res = await resumeSession(id)
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 409 })
    return NextResponse.json({ ok: true, session: res.state })
  }

  if (body.action === 'reconfigure') {
    const res = await reconfigureSession(id, {
      model: typeof body.model === 'string' ? body.model : undefined,
      skipPermissions: typeof body.skipPermissions === 'boolean' ? body.skipPermissions : undefined,
    })
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 409 })
    return NextResponse.json({ ok: true })
  }

  const text = String(body.text ?? '').trim()
  if (!text) return NextResponse.json({ error: 'Nachricht ist leer' }, { status: 400 })
  const ok = sendMessage(id, text)
  if (!ok) return NextResponse.json({ error: 'Session nimmt keine Eingaben mehr an' }, { status: 409 })
  return NextResponse.json({ ok })
}
