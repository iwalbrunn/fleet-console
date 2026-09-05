import { readQuota } from '@/lib/quota'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET() {
  return Response.json({ quota: await readQuota() }, { headers: { 'Cache-Control': 'no-store' } })
}
