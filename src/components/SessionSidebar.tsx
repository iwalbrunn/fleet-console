'use client'

import { useTranslations } from 'next-intl'
import {
  type ExecutionMode,
  type ProjectEntry,
  type ProjectIntelligence,
  type Role,
  type SessionState,
} from '@/lib/types'
import { ROLE_ICONS } from '@/lib/roleIcons'

function SwitchRow({
  on,
  label,
  note,
  mono,
  onToggle,
}: {
  on: boolean
  label: string
  note: string
  mono?: boolean
  onToggle: () => void
}) {
  return (
    <button className="switchrow" onClick={onToggle}>
      <div>
        <div style={{ fontSize: 13 }}>{label}</div>
        <div
          className={mono ? 'mono' : undefined}
          style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}
        >
          {note}
        </div>
      </div>
      <div className="switch" data-on={on}>
        <span />
      </div>
    </button>
  )
}

/** Linke Spalte: Projekt, Modell, Rollen und die Start-/Stop-Steuerung.
 *  Aller Zustand lebt in der Seite — hier wird nur gerendert und gemeldet. */
export function SessionSidebar(props: {
  busy?: boolean
  session: SessionState | null
  prozessLebt: boolean
  wartet: boolean
  abweichung: boolean
  error: string | null
  projects: ProjectEntry[]
  projectId: string
  project: string
  onProject: (id: string, path: string) => void
  onWorkingCopy: (path: string) => void
  models: { id: string; label: string }[]
  model: string
  onModel: (id: string) => void
  efforts: { id: string; label: string }[]
  effort: string
  onEffort: (id: string) => void
  mode: ExecutionMode
  onMode: (mode: ExecutionMode) => void
  projectContext: ProjectIntelligence | null
  roles: Role[]
  picked: string[]
  onPicked: (roles: string[]) => void
  prompt: string
  onPrompt: (text: string) => void
  skip: boolean
  onSkip: () => void
  worktree: boolean
  onWorktree: () => void
  cliPreview: string
  onStart: () => void
  onStop: () => void
  onApply: () => void
}) {
  const t = useTranslations()
  const {
    session,
    prozessLebt,
    wartet,
    abweichung,
    error,
    projects,
    projectId,
    project,
    models,
    model,
    efforts,
    effort,
    mode,
    projectContext,
    roles,
    picked,
    prompt,
    skip,
    worktree,
    cliPreview,
  } = props

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="kicker">
        {prozessLebt ? t('sidebar.runningSession') : t('sidebar.newSession')}
      </div>

      {/* Der Projektordner steht im Prozessaufruf und lässt sich nicht
          mehr ändern. Eine bedienbare Auswahl würde das Gegenteil
          behaupten — also steht hier nur noch, was gilt. */}
      {prozessLebt ? (
        <div className="field">
          <label>{t('sidebar.projectFixed')}</label>
          <div
            className="input"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              color: 'var(--color-neutral-400)',
              cursor: 'default',
            }}
          >
            <i className="ph ph-lock-simple" style={{ fontSize: 13, flex: 'none' }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {projects.find((p) => p.paths.includes(session?.project ?? ''))?.label ??
                (session?.project ?? '').split('/').slice(-1)[0]}
            </span>
          </div>
          <div
            className="mono"
            style={{
              fontSize: 11,
              color: 'var(--color-neutral-600)',
              marginTop: 4,
              wordBreak: 'break-all',
            }}
          >
            {(session?.project ?? '').replace(/^\/Users\/[^/]+/, '~')}
          </div>
        </div>
      ) : (
        <div className="field">
          <label>{t('project.title')}</label>
          <select
            className="input"
            value={projectId}
            onChange={(e) => {
              const entry = projects.find((p) => p.id === e.target.value)
              props.onProject(e.target.value, entry?.path ?? project)
            }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {p.repo ? '' : p.git ? t('sidebar.noRemote') : t('sidebar.localOnly')}
              </option>
            ))}
          </select>

          {(() => {
            const entry = projects.find((p) => p.id === projectId)
            if (!entry) return null
            if (entry.paths.length > 1) {
              return (
                <>
                  <select
                    className="input mono"
                    style={{ fontSize: 11, marginTop: 6 }}
                    value={project}
                    onChange={(e) => props.onWorkingCopy(e.target.value)}
                  >
                    {entry.paths.map((p) => (
                      <option key={p} value={p}>
                        {p.replace(/^\/Users\/[^/]+/, '~')}
                      </option>
                    ))}
                  </select>
                  <div style={{ fontSize: 11, color: 'var(--color-warn)', marginTop: 4 }}>
                    {t('sidebar.workingCopies', { count: entry.paths.length })}
                  </div>
                </>
              )
            }
            return (
              <div
                className="mono"
                style={{
                  fontSize: 11,
                  color: 'var(--color-neutral-600)',
                  marginTop: 4,
                  wordBreak: 'break-all',
                }}
              >
                {entry.path.replace(/^\/Users\/[^/]+/, '~')}
              </div>
            )
          })()}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>
          {t('model.title')}
          {prozessLebt && (
            <span style={{ color: 'var(--color-neutral-600)' }}> {t('sidebar.modelNote')}</span>
          )}
        </div>
        <div className="seg">
          {models.map((m) => (
            <label key={m.id} className="seg-opt">
              <input
                type="radio"
                name="modell"
                checked={model === m.id}
                onChange={() => props.onModel(m.id)}
                style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
              />
              {m.label}
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{t('mode.title')}</div>
        <div className="seg">
          {(['direct', 'verified', 'parallel'] as ExecutionMode[]).map((value) => (
            <label key={value} className="seg-opt" title={t(`mode.${value}Note`)}>
              <input
                type="radio"
                name="mode"
                checked={(prozessLebt ? session?.mode : mode) === value}
                disabled={prozessLebt}
                onChange={() => props.onMode(value)}
                style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
              />
              {t(`mode.${value}`)}
            </label>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-neutral-500)', lineHeight: 1.45 }}>
          {t(`mode.${(prozessLebt ? session?.mode : mode) ?? 'direct'}Note`)}
        </div>
      </div>

      <div className="field">
        <label>
          {t('effort.title')}
          {prozessLebt && (
            <span style={{ color: 'var(--color-neutral-600)' }}> {t('sidebar.modelNote')}</span>
          )}
        </label>
        <select
          className="input"
          value={mode === 'parallel' ? 'ultracode' : effort}
          disabled={!prozessLebt && mode === 'parallel'}
          onChange={(e) => props.onEffort(e.target.value)}
        >
          {mode === 'parallel' && <option value="ultracode">Ultracode · automatisch</option>}
          {efforts.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      {projectContext && (
        <div className="codebox" style={{ fontFamily: 'var(--font-body)', lineHeight: 1.55 }}>
          <div style={{ color: 'var(--color-neutral-300)', marginBottom: 3 }}>
            {t('projectContext.title')}
          </div>
          <div>
            CLAUDE.md: {projectContext.claudeMd.length ? '✓' : '—'} · Agents:{' '}
            {projectContext.agents.length} · Skills: {projectContext.skills.length}
          </div>
          <div>
            Workflows: {projectContext.workflows.length} · Checks: {projectContext.checks.length}
          </div>
          {projectContext.warnings.map((warning) => (
            <div key={warning} style={{ color: 'var(--color-warn)' }}>
              ! {warning}
            </div>
          ))}
        </div>
      )}

      <details>
        <summary
          style={{
            fontSize: 12,
            color: 'var(--color-neutral-400)',
            cursor: 'pointer',
            marginBottom: 5,
          }}
        >
          {t('sidebar.rolesTitle')} · {picked.length}
        </summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {roles.length === 0 && (
            <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
              {t('roles.noRolesFound')}
            </div>
          )}
          {roles.map((r) => {
            const on = picked.includes(r.name)
            const imLauf = Boolean(session && prozessLebt && session.roles.includes(r.name))
            // Während eine Session läuft, ist die Liste reiner Zustand: was
            // die Session mitbekommen hat, steht fest — Delegation steuert
            // der Orchestrator bzw. der Rollenlauf, kein Klick von außen.
            return (
              <button
                key={r.name}
                className="rolerow"
                disabled={prozessLebt}
                style={
                  prozessLebt ? { cursor: 'default', opacity: imLauf ? 0.85 : 0.5 } : undefined
                }
                title={imLauf ? t('sidebar.roleLocked', { role: r.name }) : r.description}
                onClick={() => {
                  if (prozessLebt) return
                  props.onPicked(on ? picked.filter((x) => x !== r.name) : [...picked, r.name])
                }}
              >
                <span className="checkbox" data-on={on}>
                  {on && (
                    <i
                      className="ph ph-check"
                      style={{ fontSize: 10, color: 'var(--color-accent)' }}
                    />
                  )}
                </span>
                <i
                  className={`ph ${ROLE_ICONS[r.name] ?? 'ph-robot'}`}
                  style={{ fontSize: 15, color: 'var(--color-neutral-400)' }}
                />
                <span
                  style={{ color: on ? 'var(--color-text)' : 'var(--color-neutral-400)', flex: 1 }}
                >
                  {r.name}
                </span>
                <span style={{ fontSize: 10, color: 'var(--color-neutral-600)' }}>
                  {r.scope === 'project' ? 'project' : 'user'}
                </span>
                {imLauf && (
                  <i
                    className="ph ph-lock-simple"
                    style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}
                  />
                )}
              </button>
            )
          })}
        </div>
      </details>

      {prozessLebt && (
        <div style={{ fontSize: 11, color: 'var(--color-neutral-500)', lineHeight: 1.5 }}>
          {t('sidebar.lockNote')}
        </div>
      )}

      {abweichung && (
        <button className="btn btn-primary btn-block" onClick={props.onApply}>
          <i className="ph ph-arrows-clockwise" />
          {t('sidebar.apply')}
        </button>
      )}

      {/* Das Prompt-Feld gilt nur für den Start. Während eine Session
          läuft, gehen Nachrichten unten rechts hinein — ein zweites
          Eingabefeld, das nichts tut, ist eine Einladung zum Irrtum. */}
      {prozessLebt ? (
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-neutral-500)',
            lineHeight: 1.5,
            border: '1px dashed var(--color-divider)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 10px',
          }}
        >
          <i className="ph ph-arrow-bend-down-right" style={{ marginRight: 5 }} />
          {t('sidebar.messagesHint')}
        </div>
      ) : (
        <div className="field">
          <label>{t('sidebar.promptLabel')}</label>
          <textarea
            className="input"
            value={prompt}
            onChange={(e) => props.onPrompt(e.target.value)}
            placeholder={t('sidebar.promptPlaceholder')}
          />
          <div style={{ fontSize: 11, color: 'var(--color-neutral-500)', lineHeight: 1.5 }}>
            {t('sidebar.promptHint')}
          </div>
        </div>
      )}

      <SwitchRow
        on={skip}
        label={t('session.autoPermissions')}
        note="--dangerously-skip-permissions"
        mono
        onToggle={props.onSkip}
      />
      <SwitchRow
        on={worktree}
        label={t('session.worktree')}
        note={t('session.worktreeNote')}
        mono
        onToggle={props.onWorktree}
      />

      {/* Läuft eine Session, zeigt der Kasten ihren echten Aufruf — nicht
          das, was das Formular gerade eingestellt hat. */}
      <div className="codebox">
        <span style={{ color: 'var(--color-neutral-500)' }}>$ </span>
        {prozessLebt && session ? session.cli : cliPreview}
        {!prozessLebt && <span className="caret" />}
      </div>
      {prozessLebt && abweichung && (
        <div style={{ fontSize: 11, color: 'var(--color-warn)', marginTop: -4 }}>
          {t('sidebar.cliMismatch')}
        </div>
      )}

      {error && <div className="banner">{error}</div>}

      {/* Solange eine Session lebt, gibt es hier nichts zu starten —
          der Knopf war nur ausgegraut und blieb trotzdem stehen. */}
      {!prozessLebt && (
        <button
          className="btn btn-primary btn-block"
          onClick={props.onStart}
          disabled={props.busy || !prompt.trim() || !project}
        >
          <i className="ph ph-play" />
          {t('session.start')}
        </button>
      )}

      {prozessLebt && (
        <button className="btn btn-secondary btn-block" onClick={props.onStop}>
          <i className="ph ph-stop" />
          {wartet ? t('sidebar.stop') : t('session.cancel')}
        </button>
      )}
    </div>
  )
}
