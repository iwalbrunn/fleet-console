'use client'

import { useEffect, useState } from 'react'
import { fmtDate, fmtDuration, fmtTokens, type RunDetail, type RunSummary } from '@/lib/types'

export default function RunsView() {
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [suche, setSuche] = useState('')
  const [projekt, setProjekt] = useState('alle')
  const [nurRollen, setNurRollen] = useState(false)

  useEffect(() => {
    fetch('/api/runs')
      .then((r) => r.json())
      .then((d) => {
        setRuns(d.runs ?? [])
        setSelected((prev) => prev ?? d.runs?.[0]?.id ?? null)
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!selected) return
    setDetail(null)
    fetch(`/api/runs/${selected}`)
      .then((r) => r.json())
      .then((d) => setDetail(d.run ?? null))
      .catch(() => setDetail(null))
  }, [selected])

  const projekte = [...new Set(runs.map((r) => r.projectShort))].sort()
  const sichtbar = runs.filter((r) => {
    if (projekt !== 'alle' && r.projectShort !== projekt) return false
    if (nurRollen && r.agentCalls === 0) return false
    if (suche.trim() && !`${r.title} ${r.projectShort}`.toLowerCase().includes(suche.toLowerCase())) return false
    return true
  })

  return (
    <div className="runswrap" style={{ gridColumn: '2 / 4', display: 'flex', gap: 18, padding: 18, minWidth: 0, overflow: 'hidden' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 500, fontSize: 16 }}>Verläufe</div>
          <div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>
            {loading
              ? 'lese Transcripts …'
              : `${sichtbar.length} von ${runs.length} Läufen aus ~/.claude/projects`}
          </div>
        </div>

        <div className="toolbar">
          <input
            className="input"
            placeholder="Suchen …"
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            style={{ flex: '1 1 220px', maxWidth: 380 }}
          />
          <select className="input" value={projekt} onChange={(e) => setProjekt(e.target.value)} style={{ width: 220 }}>
            <option value="alle">alle Projekte</option>
            {projekte.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button className="chip" data-on={nurRollen} onClick={() => setNurRollen(!nurRollen)}>
            nur mit Rollen
          </button>
        </div>

        {error && <div className="banner">{error}</div>}

        <div
          className="runrow"
          style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-neutral-500)', cursor: 'default', borderBottom: 'none' }}
        >
          <span>Datum</span>
          <span>Lauf</span>
          <span>Dauer</span>
          <span>Tokens</span>
          <span>Security</span>
          <span>Status</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {sichtbar.map((run) => (
            <button
              key={run.id}
              className="runrow"
              data-selected={selected === run.id}
              onClick={() => setSelected(run.id)}
            >
              <span style={{ color: 'var(--color-neutral-400)', fontVariantNumeric: 'tabular-nums' }}>
                {fmtDate(run.started)}
              </span>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <i
                  className={`ph ${run.agentCalls > 0 ? 'ph-tree-structure' : 'ph-terminal-window'}`}
                  style={{ color: 'var(--color-accent)', fontSize: 13, marginRight: 7 }}
                />
                {run.title}
                <span style={{ color: 'var(--color-neutral-600)', marginLeft: 8, fontSize: 11 }}>{run.projectShort}</span>
              </span>
              <span style={{ color: 'var(--color-neutral-400)' }}>{fmtDuration(run.durationMs)}</span>
              <span style={{ color: 'var(--color-neutral-400)', fontVariantNumeric: 'tabular-nums' }}>
                {fmtTokens(run.tokensIn + run.tokensOut)}
              </span>
              <span className={`tag ${run.security === 'geprüft' ? 'tag-accent' : 'tag-outline'}`} style={{ fontSize: 9.5 }}>
                {run.security}
              </span>
              <span style={{ color: run.status === 'abgeschlossen' ? 'var(--color-neutral-300)' : '#c8a06a', fontSize: 11.5 }}>
                {run.status}
              </span>
            </button>
          ))}
          {!loading && !sichtbar.length && (
            <div style={{ color: 'var(--color-neutral-500)', fontSize: 12, padding: 12 }}>
              {runs.length ? 'Kein Lauf passt zu dieser Auswahl.' : 'Keine Transcripts gefunden.'}
            </div>
          )}
        </div>
      </div>

      <div className="runsdetail" style={{ width: 430, flex: 'none', overflowY: 'auto' }}>
        <div className="card elev-sm" style={{ gap: 12 }}>
          <div className="card-kicker">Bericht</div>
          {!detail && <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>Lauf auswählen …</div>}
          {detail && (
            <>
              <div>
                <div className="card-title" style={{ fontSize: 15, lineHeight: 1.35 }}>
                  {detail.title}
                </div>
                <div className="card-meta">
                  {detail.projectShort}
                  {detail.gitBranch ? ` · ${detail.gitBranch}` : ''} · {fmtDate(detail.started)} ·{' '}
                  {fmtDuration(detail.durationMs)}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <Stat label="Tokens" value={fmtTokens(detail.tokensIn + detail.tokensOut)} hint={`+ ${fmtTokens(detail.tokensCached)} Cache`} />
                <Stat label="Werkzeuge" value={String(detail.toolCalls)} />
                <Stat label="Rollen" value={String(detail.agentCalls)} />
              </div>

              {detail.summary.length > 0 && (
                <Section title="Zusammenfassung">
                  {detail.summary.map((p, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12.5, lineHeight: 1.5, color: 'var(--color-neutral-300)' }}>
                      <span style={{ color: 'var(--color-accent)', flex: 'none' }}>—</span>
                      <span>{p}</span>
                    </div>
                  ))}
                </Section>
              )}

              {detail.findings.length > 0 && (
                <Section title="Security-Review">
                  {detail.findings.map((f, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12, lineHeight: 1.5 }}>
                      <span
                        className={`tag ${/kritisch|critical|hoch|high/.test(f.sev) ? 'tag-accent' : 'tag-outline'}`}
                        style={{ fontSize: 9.5, flex: 'none' }}
                      >
                        {f.sev}
                      </span>
                      <span style={{ color: 'var(--color-neutral-300)' }}>{f.text}</span>
                    </div>
                  ))}
                </Section>
              )}

              {detail.agents.length > 0 && (
                <Section title="Beteiligte Rollen">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {detail.agents.map((a) => (
                      <span key={a.name} className="tag tag-neutral" style={{ fontSize: 10 }}>
                        {a.name} ×{a.calls}
                      </span>
                    ))}
                  </div>
                </Section>
              )}

              {detail.artifacts.length > 0 && (
                <Section title="Artefakte">
                  {detail.artifacts.slice(0, 12).map((a) => (
                    <div key={a} className="mono" style={{ fontSize: 11, color: 'var(--color-accent-300)' }}>
                      <i className="ph ph-file" style={{ marginRight: 6 }} />
                      {a.replace(/^\/Users\/[^/]+/, '~')}
                    </div>
                  ))}
                  {detail.artifacts.length > 12 && (
                    <div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>
                      … und {detail.artifacts.length - 12} weitere
                    </div>
                  )}
                </Section>
              )}

              <div className="mono" style={{ fontSize: 10, color: 'var(--color-neutral-600)', wordBreak: 'break-all' }}>
                {detail.file.replace(/^\/Users\/[^/]+/, '~')}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card" style={{ gap: 1, padding: '8px 10px' }}>
      <div style={{ fontSize: 9.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-neutral-500)' }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {hint && <div style={{ fontSize: 9.5, color: 'var(--color-neutral-600)' }}>{hint}</div>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="kicker" style={{ letterSpacing: '.1em' }}>
        {title}
      </div>
      {children}
    </div>
  )
}
