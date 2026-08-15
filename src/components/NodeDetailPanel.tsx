'use client'

import { useTranslations } from 'next-intl'
import { fmtDuration, fmtTokens, type GraphNode, type Role } from '@/lib/types'
import { ROLE_ICONS } from '@/lib/roleIcons'

/** Seitenpanel des Graphen — liegt über der Bühne, wie im Entwurf. Die
 *  Chips selbst tragen nur Name, Zustand und Phase. */
export function NodeDetailPanel({
  detail,
  roles,
  now,
  onClose,
}: {
  detail: GraphNode
  roles: Role[]
  now: number
  onClose: () => void
}) {
  const t = useTranslations()
  return (
    <div
      className="elev-md"
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        bottom: 12,
        width: 292,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 14,
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-overlay)',
        backdropFilter: 'blur(6px)',
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <i className={`ph ${ROLE_ICONS[detail.id] ?? 'ph-tree-structure'}`} style={{ fontSize: 18, color: 'var(--color-accent)' }} />
        <div style={{ fontSize: 14, fontWeight: 500, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {detail.id}
        </div>
        <button
          className="btn btn-secondary btn-icon"
          style={{ width: 26, height: 26 }}
          onClick={onClose}
          title={t('layout.close')}
        >
          <i className="ph ph-x" style={{ fontSize: 13 }} />
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11.5, color: 'var(--color-neutral-400)' }}>
        <div className="split">
          <span>{t('panel.status')}</span>
          <span style={{ color: 'var(--color-text)' }}>{detail.status}</span>
        </div>
        <div className="split">
          <span>{t('panel.calls')}</span>
          <span style={{ color: 'var(--color-text)' }}>
            {detail.calls}
            {detail.quelle && (
              <span style={{ color: 'var(--color-neutral-500)' }}>
                {' '}
                · {detail.quelle === 'rollenlauf' ? t('panel.ownRun') : t('panel.agentTool')}
              </span>
            )}
          </span>
        </div>
        <div className="split">
          <span>{t('panel.usage')}</span>
          <span style={{ color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>
            {fmtTokens(detail.tokensOut ?? 0)} {t('stats.out')} · {fmtTokens(detail.tokensIn ?? 0)} {t('stats.in')} · {detail.anfragen ?? 0} {t('panel.requestsShort')}
          </span>
        </div>
        <div className="split">
          <span>{t('stats.duration')}</span>
          <span style={{ color: 'var(--color-text)' }}>
            {detail.startedAt
              ? fmtDuration(
                  (detail.endedAt ? new Date(detail.endedAt).getTime() : now) - new Date(detail.startedAt).getTime(),
                )
              : '—'}
          </span>
        </div>
        <div className="split">
          <span>{t('panel.phase')}</span>
          <span style={{ color: 'var(--color-text)', maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {detail.phase || '—'}
          </span>
        </div>
      </div>

      {detail.auftrag && (
        <div>
          <div className="kicker" style={{ marginBottom: 4 }}>{t('panel.task')}</div>
          <div style={{ fontSize: 11, color: 'var(--color-neutral-300)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {detail.auftrag.slice(0, 600)}
          </div>
        </div>
      )}

      {/* Kein flex:1 — sonst wird der Block gestaucht und der lange Text
          läuft sichtbar über die Rollenbeschreibung darunter. Das Panel
          scrollt stattdessen als Ganzes. */}
      {(detail.volltext || detail.ergebnis) && (
        <div style={{ flex: 'none' }}>
          <div className="kicker" style={{ marginBottom: 4, display: 'flex', gap: 8 }}>
            <span>{t('panel.reply')}</span>
            {detail.bericht && (
              <span
                className="mono"
                style={{ marginLeft: 'auto', color: 'var(--color-neutral-600)', fontSize: 11, textTransform: 'none' }}
                title={detail.bericht}
              >
                {t('panel.stored')}
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--color-accent-300)',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
            }}
          >
            {detail.volltext || detail.ergebnis}
          </div>
        </div>
      )}

      {roles.find((r) => r.name === detail.id)?.description && (
        <div style={{ fontSize: 11, color: 'var(--color-neutral-500)', lineHeight: 1.5 }}>
          {roles.find((r) => r.name === detail.id)?.description}
        </div>
      )}
    </div>
  )
}
