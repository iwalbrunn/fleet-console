import { createHash } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import fs from 'node:fs/promises'
import { promisify } from 'node:util'
import { VERIFY_CHECKS, VERIFY_TIMEOUT_SEC } from './config'
import { collectWorkingState, runRoleProcess } from './review-pipeline'
import { VERDICT_SCHEMA, verdictAlsText, verdictKurz } from './review-verdict'
import { emit, node, now, push, registry, setNode, writeRoleReport } from './session-runtime'
import { worktreeManager } from './session-worktrees'
import type { CheckResult, RollenVerdict, VerificationState } from './types'

const execFile = promisify(execFileCallback)

export function assessRisk(
  paths: string[]
): Pick<VerificationState, 'risk' | 'reasons' | 'focuses'> {
  const reasons: string[] = []
  const focuses = new Set<string>(['Anforderungserfüllung', 'Regressionen'])
  let score = paths.length > 12 ? 2 : paths.length > 4 ? 1 : 0
  if (paths.some((p) => /(^|\/)(auth|security|permissions?|api|middleware|proxy)/i.test(p))) {
    score += 2
    reasons.push('Sicherheits- oder API-relevante Dateien geändert')
    focuses.add('Security und Berechtigungen')
  }
  if (paths.some((p) => /(migration|schema|database|storage|session)/i.test(p))) {
    score += 2
    reasons.push('Persistenz oder Datenmodell geändert')
    focuses.add('Datenintegrität und Migration')
  }
  if (paths.some((p) => /\.(tsx|jsx|css|scss|vue|svelte|html)$/i.test(p))) {
    score += 1
    reasons.push('Benutzeroberfläche geändert')
    focuses.add('UX, Accessibility und visuelle Regressionen')
  }
  if (paths.some((p) => /(package-lock|package\.json|Dockerfile|workflow|\.github)/i.test(p))) {
    score += 1
    reasons.push('Abhängigkeiten oder Build-Infrastruktur geändert')
    focuses.add('Supply Chain und Build-Reproduzierbarkeit')
  }
  if (paths.length > 12) reasons.push(`Großer Änderungsumfang (${paths.length} Dateien)`)
  if (!reasons.length) reasons.push('Kleiner, lokal begrenzter Änderungsstand')
  return {
    risk: score >= 3 ? 'high' : score >= 1 ? 'medium' : 'low',
    reasons,
    focuses: [...focuses],
  }
}

/** Billige Empfehlung für Direkt-/Parallel-Sessions: nur Diff-Hash und
 * Dateimuster, noch keine Befehle und kein Modell. */
export async function recommendVerification(id: string): Promise<void> {
  const session = registry.get(id)
  if (!session || session.pipelineLaeuft) return
  const stand = await collectWorkingState(worktreeManager.workingDirectory(session.state))
  if (!stand?.text) return
  const fingerprint = createHash('sha256').update(stand.text).digest('hex')
  if (
    session.state.verification?.fingerprint === fingerprint &&
    session.state.verification.status !== 'idle'
  )
    return
  session.state.verification = {
    status: 'idle',
    ...assessRisk(stand.pfade),
    checks: [],
    fingerprint,
    updatedAt: now(),
  }
  emit(session, 'state', session.state)
  await session.persist()
}

async function packageScripts(project: string): Promise<Record<string, string>> {
  try {
    const pkg = JSON.parse(await fs.readFile(`${project}/package.json`, 'utf8'))
    return pkg?.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {}
  } catch {
    return {}
  }
}

async function runChecks(project: string): Promise<CheckResult[]> {
  const scripts = await packageScripts(project)
  const results: CheckResult[] = []
  for (const name of VERIFY_CHECKS) {
    if (typeof scripts[name] !== 'string') continue
    const started = Date.now()
    try {
      const { stdout, stderr } = await execFile('npm', ['run', name], {
        cwd: project,
        timeout: VERIFY_TIMEOUT_SEC * 1000,
        maxBuffer: 8 * 1024 * 1024,
      })
      results.push({
        name,
        command: `npm run ${name}`,
        status: 'passed',
        durationMs: Date.now() - started,
        output: `${stdout}\n${stderr}`.trim().slice(-4000),
      })
    } catch (error) {
      const value = error as { stdout?: string; stderr?: string; message?: string }
      results.push({
        name,
        command: `npm run ${name}`,
        status: 'failed',
        durationMs: Date.now() - started,
        output: `${value.stdout ?? ''}\n${value.stderr ?? ''}\n${value.message ?? ''}`
          .trim()
          .slice(-4000),
      })
      break
    }
  }
  return results
}

