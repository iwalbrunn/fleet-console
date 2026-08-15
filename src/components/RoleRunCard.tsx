'use client'

import { useTranslations } from 'next-intl'
import { type Role, type SessionState } from '@/lib/types'

/** Rollenlauf-Karte: jede gewählte Rolle bekommt eine eigene Session auf dem
 *  Projekt — unabhängig davon, ob der Orchestrator delegieren will. */
export function RoleRunCard(props: {
  session: SessionState
  roles: Role[]
  models: { id: string; label: string }[]
  meta: { standardAuftrag: string; standardModell: string; timeoutSec: number } | null
  aktiv: boolean
  laufRollen: string[]
  onLaufRollen: (rollen: string[]) => void
  auftrag: string
  onAuftrag: (text: string) => void
  modell: string
  onModell: (id: string) => void
  stand: boolean
  onStand: () => void
  offen: boolean
  onOffen: (offen: boolean) => void
  onStart: () => void
}) {
  const t = useTranslations()
  const { session, roles, models, meta, aktiv, laufRollen, auftrag, modell, stand, offen } = props

  return (
    <div className="card" style={{ marginTop: 10, gap: 8, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <i className="ph ph-flow-arrow" style={{ fontSize: 16, color: 'var(--color-accent)' }} />
        <div style={{ fontSize: 13, fontWeight: 500 }}>{t('roleRun.title')}</div>
        <div style={{ fontSize: 11, color: 'var(--color-neutral-500)', flex: 1, minWidth: 0 }}>
          {aktiv
            ? t('roleRun.running', { roles: session.pipelineRollen?.join(', ') ?? '' })
            : t('roleRun.subtitle')}
        </div>
        <button
          className="btn btn-ghost"
          style={{ fontSize: 11, padding: '3px 8px' }}
          onClick={() => props.onOffen(!offen)}
          title={t('roleRun.configTitle')}
        >
          <i className={`ph ${offen ? 'ph-caret-up' : 'ph-sliders-horizontal'}`} />
          {offen ? t('roleRun.collapse') : t('roleRun.configure')}
        </button>
        <button
          className="btn btn-primary"
          style={{ fontSize: 11.5, padding: '4px 10px' }}
          disabled={aktiv || !laufRollen.length}
          onClick={props.onStart}
          title={
            laufRollen.length
              ? t('roleRun.startTitle', { roles: laufRollen.join(', '), project: session.project.replace(/^\/Users\/[^/]+/, '~') })
              : t('roleRun.noRoleSelected')
          }
        >
          <i className={`ph ${aktiv ? 'ph-circle-notch' : 'ph-play'}`} />
          {aktiv ? t('roleRun.runningShort') : t('roleRun.start')}
        </button>
      </div>

      <div className="toolbar" style={{ gap: 5 }}>
        {roles.map((r) => {
          const an = laufRollen.includes(r.name)
          return (
            <button
              key={r.name}
              className="chip"
              data-on={an}
              disabled={aktiv}
              title={r.description}
              onClick={() =>
                props.onLaufRollen(an ? laufRollen.filter((x) => x !== r.name) : [...laufRollen, r.name])
              }
            >
              {r.name}
            </button>
          )
        })}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-neutral-600)' }}>
          {meta?.timeoutSec ? t('roleRun.timeout', { seconds: meta.timeoutSec }) : t('roleRun.noTimeout')}
        </span>
      </div>

      {offen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea
            className="input"
            style={{ minHeight: 64, fontSize: 11.5 }}
            value={auftrag}
            onChange={(e) => props.onAuftrag(e.target.value)}
            placeholder={meta?.standardAuftrag ?? t('roleRun.taskPlaceholder')}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{t('model.title')}</span>
            <select
              className="input"
              style={{ width: 150, fontSize: 11.5, padding: '3px 6px' }}
              value={modell}
              onChange={(e) => props.onModell(e.target.value)}
              title={t('roleRun.modelSelectTitle')}
            >
              <option value="auto">{t('roleRun.perRole')}</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {t('roleRun.allOn', { model: m.label })}
                </option>
              ))}
            </select>
            <button
              className="chip"
              data-on={stand}
              onClick={props.onStand}
              title={t('roleRun.attachStateTitle')}
            >
              {t('roleRun.attachState')}
            </button>
            {auftrag ? (
              <button
                className="btn btn-ghost"
                style={{ fontSize: 11, padding: '2px 7px' }}
                onClick={() => props.onAuftrag('')}
              >
                {t('roleRun.taskReset')}
              </button>
            ) : (
              <button
                className="btn btn-ghost"
                style={{ fontSize: 11, padding: '2px 7px' }}
                title={t('roleRun.briefingTitle')}
                onClick={() => props.onAuftrag(t('roleRun.briefingText'))}
              >
                {t('roleRun.briefingButton')}
              </button>
            )}
            <span style={{ fontSize: 11, color: 'var(--color-neutral-600)', flex: 1, minWidth: 180 }}>
              {t('roleRun.emptyTaskNote')}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
