import { NextResponse } from 'next/server'
import { EFFORT_LEVELS, MODELS, PIPELINE_MODEL, ROLE_TIMEOUT_SEC } from '@/lib/config'
import { listProjects, listRoles, projectContext } from '@/lib/settings'
import { listSessions, PRUEFAUFTRAG } from '@/lib/sessions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const projects = await listProjects()
  const requested = new URL(req.url).searchParams.get('project')
  const project =
    requested && projects.some((entry) => entry.paths.includes(requested)) ? requested : undefined
  const [roles, sessions, intelligence] = await Promise.all([
    listRoles(project),
    listSessions(),
    project ? projectContext(project) : null,
  ])
  return NextResponse.json({
    projects,
    roles,
    models: MODELS,
    efforts: EFFORT_LEVELS,
    projectContext: intelligence,
    sessions: sessions.slice(0, 20),
    pipeline: {
      standardAuftrag: PRUEFAUFTRAG,
      standardModell: PIPELINE_MODEL,
      timeoutSec: ROLE_TIMEOUT_SEC,
    },
  })
}
