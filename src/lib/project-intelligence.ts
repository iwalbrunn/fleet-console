import fs from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import type { ProjectIntelligence } from './types'

async function exists(file: string): Promise<boolean> {
  try {
    await fs.stat(file)
    return true
  } catch {
    return false
  }
}

async function filesBelow(directory: string, extension?: string): Promise<string[]> {
  const found: string[] = []
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
      else if (!extension || entry.name.endsWith(extension)) found.push(full)
    }
  }
  await walk(directory)
  return found.sort()
}

const relative = (project: string, files: string[]) =>
  files.map((file) => path.relative(project, file) || path.basename(file))

/** Ermittelt nur Konfiguration, die für die Qualität einer Claude-Session
 * relevant ist. Kein Quellcode-Index und kein Modellaufruf. */
export async function inspectProject(project: string): Promise<ProjectIntelligence> {
  const claudeMd = (
    await Promise.all(
      ['CLAUDE.md', path.join('.claude', 'CLAUDE.md')].map(async (file) =>
        (await exists(path.join(/* turbopackIgnore: true */ project, file))) ? file : null
      )
    )
  ).filter((file): file is string => Boolean(file))

  const settings = (
    await Promise.all(
      [path.join('.claude', 'settings.json'), path.join('.claude', 'settings.local.json')].map(
        async (file) =>
          (await exists(path.join(/* turbopackIgnore: true */ project, file))) ? file : null
      )
    )
  ).filter((file): file is string => Boolean(file))

  const [agentFiles, skillFiles, workflowFiles] = await Promise.all([
    filesBelow(path.join(project, '.claude', 'agents'), '.md'),
    filesBelow(path.join(project, '.claude', 'skills'), 'SKILL.md'),
    filesBelow(path.join(project, '.claude', 'workflows'), '.js'),
  ])

  const checks: string[] = []
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'))
    for (const name of ['typecheck', 'test', 'lint', 'build']) {
      if (typeof pkg?.scripts?.[name] === 'string') checks.push(`npm run ${name}`)
    }
  } catch {
    /* Kein Node-Projekt. Weitere Ökosysteme werden später über Adapter ergänzt. */
  }

  const warnings: string[] = []
  if (!claudeMd.length) warnings.push('CLAUDE.md fehlt')
  if (!checks.length) warnings.push('Keine bekannten deterministischen Prüfungen gefunden')

  return {
    claudeMd,
    settings,
    agents: relative(project, agentFiles),
    skills: relative(project, skillFiles),
    workflows: relative(project, workflowFiles),
    checks,
    warnings,
  }
}
