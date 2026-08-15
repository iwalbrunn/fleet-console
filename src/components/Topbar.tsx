'use client'

import { useTranslations } from 'next-intl'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { ThemeSwitcher } from '@/components/ThemeSwitcher'
import { type SessionState } from '@/lib/types'

export type Tab = 'konsole' | 'verlaeufe'

/** Kopfzeile: Marke, Tabs, Session-Status/-Wechsler und die Umschalter. */
export function Topbar(props: {
  tab: Tab
  onTab: (tab: Tab) => void
  session: SessionState | null
  sessions: SessionState[]
  onSession: (session: SessionState) => void
  arbeitet: boolean
  wartet: boolean
  wartetSeit: string | null
  statusLabel: Record<SessionState['status'], string>
  projektAnzahl: number
}) {
  const t = useTranslations()
  const { tab, session, sessions, arbeitet, wartet, wartetSeit, statusLabel, projektAnzahl } = props

  return (
    <header className="topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="brandmark" />
        <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 500, fontSize: 14, letterSpacing: '.14em' }}>
          FLEET
        </div>
        <div className="untertitel" style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{t('navigation.subtitle')}</div>
      </div>
      <nav style={{ display: 'flex', gap: 6 }}>
        <button className="navbtn" data-active={tab === 'konsole'} onClick={() => props.onTab('konsole')}>
          {t('navigation.console')}
        </button>
        <button className="navbtn" data-active={tab === 'verlaeufe'} onClick={() => props.onTab('verlaeufe')}>
          {t('navigation.history')}
        </button>
      </nav>
      <div className="topbar-pills" style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
        <div className="pill">
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: arbeitet ? 'var(--color-accent)' : wartet ? 'var(--color-warn)' : 'var(--color-neutral-700)',
              boxShadow: arbeitet ? '0 0 8px color-mix(in srgb, var(--color-accent) 80%, transparent)' : 'none',
            }}
          />
          {sessions.length > 1 ? (
            <select
              value={session?.id ?? ''}
              onChange={(e) => {
                const s = sessions.find((x) => x.id === e.target.value)
                if (s) props.onSession(s)
              }}
              style={{ background: 'transparent', border: 'none', color: 'inherit', font: 'inherit', cursor: 'pointer' }}
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {statusLabel[s.status]} · {s.prompt.slice(0, 28)}
                </option>
              ))}
            </select>
          ) : session ? (
            wartet
              ? t('topbar.waitingSince', { time: wartetSeit ?? '' })
              : t('topbar.sessionStatus', { status: statusLabel[session.status] })
          ) : (
            t('topbar.noSession')
          )}
        </div>
        <div className="pill">
          <i className="ph ph-folder" style={{ fontSize: 12 }} />
          {t('topbar.projects', { count: projektAnzahl })}
        </div>
        <ThemeSwitcher />
        <LanguageSwitcher />
      </div>
    </header>
  )
}
