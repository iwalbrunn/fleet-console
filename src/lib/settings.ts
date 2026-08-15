import { execFile as execFileCb } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { AGENTS_DIR, PROJECT_ROOTS, shortProjectName } from './config'

export interface Role {
  name: string
  description: string
  model: string | null
  tools: string[]
  file: string
}

const ICONS: Record<string, string> = {
  'security-reviewer': 'ph-shield-check',
  'senior-developer': 'ph-code',
  'project-manager': 'ph-kanban',
  'business-analyst': 'ph-clipboard-text',
  'ux-ui-expert': 'ph-layout',
}

const execFile = promisify(execFileCb)

export function iconForRole(name: string): string {
  return ICONS[name] ?? 'ph-robot'
}

function frontmatter(raw: string): Record<string, string> {
  const m = raw.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return {}
  const out: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i < 1 || /^\s/.test(line)) continue
    out[line.slice(0, i).trim()] = line
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
  }
  return out
}

export async function listRoles(): Promise<Role[]> {
  let files: string[]
  try {
    files = (await fs.readdir(AGENTS_DIR)).filter((f) => f.endsWith('.md'))
  } catch {
    return []
  }
  const roles: Role[] = []
  for (const f of files) {
    const file = path.join(AGENTS_DIR, f)
    try {
      const fm = frontmatter(await fs.readFile(file, 'utf8'))
      roles.push({
        name: fm.name || path.basename(f, '.md'),
        description: fm.description ?? '',
        model: fm.model ?? null,
        tools: (fm.tools ?? '').split(',').map((t) => t.trim()).filter(Boolean),
        file,
      })
    } catch {
      /* unlesbare Rolle überspringen */
    }
  }
  return roles.sort((a, b) => a.name.localeCompare(b.name))
}

export interface ProjectEntry {
  /** Stabile Kennung: das Repo, sonst der Pfad. */
  id: string
  /** `owner/name` beim Repo, sonst der Ordnername. */
  label: string
  repo: string | null
  /** Alle Arbeitskopien dieses Repos auf diesem Rechner. */
  paths: string[]
  /** Die vorgeschlagene Arbeitskopie (die erste). */
  path: string
  git: boolean
}

const isGit = (dir: string) =>
  fs
    .stat(path.join(dir, '.git'))
    .then(() => true)
    .catch(() => false)

/** `owner/name` aus einer Remote-URL (https oder ssh), sonst null. */
export function parseRemote(url: string): string | null {
  const m = url
    .trim()
    .replace(/\.git$/, '')
    .match(/(?:github\.com[:/])([^/]+\/[^/]+)$/)
  return m ? m[1] : null
}

async function originOf(dir: string): Promise<string | null> {
  try {
    const { stdout } = await execFile('git', ['-C', dir, 'remote', 'get-url', 'origin'], { timeout: 4000 })
    return parseRemote(stdout)
  } catch {
    return null
  }
}

export async function listProjects(): Promise<ProjectEntry[]> {
  const dirs: string[] = []

  for (const root of PROJECT_ROOTS) {
    // Ist die Wurzel selbst ein Repo, ist sie das Projekt — sonst enthält sie
    // welche. So lassen sich einzelne Ordner direkt eintragen, ohne dass ihr
    // Elternverzeichnis komplett aufgelistet wird.
    if (await isGit(root)) {
      dirs.push(root)
      continue
    }
    let entries: string[]
    try {
      entries = await fs.readdir(root)
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.startsWith('.')) continue
      const full = path.join(root, e)
      try {
        if ((await fs.stat(full)).isDirectory()) dirs.push(full)
      } catch {
        /* überspringen */
      }
    }
  }

  const unique = [...new Set(dirs)]
  const scanned = await Promise.all(
    unique.map(async (dir) => {
      const git = await isGit(dir)
      return { dir, git, repo: git ? await originOf(dir) : null }
    }),
  )

  // Nach Repo bündeln: zwei Arbeitskopien desselben Repos sind ein Projekt.
  const byId = new Map<string, ProjectEntry>()
  for (const { dir, git, repo } of scanned) {
    const id = repo ?? dir
    const existing = byId.get(id)
    if (existing) {
      existing.paths.push(dir)
      continue
    }
    byId.set(id, {
      id,
      label: repo ?? shortProjectName(dir),
      repo,
      paths: [dir],
      path: dir,
      git,
    })
  }

  return [...byId.values()]
    .map((p) => ({ ...p, paths: p.paths.sort(), path: p.paths.sort()[0] }))
    .sort((a, b) => {
      // Repos zuerst, lokale Ordner danach
      if (Boolean(a.repo) !== Boolean(b.repo)) return a.repo ? -1 : 1
      return a.label.localeCompare(b.label)
    })
}
