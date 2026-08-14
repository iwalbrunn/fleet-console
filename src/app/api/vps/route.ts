import { NextResponse } from 'next/server'
import { rejectCrossOrigin } from '@/lib/http'
import { getVpsStatus, nightRunTemplate, saveNightRuns } from '@/lib/vps'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const status = await getVpsStatus()
  return NextResponse.json({ ...status, template: nightRunTemplate() })
}

export async function PUT(req: Request) {
  const blocked = rejectCrossOrigin(req)
  if (blocked) return blocked

  const body = await req.json().catch(() => ({}))
  if (!Array.isArray(body.runs)) {
    return NextResponse.json({ error: 'Erwartet { runs: [...] }' }, { status: 400 })
  }
  try {
    await saveNightRuns(
      body.runs.map((r: any) => ({
        name: String(r.name ?? ''),
        schedule: String(r.schedule ?? ''),
        command: String(r.command ?? ''),
      })),
    )
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 400 })
  }
  const status = await getVpsStatus()
  return NextResponse.json({ ...status, template: nightRunTemplate() })
}
