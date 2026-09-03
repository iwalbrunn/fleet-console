'use client'

import { useTranslations } from 'next-intl'
import { type Role, type SessionState } from '@/lib/types'

/** V2-Verifikationskarte. Der Standard ist ein universeller, unabhängiger
 * Verifier nach deterministischen Checks; Spezialrollen bleiben als
 * bewusstes Expertenwerkzeug im aufklappbaren Bereich erhalten. */
export function RoleRunCard(props: {
  session: SessionState
  roles: Role[]
  models: { id: string; label: string }[]
  meta: { standardAuftrag: string; standardModell: string; timeoutSec: number } | null
  aktiv: boolean
  canVerify: boolean
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
  onVerify: () => void
}) {
  const t = useTranslations()
  const { session, roles, models, meta, aktiv, laufRollen, auftrag, modell, stand, offen } = props
  const verification = session.verification

  return (
    <div className="card" style={{ marginTop: 10, gap: 8, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <i className="ph ph-shield-check" style={{ fontSize: 16, color: 'var(--color-accent)' }} />
        <div style={{ fontSize: 13, fontWeight: 500 }}>{t('verification.title')}</div>
        <div style={{ fontSize: 11, color: 'var(--color-neutral-500)', flex: 1, minWidth: 0 }}>
          {aktiv
            ? t('roleRun.running', { roles: session.pipelineRollen?.join(', ') ?? '' })
            : t(`verification.${session.verification?.status ?? 'idle'}`)}
        </div>
        {session.verification?.risk && session.verification.status !== 'idle' && (
          <span className="pill">
            {t('verification.risk')} {session.verification.risk}
          </span>
        )}
        <button
          className="btn btn-primary"
          style={{ fontSize: 11.5, padding: '4px 10px' }}
          disabled={aktiv || !props.canVerify}
          onClick={props.onVerify}
        >
          <i className={`ph ${aktiv ? 'ph-circle-notch' : 'ph-check-circle'}`} />
          {aktiv ? t('verification.running') : t('verification.start')}
        </button>
        <button
          className="btn btn-ghost"
          style={{ fontSize: 11, padding: '3px 8px' }}
          onClick={() => props.onOffen(!offen)}
          title={t('verification.experts')}
        >
          <i className={`ph ${offen ? 'ph-caret-up' : 'ph-sliders-horizontal'}`} />
          {offen ? t('roleRun.collapse') : t('verification.experts')}
        </button>
      </div>

      {verification && verification.reasons.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>
          {verification.reasons.join(' · ')}
          {verification.checks.length > 0 &&
            ` · ${verification.checks.filter((c) => c.status === 'passed').length}/${verification.checks.length} Checks bestanden`}
        </div>
      )}

      {offen && (
        <>
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
                    props.onLaufRollen(
                      an ? laufRollen.filter((x) => x !== r.name) : [...laufRollen, r.name]
                    )
                  }
                >
                  {r.name}
                </button>
              )
            })}
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-neutral-600)' }}>
              {meta?.timeoutSec
                ? t('roleRun.timeout', { seconds: meta.timeoutSec })
                : t('roleRun.noTimeout')}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <textarea
              className="input"
              style={{ minHeight: 64, fontSize: 11.5 }}
              value={auftrag}
              onChange={(e) => props.onAuftrag(e.target.value)}
              placeholder={meta?.standardAuftrag ?? t('roleRun.taskPlaceholder')}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>
                {t('model.title')}
              </span>
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
              <span
                style={{ fontSize: 11, color: 'var(--color-neutral-600)', flex: 1, minWidth: 180 }}
              >
                {t('roleRun.emptyTaskNote')}
              </span>
            </div>
            <button
              className="btn btn-secondary"
              disabled={aktiv || !laufRollen.length}
              onClick={props.onStart}
            >
              <i className="ph ph-users-three" />
              {t('verification.runExperts')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
