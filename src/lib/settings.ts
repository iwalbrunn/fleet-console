import { execFile as execFileCb } from 'node:child_process'
import fs from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { AGENTS_DIR, PROJECT_ROOTS, shortProjectName } from './config'
import { inspectProject } from './project-intelligence'

export interface Role {
  name: string
  description: string
  model: string | null
  tools: string[]
  file: string
  scope?: 'project' | 'user'
  effort?: string | null
  maxTurns?: number | null
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

function frontmatter(raw: string): Record<string, string | string[]> {
  const m = raw.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return {}
  const out: Record<string, string | string[]> = {}
  let listKey: string | null = null
  for (const line of m[1].split('\n')) {
    const listItem = line.match(/^\s+-\s+(.+)$/)
    if (listItem && listKey) {
      const current = out[listKey]
      out[listKey] = [...(Array.isArray(current) ? current : []), listItem[1].trim()]
      continue
    }
    const i = line.indexOf(':')
    if (i < 1 || /^\s/.test(line)) continue
    const key = line.slice(0, i).trim()
    const rawValue = line.slice(i + 1).trim()
    if (!rawValue) {
      out[key] = []
      listKey = key
      continue
    }
    listKey = null
    const value = rawValue.trim().replace(/^["']|["']$/g, '')
    out[key] =
      value.startsWith('[') && value.endsWith(']')
        ? value
            .slice(1, -1)
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
        : value
  }
  return out
}

async function roleFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  const walk = async (current: string) => {
    let entries: Dirent[]
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.name.endsWith('.md')) files.push(full)
    }
  }
  await walk(directory)
  return files
}

async function readRoles(directory: string, scope: 'project' | 'user'): Promise<Role[]> {
  const roles: Role[] = []
  for (const file of await roleFiles(directory)) {
    try {
      const fm = frontmatter(await fs.readFile(file, 'utf8'))
      const scalar = (key: string) => (typeof fm[key] === 'string' ? (fm[key] as string) : '')
      const list = (key: string) => {
        const value = fm[key]
        return Array.isArray(value)
          ? value
          : typeof value === 'string'
            ? value
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean)
            : []
      }
      roles.push({
        name: scalar('name') || path.basename(file, '.md'),
        description: scalar('description'),
        model: scalar('model') || null,
        tools: list('tools'),
        file,
        scope,
        effort: scalar('effort') || null,
        maxTurns: Number(scalar('maxTurns')) || null,
      })
    } catch {
      /* unlesbare Rolle überspringen */
    }
  }
  return roles
}

/** Projektrollen haben dieselbe Priorität wie in Claude Code selbst: sie
 * überschreiben gleichnamige persönliche Rollen. */
export async function listRoles(project?: string): Promise<Role[]> {
  const user = await readRoles(AGENTS_DIR, 'user')
  const local = project ? await readRoles(path.join(project, '.claude', 'agents'), 'project') : []
  const byName = new Map(user.map((role) => [role.name, role]))
  for (const role of local) byName.set(role.name, role)
  const roles = [...byName.values()]
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
    const { stdout } = await execFile('git', ['-C', dir, 'remote', 'get-url', 'origin'], {
      timeout: 4000,
    })
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
    })
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

export async function projectContext(project: string) {
  return inspectProject(project)
}