export async function runVerification(
  id: string,
  force = false
): Promise<{ ok: boolean; error?: string }> {
  const session = registry.get(id)
  if (!session) return { ok: false, error: 'Session unbekannt' }
  if (session.pipelineLaeuft) return { ok: false, error: 'Es läuft bereits eine Verifikation' }
  if (session.rundeAktiv)
    return {
      ok: false,
      error: 'Die Hauptsession arbeitet noch — Verifikation erst nach dem Ergebnis starten.',
    }
  session.state.verification ??= {
    status: 'idle',
    risk: 'low',
    reasons: [],
    focuses: [],
    checks: [],
    fingerprint: null,
    updatedAt: null,
  }

  const project = worktreeManager.workingDirectory(session.state)
  const stand = await collectWorkingState(project)
  if (!stand?.text) {
    session.state.verification = {
      status: 'skipped',
      risk: 'low',
      reasons: ['Keine uncommitteten Änderungen'],
      focuses: [],
      checks: [],
      fingerprint: null,
      updatedAt: now(),
    }
    emit(session, 'state', session.state)
    return { ok: false, error: 'Keine uncommitteten Änderungen — nichts zu verifizieren.' }
  }
  const fingerprint = createHash('sha256').update(stand.text).digest('hex')
  if (
    !force &&
    session.state.verification.fingerprint === fingerprint &&
    ['passed', 'findings'].includes(session.state.verification.status)
  ) {
    return { ok: true }
  }

  const assessment = assessRisk(stand.pfade)
  session.pipelineLaeuft = true
  session.state.pipelineAktiv = true
  session.state.pipelineRollen = ['change-verifier']
  session.state.verification = {
    status: 'checking',
    ...assessment,
    checks: [],
    fingerprint,
    updatedAt: now(),
  }
  const verifier = node(session, 'change-verifier')
  setNode(session, 'change-verifier', {
    status: 'running',
    phase: 'deterministische Prüfungen',
    calls: verifier.calls + 1,
    order: verifier.order ?? ++session.orderCounter,
    quelle: 'rollenlauf',
    startedAt: now(),
    endedAt: null,
  })
  push(session, {
    agent: 'system',
    kind: 'system',
    text: `Verifikation gestartet · Risiko ${assessment.risk} · Checks vor Modellreview`,
  })
  emit(session, 'state', session.state)

  try {
    const checks = await runChecks(project)
    session.state.verification.checks = checks
    for (const check of checks) {
      push(session, {
        agent: 'check',
        kind: check.status === 'passed' ? 'system' : 'error',
        text: `${check.command}: ${check.status === 'passed' ? 'bestanden' : 'fehlgeschlagen'} (${Math.round(check.durationMs / 1000)}s)`,
      })
    }
    session.state.verification.status = 'reviewing'
    setNode(session, 'change-verifier', { phase: 'unabhängige Modellprüfung' })

    const checkText = checks.length
      ? checks
          .map((c) => `- ${c.command}: ${c.status}\n${c.status === 'failed' ? c.output : ''}`)
          .join('\n')
      : '- Keine konfigurierten Checks gefunden.'
    const requirements = session.state.anforderungen
      .map((entry) => `- [${entry.status}] ${entry.text}`)
      .join('\n')
    const task = [
      'Prüfe den abgeschlossenen Arbeitsstand unabhängig gegen die Anforderungen.',
      `Risikostufe: ${assessment.risk}. Fokus: ${assessment.focuses.join(', ')}.`,
      'Melde nur konkrete Befunde ab Schweregrad mittel. Nimm keine Änderungen vor.',
      `\n## Anforderungen\n${requirements || '- Keine externe Liste vorhanden.'}`,
      `\n## Deterministische Prüfevidenz\n${checkText}`,
      `\n## Arbeitsstand\n${stand.text}`,
    ].join('\n')
    const result = await runRoleProcess(session, 'change-verifier', 'sonnet', task, VERDICT_SCHEMA)
    const verdict = result.struktur as RollenVerdict | null
    const text = verdict ? verdictAlsText(verdict) : result.text
    const hasFindings = Boolean(verdict?.befunde.some((finding) => finding.status !== 'behoben'))
    const checkFailed = checks.some((check) => check.status === 'failed')
    session.state.verification.status =
      result.status !== 'done' ? 'failed' : hasFindings || checkFailed ? 'findings' : 'passed'
    session.state.verification.updatedAt = now()
    setNode(session, 'change-verifier', {
      status: result.status === 'done' ? 'done' : result.status,
      phase: session.state.verification.status === 'passed' ? 'bestanden' : 'Befunde',
      ergebnis: verdict ? verdictKurz(verdict) : text.slice(0, 300),
      volltext: text,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      anfragen: result.anfragen,
      kostenUsd: result.kostenUsd,
      befunde: verdict?.befunde ?? null,
      endedAt: now(),
    })
    session.state.tokensIn += result.tokensIn
    session.state.tokensOut += result.tokensOut
    session.state.anfragen += result.anfragen
    session.state.kostenUsd += result.kostenUsd
    session.kostenBasisUsd += result.kostenUsd
    if (text.trim()) {
      await writeRoleReport(session, 'change-verifier', text)
      const answer = { t: now(), text: `## Verifikation\n\n${text}` }
      session.state.antworten.push(answer)
      emit(session, 'antwort', answer)
    }
    push(session, {
      agent: 'system',
      kind: session.state.verification.status === 'passed' ? 'result' : 'error',
      text:
        session.state.verification.status === 'passed'
          ? 'Verifikation bestanden'
          : 'Verifikation mit Befunden beendet',
    })
    return { ok: true }
  } catch (error) {
    session.state.verification.status = 'failed'
    session.state.verification.updatedAt = now()
    setNode(session, 'change-verifier', {
      status: 'error',
      phase: 'Verifikation fehlgeschlagen',
      endedAt: now(),
    })
    push(session, {
      agent: 'system',
      kind: 'error',
      text: `Verifikation fehlgeschlagen: ${String(error).slice(0, 240)}`,
    })
    return { ok: false, error: String(error) }
  } finally {
    session.pipelineLaeuft = false
    session.state.pipelineAktiv = false
    session.state.pipelineRollen = []
    emit(session, 'state', session.state)
    await session.persist()
  }
}
