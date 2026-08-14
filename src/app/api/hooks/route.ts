import { NextResponse } from 'next/server'
import { rejectCrossOrigin } from '@/lib/http'
import { readHooks, writeHooks } from '@/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(await readHooks())
}

export async function PUT(req: Request) {
  const blocked = rejectCrossOrigin(req)
  if (blocked) return blocked

  const body = await req.json().catch(() => ({}))
  const result = await writeHooks(String(body.raw ?? ''))
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(await readHooks())
}
