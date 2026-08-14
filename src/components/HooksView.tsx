'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import type { HooksView as HooksData, NightRun, VpsStatus } from '@/lib/types'

export default function HooksView() {
  const t = useTranslations()
  const [hooks, setHooks] = useState<HooksData | null>(null)
  const [vps, setVps] = useState<VpsStatus | null>(null)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [runs, setRuns] = useState<NightRun[]>([])
  const [saving, setSaving] = useState(false)

  const loadHooks = () =>
    fetch('/api/hooks')
      .then((r) => r.json())
      .then((d: HooksData) => {
        setHooks(d)
        setDraft(d.raw)
      })

  useEffect(() => {
    void loadHooks()
    fetch('/api/vps')
      .then((r) => r.json())
      .then((d: VpsStatus) => {
        setVps(d)
        setRuns(d.runs ?? [])
      })
      .catch(() => setVps(null))
  }, [])

  const saveHooks = async () => {
    setSaving(true)
    setMsg(null)
    const res = await fetch('/api/hooks', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: draft }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) {
      setMsg({ kind: 'err', text: data.error ?? t('hooks.saveFailed') })
      return
    }
    setHooks(data)
    setDraft(data.raw)
    setEditing(false)
    setMsg({ kind: 'ok', text: t('hooks.saved') })
  }

  const saveRuns = async (next: NightRun[]) => {
    setSaving(true)
    setMsg(null)
    const res = await fetch('/api/vps', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runs: next.map(({ name, schedule, command }) => ({ name, schedule, command })),
      }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) {
      setMsg({ kind: 'err', text: data.error ?? t('hooks.cronFailed') })
      return
    }
    setVps(data)
    setRuns(data.runs ?? [])
    setMsg({ kind: 'ok', text: t('hooks.cronUpdated') })
  }

  return (
    <div style={{ gridColumn: '2 / 4', padding: 18, overflowY: 'auto', minWidth: 0 }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 500, fontSize: 16 }}>
          {t('hooks.title')}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>
          {t('hooks.subtitle')}
        </div>
      </div>

      {msg && (
        <div
          className={msg.kind === 'err' ? 'banner' : ''}
          style={
            msg.kind === 'ok'
              ? {
                  border: '1px solid var(--color-divider)',
                  borderRadius: 'var(--radius-md)',
                  padding: '8px 11px',
                  fontSize: 12,
                  marginBottom: 12,
                  color: 'var(--color-accent-300)',
                }
              : { marginBottom: 12 }
          }
        >
          {msg.text}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(330px,1fr))',
          gap: 14,
          alignItems: 'start',
          maxWidth: 1120,
        }}
      >
        {/* Security-Gate */}
        <div className="card elev-sm" style={{ gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <i className="ph ph-lightning" style={{ color: 'var(--color-accent)', fontSize: 17 }} />
            <span style={{ fontSize: 14, fontWeight: 500, flex: 1 }}>security-reviewer</span>
            <span
              className={`tag ${hooks?.gateInstalled ? 'tag-accent' : 'tag-outline'}`}
              style={{ fontSize: 10 }}
            >
              {hooks?.gateInstalled ? t('hooks.gateActive') : t('hooks.notInstalled')}
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-neutral-400)', lineHeight: 1.5 }}>
            {t('hooks.gateDescription')}
          </div>
          {hooks?.gateScript && (
            <div
              className="mono"
              style={{ fontSize: 10.5, color: 'var(--color-neutral-500)', wordBreak: 'break-all' }}
            >
              {hooks.gateScript}
            </div>
          )}
          <div className="kicker" style={{ letterSpacing: '.1em' }}>
            {t('hooks.lastRuns')}
          </div>
          {hooks?.gateRuns.length ? (
            hooks.gateRuns.map((h, i) => (
              <div
                key={i}
                style={{ display: 'flex', gap: 10, fontSize: 11.5, alignItems: 'baseline' }}
              >
                <span className="mono" style={{ color: 'var(--color-neutral-500)', flex: 'none' }}>
                  {h.date}
                </span>
                <span style={{ color: 'var(--color-neutral-300)', flex: 1 }}>{h.text}</span>
                <span style={{ color: 'var(--color-accent-300)' }}>{h.result}</span>
              </div>
            ))
          ) : (
            <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
              {t('hooks.notYetTriggered')}
            </div>
          )}
        </div>

        {/* Nachtläufe vps02 */}
        <div className="card elev-sm" style={{ gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <i
              className="ph ph-moon-stars"
              style={{ color: 'var(--color-accent)', fontSize: 17 }}
            />
            <span style={{ fontSize: 14, fontWeight: 500, flex: 1 }}>Nachtläufe · vps02</span>
            <span
              className={`tag ${vps?.connected ? 'tag-accent' : 'tag-outline'}`}
              style={{ fontSize: 10 }}
            >
              {vps?.connected ? t('hooks.connected') : t('hooks.offline')}
            </span>
          </div>

          {vps?.error && <div className="banner">{vps.error}</div>}

          {vps?.connected && (
            <>
              <div className="split">
                <span>{t('hooks.claudeOnServer')}</span>
                <span style={{ color: 'var(--color-text)' }}>{vps.claudeVersion || '—'}</span>
              </div>
              <div className="split">
                <span>{t('hooks.otherCronLines')}</span>
                <span style={{ color: 'var(--color-text)' }}>
                  {vps.otherLines} ({t('hooks.unchanged')})
                </span>
              </div>
              {vps.lastRun && (
                <div className="split">
                  <span>Letzter Lauf</span>
                  <span style={{ color: '#d2cefd' }}>{vps.lastRun}</span>
                </div>
              )}
            </>
          )}

          {runs.map((r, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                borderTop: '1px solid var(--color-divider)',
                paddingTop: 8,
              }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  className="input mono"
                  style={{ width: 110, fontSize: 11 }}
                  value={r.schedule}
                  onChange={(e) =>
                    setRuns(runs.map((x, j) => (j === i ? { ...x, schedule: e.target.value } : x)))
                  }
                />
                <span style={{ fontSize: 12, flex: 1 }}>{r.name}</span>
                <button
                  className="btn btn-ghost btn-icon"
                  title="Entfernen"
                  onClick={() => setRuns(runs.filter((_, j) => j !== i))}
                >
                  <i className="ph ph-trash" />
                </button>
              </div>
              <textarea
                className="input mono"
                style={{ fontSize: 10.5, minHeight: 56 }}
                value={r.command}
                onChange={(e) =>
                  setRuns(runs.map((x, j) => (j === i ? { ...x, command: e.target.value } : x)))
                }
              />
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-secondary"
              disabled={!vps?.connected}
              onClick={() =>
                setRuns([
                  ...runs,
                  {
                    name: `nachtlauf-${runs.length + 1}`,
                    schedule: '0 2 * * *',
                    command: vps?.template ?? '',
                    line: '',
                  },
                ])
              }
            >
              <i className="ph ph-plus" />
              Nachtlauf
            </button>
            <button
              className="btn btn-primary"
              disabled={!vps?.connected || saving}
              onClick={() => saveRuns(runs)}
            >
              <i className="ph ph-cloud-arrow-up" />
              Auf vps02 schreiben
            </button>
          </div>
        </div>

        {/* settings.json */}
        <div className="card elev-sm" style={{ gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <i
              className="ph ph-brackets-curly"
              style={{ color: 'var(--color-accent)', fontSize: 17 }}
            />
            <span style={{ fontSize: 14, fontWeight: 500, flex: 1 }}>hooks in settings.json</span>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 12 }}
              onClick={() => setEditing(!editing)}
            >
              {editing ? 'Abbrechen' : 'Bearbeiten'}
            </button>
          </div>
          {editing ? (
            <>
              <textarea
                className="input mono"
                style={{ fontSize: 10.5, minHeight: 260, lineHeight: 1.6 }}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
              />
              <button className="btn btn-primary" disabled={saving} onClick={saveHooks}>
                <i className="ph ph-floppy-disk" />
                Speichern
              </button>
            </>
          ) : (
            <pre
              className="mono"
              style={{
                background: '#101120',
                border: '1px solid var(--color-divider)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 12px',
                fontSize: 10.5,
                lineHeight: 1.7,
                color: 'var(--color-neutral-300)',
                margin: 0,
                maxHeight: 300,
                overflow: 'auto',
              }}
            >
              {hooks?.raw ?? 'lade …'}
            </pre>
          )}
          <div style={{ fontSize: 10.5, color: 'var(--color-neutral-500)' }}>
            {hooks?.entries.length ?? 0} Hooks aktiv · {hooks?.file.replace(/^\/Users\/[^/]+/, '~')}
          </div>
        </div>
      </div>
    </div>
  )
}
