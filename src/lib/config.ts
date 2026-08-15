import os from 'node:os'
import path from 'node:path'

export const HOME = os.homedir()
export const CLAUDE_DIR = path.join(HOME, '.claude')
export const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects')
export const AGENTS_DIR = path.join(CLAUDE_DIR, 'agents')
export const SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json')

/** Eigener Ablageort der Konsole (Run-Metadaten, Berichte). */
export const FLEET_DIR = path.join(CLAUDE_DIR, 'fleet-console')
export const RUNS_DIR = path.join(FLEET_DIR, 'runs')
export const REPORTS_DIR = path.join(FLEET_DIR, 'reports')
/** Anforderungslisten — bewusst NICHT unter runs/: auf diese Dateien wird
 *  das Modell per Systemprompt zum Schreiben eingeladen, und es soll dabei
 *  nicht neben den Session-Zuständen arbeiten. */
export const ANFORDERUNGEN_DIR = path.join(FLEET_DIR, 'anforderungen')
/** Isolierte Arbeitskopien. Bewusst AUSSERHALB von ~/.claude: der Worktree
 *  wird cwd einer (ggf. permissiven) Session — er hat nichts neben
 *  settings.json, agents/ und den Hooks verloren. */
export const WORKTREES_DIR = path.join(HOME, '.fleet-console', 'worktrees')

/** Wo die Konsole nach Projekten sucht. */
export const PROJECT_ROOTS = (process.env.FLEET_PROJECT_ROOTS ?? path.join(HOME, 'Developer'))
  .split(':')
  .map((p) => p.replace(/^~/, HOME))
  .filter(Boolean)

/** Ziel für Nachtläufe. Kein Standardwert im Code — der Host gehört in die
 *  `.env.local`, nicht ins Repo. Ohne Angabe bleibt der Bereich aus. */
export const VPS_HOST = process.env.FLEET_VPS_HOST ?? ''
export const VPS_ENABLED = process.env.FLEET_VPS_ENABLED !== 'false' && Boolean(VPS_HOST)

/** Der Pfad zur Claude-CLI (falls sie nicht im PATH des Servers liegt). */
export const CLAUDE_BIN = process.env.FLEET_CLAUDE_BIN ?? 'claude'

/** Kontextfenster, ab dem verdichtet wird. Kleiner = günstigere Anfragen in
 *  langen Sitzungen, weil weniger Kontext bei jedem Aufruf mitgeht. */
export const AUTOCOMPACT = process.env.FLEET_AUTOCOMPACT ?? '200000'

/** Modell für die Prüfrollen der Pipeline. Bewusst nicht Opus: die Rollen
 *  arbeiten auf einem Diff, nicht auf der ganzen Codebasis. */
export const PIPELINE_MODEL = process.env.FLEET_PIPELINE_MODEL ?? 'sonnet'

/** Wie viele Rollen eines Rollenlaufs gleichzeitig arbeiten. Prüfrollen sind
 *  voneinander unabhängig, nacheinander wäre nur langsamer. Die Grenze
 *  existiert wegen des Kontingents, nicht wegen der Logik. */
export const PIPELINE_PARALLEL = Math.max(1, Number(process.env.FLEET_PIPELINE_PARALLEL ?? 3))

/** Zeitgrenze je Rolle in Sekunden. 0 schaltet sie ab. Gilt nur für
 *  Rollenläufe — die Hauptsession wartet absichtlich unbegrenzt auf Eingaben. */
export const ROLE_TIMEOUT_SEC = Math.max(0, Number(process.env.FLEET_ROLE_TIMEOUT_SEC ?? 900))

/** Frist zwischen SIGTERM und SIGKILL, in Sekunden. */
export const GRACE_SEC = Math.max(1, Number(process.env.FLEET_GRACE_SEC ?? 10))

/** Obergrenze für den Arbeitsstand, der einem Rollenlauf mitgegeben wird.
 *  Darüber wird gekürzt und die Rolle liest bei Bedarf selbst nach. */
export const DIFF_MAX = Math.max(2000, Number(process.env.FLEET_DIFF_MAX ?? 60000))

export const MODELS = [
  { id: 'fable', label: 'Fable' },
  { id: 'opus', label: 'Opus' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' },
] as const

// Der Ordnername unter ~/.claude/projects ist der Pfad mit / → -, das lässt
// sich nicht eindeutig zurückrechnen (echte Ordner enthalten Bindestriche).
// Der Projektpfad kommt deshalb immer aus dem Feld `cwd` im Transcript.

export function shortProjectName(cwd: string): string {
  return cwd.replace(HOME, '~')
}
