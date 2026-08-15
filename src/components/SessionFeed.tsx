'use client'

import { useTranslations } from 'next-intl'
import { type RefObject } from 'react'
import { fmtTime, fmtTokens, type Anforderung, type FeedLine, type SessionState } from '@/lib/types'

/** Rechte Spalte: Kennzahlen, Anforderungen, Live-Feed und die Eingabe an
 *  die laufende Session. */
export function SessionFeed(props: {
  session: SessionState | null
  prozessLebt: boolean
  arbeitet: boolean
  wartet: boolean
  wartetSeit: string | null
  unterbrochen: boolean
  ohneRolle: boolean
  pipelineAktiv: boolean
  tokens: { in: number; out: number; cached: number; cacheWrite: number; anfragen: number; kosten: number }
  elapsed: string
  anforderungen: Anforderung[]
  log: FeedLine[]
  feedRef: RefObject<HTMLDivElement | null>
  draft: string
  onDraft: (text: string) => void
  onSend: () => void
  onResume: () => void
  onHandover: () => void
  onRoleRun: () => void
}) {
  const t = useTranslations()
  const {
    session, prozessLebt, arbeitet, wartet, wartetSeit, unterbrochen, ohneRolle,
    pipelineAktiv, tokens, elapsed, anforderungen, log, feedRef, draft,
  } = props

  return (
    <>
      {unterbrochen && (
        <div className="warnbox" style={{ marginBottom: 10 }}>
          <span style={{ flex: 1 }}>{t('session.interrupted')}</span>
          <button className="btn btn-secondary" style={{ fontSize: 11, padding: '3px 9px' }} onClick={props.onResume}>
            {t('session.resume')}
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
        <div
          className="card"
          style={{ gap: 1, padding: '9px 11px' }}
          title={`${t('stats.cache')}: ${fmtTokens(tokens.cacheWrite)}↑ ${fmtTokens(tokens.cached)}↓ — ${t('stats.tooltip')}`}
        >
          <div className="kicker">{t('stats.tokens')}</div>
          <div style={{ fontSize: 15, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
            {fmtTokens(tokens.out)} <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{t('stats.out')}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-neutral-500)', lineHeight: 1.5 }}>
            {fmtTokens(tokens.in)} {t('stats.in')} · {tokens.anfragen} {t('stats.requests')}
            {tokens.kosten > 0 ? ` · ≈ $${tokens.kosten.toFixed(2)}` : ''}
          </div>
        </div>
        <div className="card" style={{ gap: 1, padding: '9px 11px' }}>
          <div className="kicker">{t('stats.duration')}</div>
          <div style={{ fontSize: 15, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{elapsed}</div>
        </div>
      </div>

      {anforderungen.length > 0 && (
        <div className="card" style={{ gap: 6, padding: '9px 11px', marginBottom: 12 }}>
          <div className="kicker" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1 }}>
              {t('requirements.title')} · {anforderungen.filter((a) => a.status === 'offen').length} {t('requirements.open')}
            </span>
            {session && !prozessLebt && anforderungen.some((a) => a.status === 'offen') && (
              <button
                className="btn btn-secondary"
                style={{ fontSize: 11, padding: '2px 8px' }}
                title={t('handover.title')}
                onClick={props.onHandover}
              >
                {t('handover.button')}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
            {anforderungen.map((a) => (
              <div key={a.id} style={{ fontSize: 11, lineHeight: 1.45, display: 'flex', gap: 6 }} title={a.notiz ?? a.text}>
                <span
                  style={{
                    flexShrink: 0,
                    color:
                      a.status === 'erledigt'
                        ? 'var(--color-neutral-400)'
                        : a.status === 'verworfen'
                          ? 'var(--color-neutral-600)'
                          : 'var(--color-accent)',
                  }}
                >
                  {a.status === 'erledigt' ? '✓' : a.status === 'verworfen' ? '–' : '○'}
                </span>
                <span
                  style={{
                    color: a.status === 'offen' ? 'var(--color-text)' : 'var(--color-neutral-500)',
                    textDecoration: a.status === 'verworfen' ? 'line-through' : 'none',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {a.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div className="kicker">{t('feed.title')}</div>
        {arbeitet && (
          <span
            style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-accent)', animation: 'nfPulse 1.6s infinite' }}
          />
        )}
        {wartet && <span className="tag tag-outline" style={{ fontSize: 11 }}>{t('feed.waiting')}</span>}
        <div className="mono" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-neutral-600)' }}>
          stream-json
        </div>
      </div>

      <div className="feed" ref={feedRef}>
        {log.length === 0 && <div style={{ color: 'var(--color-neutral-600)' }}>{t('feed.noItems')}</div>}
        {log.map((l, i) => {
          const vorher = log[i - 1]
          const neuerSprecher = !vorher || vorher.agent !== l.agent
          return (
            <div key={i} className={neuerSprecher ? 'feedgroup' : undefined}>
              {neuerSprecher && (
                <div
                  className="feedagent"
                  style={{ color: l.kind === 'error' ? 'var(--color-error-soft)' : l.agent === 'orchestrator' ? 'var(--color-accent)' : undefined }}
                >
                  {l.agent}
                </div>
              )}
              <div className="feedrow">
                <span className="feedtime">{fmtTime(l.t).slice(0, 5)}</span>
                <span className="feedtext">{l.text}</span>
              </div>
            </div>
          )
        })}
      </div>

      {wartet && ohneRolle && (
        <div className="warnbox" style={{ marginTop: 10 }}>
          <span style={{ flex: 1 }}>{t('roleRun.noRoleAlert')}</span>
          <button
            className="btn btn-secondary"
            style={{ fontSize: 11, padding: '3px 9px' }}
            disabled={pipelineAktiv}
            onClick={props.onRoleRun}
          >
            {t('roleRun.startRun')}
          </button>
        </div>
      )}
      {wartet && (
        <div className="warnbox" style={{ marginTop: 10 }}>
          {t('waitState.waitingFor', { time: wartetSeit ?? '' })}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input
          className="input"
          placeholder={wartet ? t('messages.placeholderWartet') : t('messages.placeholderRunning')}
          value={draft}
          disabled={!prozessLebt}
          onChange={(e) => props.onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              props.onSend()
            }
          }}
          style={{ flex: 1 }}
        />
        <button className="btn btn-primary btn-icon" onClick={props.onSend} disabled={!prozessLebt} title={t('messages.send')}>
          <i className="ph ph-paper-plane-tilt" />
        </button>
      </div>
    </>
  )
}
