'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import AgentGraph from '@/components/AgentGraph'
import AnswerView from '@/components/AnswerView'
import HooksView from '@/components/HooksView'
import RunsView from '@/components/RunsView'
import {
  fmtDuration,
  fmtTime,
  fmtTokens,
  type FeedLine,
  type GraphNode,
  type ProjectEntry,
  type Role,
  type SessionState,
} from '@/lib/types'

type Tab = 'konsole' | 'verlaeufe' | 'hooks'

const ROLE_ICONS: Record<string, string> = {
  'security-reviewer': 'ph-shield-check',
  'senior-developer': 'ph-code',
  'project-manager': 'ph-kanban',
  'business-analyst': 'ph-clipboard-text',
  'ux-ui-expert': 'ph-layout',
}

export default function Page() {
  const [tab, setTab] = useState<Tab>('konsole')

  const [projects, setProjects] = useState<ProjectEntry[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [models, setModels] = useState<{ id: string; label: string }[]>([])

  const [projectId, setProjectId] = useState('')
  const [project, setProject] = useState('') // gewählte Arbeitskopie
  const [model, setModel] = useState('sonnet')
  const [picked, setPicked] = useState<string[]>([])
  const [prompt, setPrompt] = useState('')
  const [skip, setSkip] = useState(false)

  const [session, setSession] = useState<SessionState | null>(null)
  const [sessions, setSessions] = useState<SessionState[]>([])
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [log, setLog] = useState<FeedLine[]>([])
  const [tokens, setTokens] = useState({ in: 0, out: 0, cached: 0, cacheWrite: 0, anfragen: 0 })
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [ansicht, setAnsicht] = useState<'graph' | 'antwort'>('graph')
  const [neueAntwort, setNeueAntwort] = useState(false)
  const [mitRollen, setMitRollen] = useState<string[]>([])
  const [feedFilter, setFeedFilter] = useState<'alles' | 'werkzeuge' | 'rollen'>('alles')
  const [antworten, setAntworten] = useState<{ t: string; text: string }[]>([])
  const [links, setLinks] = useState(270)
  const [rechts, setRechts] = useState(348)
  // Schmales Fenster: die Seitenspalten passen nicht mehr neben den Inhalt
  // und werden zu Schubladen, die über ihm liegen.
  const [schmal, setSchmal] = useState(false)
  const [schublade, setSchublade] = useState<'links' | 'rechts' | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  // Rollenlauf: eigene Sessions je Rolle, unabhängig vom Orchestrator
  const [pipelineMeta, setPipelineMeta] = useState<{ standardAuftrag: string; standardModell: string; timeoutSec: number } | null>(null)
  const [pipelineAuftrag, setPipelineAuftrag] = useState('')
  /** `auto` = kein --model, jede Rolle nimmt das aus ihrer Rollendatei. */
  const [pipelineModell, setPipelineModell] = useState('auto')
  const [pipelineStand, setPipelineStand] = useState(true)
  const [pipelineOffen, setPipelineOffen] = useState(false)
  const [laufRollen, setLaufRollen] = useState<string[]>([])

  const feedRef = useRef<HTMLDivElement | null>(null)

  // Beim Laden anhängen: Sessions leben im Server, nicht im Browser. Nach
  // einem Reload wird die neueste laufende Session wieder übernommen.
  useEffect(() => {
    fetch('/api/meta')
      .then((r) => r.json())
      .then((d) => {
        setProjects(d.projects ?? [])
        setRoles(d.roles ?? [])
        setModels(d.models ?? [])
        setSessions(d.sessions ?? [])
        if (d.pipeline) setPipelineMeta(d.pipeline)

        const laufend: SessionState[] = (d.sessions ?? []).filter(
          (s: SessionState) => s.status === 'läuft' || s.status === 'startet',
        )
        const wieder = laufend[0] ?? null
        if (wieder) {
          setSession(wieder)
          setNodes(wieder.nodes)
          setLog(wieder.log)
          setAntworten(wieder.antworten ?? [])
          setTokens({ in: wieder.tokensIn, out: wieder.tokensOut, cached: wieder.tokensCached, cacheWrite: wieder.tokensCacheWrite ?? 0, anfragen: wieder.anfragen ?? 0 })
          setModel(wieder.model)
          setPicked(wieder.roles)
          setSkip(wieder.skipPermissions)
          setProject(wieder.project)
          const eintrag = (d.projects ?? []).find((p: ProjectEntry) => p.paths.includes(wieder.project))
          if (eintrag) setProjectId(eintrag.id)
          return
        }

        if (d.projects?.length) {
          setProjectId((v) => v || d.projects[0].id)
          setProject((v) => v || d.projects[0].path)
        }
      })
      .catch((e) => setError(String(e)))
  }, [])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 980px)')
    const anwenden = () => {
      setSchmal(mq.matches)
      if (!mq.matches) setSchublade(null)
    }
    anwenden()
    mq.addEventListener('change', anwenden)
    return () => mq.removeEventListener('change', anwenden)
  }, [])

  // Spaltenbreiten über Sitzungen hinweg merken
  useEffect(() => {
    // Version im Schlüssel: eine frühere Fassung hat versehentlich Nullbreiten
    // gespeichert; die alten Werte werden deshalb verworfen statt geladen.
    localStorage.removeItem('fleet.links')
    localStorage.removeItem('fleet.rechts')
    localStorage.removeItem('fleet.ansicht')

    try {
      const roh = localStorage.getItem('fleet.layout.v2')
      if (roh) {
        const gespeichert = JSON.parse(roh)
        const klemm = (wert: unknown, standard: number) =>
          typeof wert === 'number' && Number.isFinite(wert) ? Math.max(0, Math.min(720, wert)) : standard
        setLinks(klemm(gespeichert.links, 270))
        setRechts(klemm(gespeichert.rechts, 348))
        if (gespeichert.ansicht === 'graph' || gespeichert.ansicht === 'antwort') setAnsicht(gespeichert.ansicht)
      }
    } catch {
      /* unlesbarer Eintrag — bei den Standardwerten bleiben */
    }
  }, [])
  useEffect(() => {
    localStorage.setItem('fleet.layout.v2', JSON.stringify({ links, rechts, ansicht }))
  }, [links, rechts, ansicht])

  /** Ziehen an einer Trennlinie. Doppelklick klappt die Spalte ein/aus. */
  const ziehen = (seite: 'links' | 'rechts') => (ev: React.PointerEvent<HTMLDivElement>) => {
    ev.preventDefault()
    const startX = ev.clientX
    const startBreite = seite === 'links' ? links : rechts
    const bewegen = (e: PointerEvent) => {
      const delta = seite === 'links' ? e.clientX - startX : startX - e.clientX
      const neu = Math.max(0, Math.min(720, startBreite + delta))
      if (seite === 'links') setLinks(neu)
      else setRechts(neu)
    }
    const loslassen = () => {
      window.removeEventListener('pointermove', bewegen)
      window.removeEventListener('pointerup', loslassen)
    }
    window.addEventListener('pointermove', bewegen)
    window.addEventListener('pointerup', loslassen)
  }

  // Live-Stream der laufenden Session
  useEffect(() => {
    if (!session?.id) return
    const es = new EventSource(`/api/sessions/${session.id}/stream`)

    es.addEventListener('state', (e) => {
      const s: SessionState = JSON.parse((e as MessageEvent).data)
      setSession(s)
      setNodes(s.nodes)
      setLog(s.log)
      setAntworten(s.antworten ?? [])
      setTokens({ in: s.tokensIn, out: s.tokensOut, cached: s.tokensCached, cacheWrite: s.tokensCacheWrite ?? 0, anfragen: s.anfragen ?? 0 })
    })
    es.addEventListener('line', (e) => {
      const line: FeedLine = JSON.parse((e as MessageEvent).data)
      setLog((prev) => [...prev.slice(-399), line])
    })
    es.addEventListener('nodes', (e) => setNodes(JSON.parse((e as MessageEvent).data)))
    es.addEventListener('antwort', (e) => {
      setAntworten((prev) => [...prev, JSON.parse((e as MessageEvent).data)])
      // Ansicht nicht wegschalten — nur anzeigen, dass etwas Neues da ist.
      setNeueAntwort(true)
    })
    es.addEventListener('tokens', (e) => setTokens(JSON.parse((e as MessageEvent).data)))
    es.addEventListener('end', () => es.close())
    es.onerror = () => es.close()

    return () => es.close()
  }, [session?.id])

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight })
  }, [log])

  // Der Rollenlauf schlägt die Rollen der Session vor. Nur beim Wechsel der
  // Session — sonst würde jede Stream-Aktualisierung die Auswahl überschreiben.
  const sessionId = session?.id
  const sessionRollen = session?.roles.join(',') ?? ''
  useEffect(() => {
    setLaufRollen(sessionRollen ? sessionRollen.split(',') : [])
  }, [sessionId])  // eslint-disable-line react-hooks/exhaustive-deps

  const cliPreview = `claude -p --output-format stream-json --input-format stream-json --verbose --model ${model}${
    skip ? ' --dangerously-skip-permissions' : ''
  }`

  const start = useCallback(async () => {
    setError(null)
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, model, roles: picked, prompt, skipPermissions: skip }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Start fehlgeschlagen')
      return
    }
    setSession(data.session)
    setMitRollen([])
    setSessions((prev) => [data.session, ...prev])
    setNodes(data.session.nodes)
    setLog(data.session.log)
    setTokens({ in: data.session.tokensIn, out: data.session.tokensOut, cached: data.session.tokensCached, cacheWrite: data.session.tokensCacheWrite ?? 0, anfragen: data.session.anfragen ?? 0 })
    setTab('konsole')
  }, [project, model, picked, prompt, skip])

  const send = async () => {
    if (!session || !draft.trim()) return
    // Die Delegations-Grundregeln stehen im Systemprompt jeder Runde. Der
    // Anhang hier ist nur für den Fall, dass Rollen ausdrücklich angehakt
    // sind — kurz, sonst zwingt jede Folgefrage eine neue Review-Runde auf.
    const auftrag = mitRollen.length
      ? `\n\n---\nBeauftrage dafür ${mitRollen.map((r) => `\`${r}\``).join(', ')} über das Agent-Tool, jeweils mit dem Teil, der in die Rolle fällt.`
      : ''
    const text = draft.trim() + auftrag
    setDraft('')
    await fetch(`/api/sessions/${session.id}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  }

  /** Nachträglich eine Rolle beauftragen. Das Modell und der Projektordner
   *  stehen dagegen im Prozessaufruf und lassen sich nicht mehr ändern. */
  const rolleDazu = async (name: string) => {
    if (!session) return
    const beschreibung = roles.find((r) => r.name === name)?.description ?? ''
    await fetch(`/api/sessions/${session.id}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text:
          `Zieh für die weitere Arbeit zusätzlich den Subagenten \`${name}\` hinzu ` +
          `(${beschreibung.slice(0, 160)}). Beauftrage ihn jetzt über das Agent-Tool mit dem ` +
          `Teil der Aufgabe, der in seine Rolle fällt, und fasse sein Ergebnis danach zusammen.`,
      }),
    })
    setPicked((prev) => (prev.includes(name) ? prev : [...prev, name]))
  }

  /** Rollenlauf: jede gewählte Rolle bekommt eine eigene Session auf dem
   *  Projekt. Läuft unabhängig davon, ob der Orchestrator delegieren will —
   *  das ist der Unterschied zum Anhängen von Text an die Nachricht. */
  const starteRollenlauf = async (rollen?: string[]) => {
    if (!session) return
    const gewaehlt = (rollen ?? laufRollen).filter(Boolean)
    if (!gewaehlt.length) {
      setError('Für den Rollenlauf ist keine Rolle gewählt.')
      return
    }
    setError(null)
    setPipelineOffen(false)
    const res = await fetch(`/api/sessions/${session.id}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'pipeline',
        roles: gewaehlt,
        model: pipelineModell,
        auftrag: pipelineAuftrag.trim() || undefined,
        stand: pipelineStand,
      }),
    })
    if (!res.ok) setError((await res.json()).error ?? 'Rollenlauf konnte nicht starten')
  }

  /** Unterbrochene Session wieder aufnehmen — der Serverprozess war weg, die
   *  Unterhaltung liegt noch bei Claude. */
  const fortsetzen = async () => {
    if (!session) return
    setError(null)
    const res = await fetch(`/api/sessions/${session.id}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resume' }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error ?? 'Fortsetzen fehlgeschlagen')
      return
    }
    if (data.session) setSession(data.session)
  }

  const uebernehmen = async () => {
    if (!session) return
    setError(null)
    const res = await fetch(`/api/sessions/${session.id}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reconfigure', model, skipPermissions: skip }),
    })
    if (!res.ok) setError((await res.json()).error ?? 'Umstellen fehlgeschlagen')
  }

  const stop = async () => {
    if (!session) return
    await fetch(`/api/sessions/${session.id}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' }),
    })
  }

  // „läuft" heißt beim Stream-Eingabemodus nur: der Prozess lebt. Ob er
  // arbeitet oder auf eine Nachricht wartet, steht im letzten Ereignis.
  const prozessLebt = session?.status === 'läuft' || session?.status === 'startet'
  const letztesEreignis = log[log.length - 1]
  const wartet = Boolean(prozessLebt && letztesEreignis?.kind === 'result')
  const arbeitet = Boolean(prozessLebt && !wartet)
  const running = prozessLebt
  const wartetSeit =
    wartet && letztesEreignis
      ? fmtDuration(now - new Date(letztesEreignis.t).getTime())
      : null
  // Runde ohne jede Delegation: die Rollen waren gewählt, aber keine wurde beauftragt
  const ohneRolle = Boolean(
    session?.roles.length && nodes.every((n) => n.id === 'orchestrator' || n.calls === 0),
  )
  const abweichung = Boolean(
    session && prozessLebt && (session.model !== model || session.skipPermissions !== skip),
  )
  const pipelineAktiv = Boolean(session?.pipelineAktiv)
  const unterbrochen = session?.status === 'unterbrochen'
  const elapsed = session ? fmtDuration((session.endedAt ? new Date(session.endedAt).getTime() : now) - new Date(session.startedAt).getTime()) : '—'
  const detail = nodes.find((n) => n.id === selectedNode) ?? null

  const gefiltert = log.filter((l) =>
    feedFilter === 'alles' ? true : feedFilter === 'werkzeuge' ? l.kind === 'tool' : l.kind === 'agent',
  )

  // Sessions, die vor der Antwort-Sammlung gestartet wurden, haben nur den Feed.
  const antwortenAnzeige =
    antworten.length > 0
      ? antworten
      : log
          .filter((l) => l.kind === 'text' && l.agent === 'orchestrator')
          .reduce<{ t: string; text: string }[]>((acc, l) => {
            const letzte = acc[acc.length - 1]
            if (letzte && new Date(l.t).getTime() - new Date(letzte.t).getTime() < 4000) {
              letzte.text += '\n' + l.text
              return acc
            }
            acc.push({ t: l.t, text: l.text })
            return acc
          }, [])

  /** Seitenpanel des Graphen — liegt über der Bühne, wie im Entwurf. Die
   *  Chips selbst tragen nur Name, Zustand und Phase. */
  const detailPanel = detail ? (
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
        background: 'rgba(35,37,50,.97)',
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
          onClick={() => setSelectedNode(null)}
          title="Schließen"
        >
          <i className="ph ph-x" style={{ fontSize: 13 }} />
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11.5, color: 'var(--color-neutral-400)' }}>
        <div className="split">
          <span>Status</span>
          <span style={{ color: 'var(--color-text)' }}>{detail.status}</span>
        </div>
        <div className="split">
          <span>Aufrufe</span>
          <span style={{ color: 'var(--color-text)' }}>
            {detail.calls}
            {detail.quelle && (
              <span style={{ color: 'var(--color-neutral-500)' }}>
                {' '}
                · {detail.quelle === 'rollenlauf' ? 'eigener Lauf' : 'Agent-Tool'}
              </span>
            )}
          </span>
        </div>
        <div className="split">
          <span>Verbrauch</span>
          <span style={{ color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>
            {fmtTokens(detail.tokensOut ?? 0)} aus · {fmtTokens(detail.tokensIn ?? 0)} ein · {detail.anfragen ?? 0} Anfr.
          </span>
        </div>
        <div className="split">
          <span>Dauer</span>
          <span style={{ color: 'var(--color-text)' }}>
            {detail.startedAt
              ? fmtDuration(
                  (detail.endedAt ? new Date(detail.endedAt).getTime() : now) - new Date(detail.startedAt).getTime(),
                )
              : '—'}
          </span>
        </div>
        <div className="split">
          <span>Phase</span>
          <span style={{ color: 'var(--color-text)', maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {detail.phase || '—'}
          </span>
        </div>
      </div>

      {detail.auftrag && (
        <div>
          <div className="kicker" style={{ marginBottom: 4 }}>Auftrag</div>
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
            <span>Rückmeldung</span>
            {detail.bericht && (
              <span
                className="mono"
                style={{ marginLeft: 'auto', color: 'var(--color-neutral-600)', fontSize: 9, textTransform: 'none' }}
                title={detail.bericht}
              >
                abgelegt
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
  ) : null

  return (
    <div
      className="shell"
      style={{
        gridTemplateColumns:
          tab === 'konsole' && !schmal
            ? `${links}px minmax(0, 1fr) ${rechts}px`
            : `0px minmax(0, 1fr) 0px`,
        position: 'relative',
      }}
    >
      {tab === 'konsole' && !schmal && (
      <div
        className="resizer"
        style={{ left: links - 3 }}
        onPointerDown={ziehen('links')}
        onDoubleClick={() => setLinks(links > 0 ? 0 : 270)}
        title="Ziehen zum Ändern, Doppelklick klappt ein"
      />
      )}
      {tab === 'konsole' && !schmal && (
      <div
        className="resizer"
        style={{ right: rechts - 3 }}
        onPointerDown={ziehen('rechts')}
        onDoubleClick={() => setRechts(rechts > 0 ? 0 : 348)}
        title="Ziehen zum Ändern, Doppelklick klappt ein"
      />
      )}
      <header className="topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="brandmark" />
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 500, fontSize: 14, letterSpacing: '.14em' }}>
            FLEET
          </div>
          <div className="untertitel" style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>Lokale Agenten-Konsole</div>
        </div>
        <nav style={{ display: 'flex', gap: 6 }}>
          <button className="navbtn" data-active={tab === 'konsole'} onClick={() => setTab('konsole')}>
            Konsole
          </button>
          <button className="navbtn" data-active={tab === 'verlaeufe'} onClick={() => setTab('verlaeufe')}>
            Verläufe
          </button>
          <button className="navbtn" data-active={tab === 'hooks'} onClick={() => setTab('hooks')}>
            Hooks
          </button>
        </nav>
        <div className="topbar-pills" style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="pill">
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: arbeitet ? 'var(--color-accent)' : wartet ? '#c8a06a' : 'var(--color-neutral-700)',
                boxShadow: arbeitet ? '0 0 8px rgba(145,132,217,.8)' : 'none',
              }}
            />
            {sessions.length > 1 ? (
              <select
                value={session?.id ?? ''}
                onChange={(e) => {
                  const s = sessions.find((x) => x.id === e.target.value)
                  if (!s) return
                  setSession(s)
                  setNodes(s.nodes)
                  setLog(s.log)
                  setTokens({ in: s.tokensIn, out: s.tokensOut, cached: s.tokensCached, cacheWrite: s.tokensCacheWrite ?? 0, anfragen: s.anfragen ?? 0 })
                }}
                style={{ background: 'transparent', border: 'none', color: 'inherit', font: 'inherit', cursor: 'pointer' }}
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.status} · {s.prompt.slice(0, 28)}
                  </option>
                ))}
              </select>
            ) : session ? (
              wartet ? `wartet auf Eingabe · seit ${wartetSeit}` : `Session ${session.status}`
            ) : (
              'keine Session'
            )}
          </div>
          <div className="pill">
            <i className="ph ph-folder" style={{ fontSize: 12 }} />
            {projects.length} Projekte
          </div>
        </div>
      </header>

      {tab === 'konsole' && (schmal ? schublade !== 'links' : links === 0) && (
        <button
          className="aufklappen"
          style={{ left: 0 }}
          onClick={() => (schmal ? setSchublade('links') : setLinks(270))}
          title="Session-Spalte einblenden"
        >
          <i className="ph ph-caret-right" />
        </button>
      )}
      {tab === 'konsole' && (schmal ? schublade !== 'rechts' : rechts === 0) && (
        <button
          className="aufklappen"
          style={{ right: 0 }}
          onClick={() => (schmal ? setSchublade('rechts') : setRechts(348))}
          title="Live-Feed einblenden"
        >
          <i className="ph ph-caret-left" />
        </button>
      )}
      {tab === 'konsole' && schmal && schublade && (
        <button className="drawer-backdrop" onClick={() => setSchublade(null)} title="Schließen" />
      )}

      {tab === 'konsole' && (!schmal || schublade === 'links') && (
      <aside
        className={`sidebar${schmal ? ' drawer drawer-links' : ''}`}
        style={{ display: !schmal && links === 0 ? 'none' : undefined }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="kicker">{prozessLebt ? 'Laufende Session' : 'Neue Session'}</div>

          {/* Der Projektordner steht im Prozessaufruf und lässt sich nicht
              mehr ändern. Eine bedienbare Auswahl würde das Gegenteil
              behaupten — also steht hier nur noch, was gilt. */}
          {prozessLebt ? (
            <div className="field">
              <label>Projekt · fest</label>
              <div
                className="input"
                style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--color-neutral-400)', cursor: 'default' }}
              >
                <i className="ph ph-lock-simple" style={{ fontSize: 13, flex: 'none' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {projects.find((p) => p.paths.includes(session?.project ?? ''))?.label ??
                    (session?.project ?? '').split('/').slice(-1)[0]}
                </span>
              </div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--color-neutral-600)', marginTop: 4, wordBreak: 'break-all' }}>
                {(session?.project ?? '').replace(/^\/Users\/[^/]+/, '~')}
              </div>
            </div>
          ) : (
          <div className="field">
            <label>Projekt</label>
            <select
              className="input"
              value={projectId}
              onChange={(e) => {
                const entry = projects.find((p) => p.id === e.target.value)
                setProjectId(e.target.value)
                if (entry) setProject(entry.path)
              }}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.repo ? '' : p.git ? ' — ohne Remote' : ' — lokal'}
                </option>
              ))}
            </select>

            {(() => {
              const entry = projects.find((p) => p.id === projectId)
              if (!entry) return null
              if (entry.paths.length > 1) {
                return (
                  <>
                    <select className="input mono" style={{ fontSize: 11, marginTop: 6 }} value={project} onChange={(e) => setProject(e.target.value)}>
                      {entry.paths.map((p) => (
                        <option key={p} value={p}>
                          {p.replace(/^\/Users\/[^/]+/, '~')}
                        </option>
                      ))}
                    </select>
                    <div style={{ fontSize: 10, color: '#c8a06a', marginTop: 4 }}>
                      {entry.paths.length} Arbeitskopien dieses Repos
                    </div>
                  </>
                )
              }
              return (
                <div className="mono" style={{ fontSize: 10, color: 'var(--color-neutral-600)', marginTop: 4, wordBreak: 'break-all' }}>
                  {entry.path.replace(/^\/Users\/[^/]+/, '~')}
                </div>
              )
            })()}
          </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>
              Modell
              {prozessLebt && (
                <span style={{ color: 'var(--color-neutral-600)' }}> · wirkt erst über Übernehmen</span>
              )}
            </div>
            <div className="seg">
              {models.map((m) => (
                <label key={m.id} className="seg-opt">
                  <input
                    type="radio"
                    name="modell"
                    checked={model === m.id}
                    onChange={() => setModel(m.id)}
                    style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
                  />
                  {m.label}
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-400)', marginBottom: 4 }}>Rollen · ~/.claude/agents</div>
            {roles.length === 0 && (
              <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>Keine Rollen gefunden.</div>
            )}
            {roles.map((r) => {
              const on = picked.includes(r.name)
              const imLauf = Boolean(session && prozessLebt && session.roles.includes(r.name))
              // Eine Rolle, die der Session schon mitgegeben wurde, lässt sich
              // nicht mehr herausnehmen. Der Klick war bisher ein stiller
              // Blindgänger — jetzt sieht die Zeile aus, was sie ist: Zustand.
              const festgelegt = prozessLebt && imLauf
              return (
                <button
                  key={r.name}
                  className="rolerow"
                  disabled={festgelegt}
                  style={festgelegt ? { cursor: 'default', opacity: 0.85 } : undefined}
                  title={
                    festgelegt
                      ? `„${r.name}" ist dieser Session mitgegeben und lässt sich nicht mehr entfernen`
                      : prozessLebt
                        ? `„${r.name}" jetzt dazuschalten — die Session bekommt einen Auftrag dafür`
                        : r.description
                  }
                  onClick={() => {
                    if (festgelegt) return
                    if (prozessLebt) {
                      void rolleDazu(r.name)
                      return
                    }
                    setPicked(on ? picked.filter((x) => x !== r.name) : [...picked, r.name])
                  }}
                >
                  <span className="checkbox" data-on={on}>
                    {on && <i className="ph ph-check" style={{ fontSize: 10, color: 'var(--color-accent)' }} />}
                  </span>
                  <i
                    className={`ph ${ROLE_ICONS[r.name] ?? 'ph-robot'}`}
                    style={{ fontSize: 15, color: 'var(--color-neutral-400)' }}
                  />
                  <span style={{ color: on ? 'var(--color-text)' : 'var(--color-neutral-400)', flex: 1 }}>{r.name}</span>
                  {festgelegt && (
                    <i className="ph ph-lock-simple" style={{ fontSize: 11, color: 'var(--color-neutral-600)' }} />
                  )}
                  {prozessLebt && !imLauf && (
                    <span style={{ fontSize: 9.5, color: 'var(--color-accent-300)' }}>+ dazu</span>
                  )}
                </button>
              )
            })}
          </div>

          {prozessLebt && (
            <div style={{ fontSize: 10.5, color: 'var(--color-neutral-500)', lineHeight: 1.5 }}>
              Rollen lassen sich dazuschalten, aber nicht mehr herausnehmen. Modell und
              Auto-Permissions stehen im Prozessaufruf — sie wechseln über <em>Übernehmen</em>, die
              Unterhaltung läuft dabei per <span className="mono">--resume</span> weiter. Der
              Projektordner ist fest.
            </div>
          )}

          {abweichung && (
            <button className="btn btn-primary btn-block" onClick={uebernehmen}>
              <i className="ph ph-arrows-clockwise" />
              Übernehmen · Session fortsetzen
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
              Weitere Anweisungen gehen unten rechts an die laufende Session.
            </div>
          ) : (
            <div className="field">
              <label>Prompt</label>
              <textarea
                className="input"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Was soll die Session tun?"
              />
            </div>
          )}

          <button
            onClick={() => setSkip(!skip)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              padding: '9px 10px',
              border: '1px solid var(--color-divider)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              background: 'transparent',
              color: 'inherit',
              fontFamily: 'inherit',
              textAlign: 'left',
            }}
          >
            <div>
              <div style={{ fontSize: 13 }}>Auto-Permissions</div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--color-neutral-500)' }}>
                --dangerously-skip-permissions
              </div>
            </div>
            <div
              style={{
                width: 34,
                height: 19,
                borderRadius: 99,
                background: skip ? 'rgba(145,132,217,.35)' : 'rgba(233,233,237,.1)',
                border: `1px solid ${skip ? 'var(--color-accent)' : 'var(--color-divider)'}`,
                position: 'relative',
                flex: 'none',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 2,
                  left: skip ? 16 : 2,
                  width: 13,
                  height: 13,
                  borderRadius: '50%',
                  background: skip ? 'var(--color-accent)' : 'var(--color-neutral-600)',
                  transition: 'left .15s ease',
                }}
              />
            </div>
          </button>

          {/* Läuft eine Session, zeigt der Kasten ihren echten Aufruf — nicht
              das, was das Formular gerade eingestellt hat. */}
          <div className="codebox">
            <span style={{ color: 'var(--color-neutral-500)' }}>$ </span>
            {prozessLebt && session ? session.cli : cliPreview}
            {!prozessLebt && <span className="caret" />}
          </div>
          {prozessLebt && abweichung && (
            <div style={{ fontSize: 10, color: '#c8a06a', marginTop: -4 }}>
              Das ist der laufende Aufruf. Die Auswahl oben weicht davon ab.
            </div>
          )}

          {error && <div className="banner">{error}</div>}

          {/* Solange eine Session lebt, gibt es hier nichts zu starten —
              der Knopf war nur ausgegraut und blieb trotzdem stehen. */}
          {!prozessLebt && (
            <button className="btn btn-primary btn-block" onClick={start} disabled={!prompt.trim() || !project}>
              <i className="ph ph-play" />
              Session starten
            </button>
          )}

          {prozessLebt && (
            <button className="btn btn-secondary btn-block" onClick={stop}>
              <i className="ph ph-stop" />
              {wartet ? 'Session beenden' : 'Abbrechen'}
            </button>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="kicker">Automation</div>
          <button className="card" style={{ gap: 4, cursor: 'pointer', textAlign: 'left' }} onClick={() => setTab('hooks')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <i className="ph ph-moon-stars" style={{ color: 'var(--color-accent)', fontSize: 15 }} />
              Nachtlauf · vps02
              <span className="tag tag-outline" style={{ marginLeft: 'auto', fontSize: 10 }}>
                verwalten
              </span>
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>
              cron · claude -p · Report
            </div>
          </button>
          <button className="card" style={{ gap: 4, cursor: 'pointer', textAlign: 'left' }} onClick={() => setTab('hooks')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <i className="ph ph-lightning" style={{ color: 'var(--color-accent)', fontSize: 15 }} />
              Hook · security-reviewer
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>
              Startet automatisch nach Sessions mit Code-Änderungen
            </div>
          </button>
        </div>
      </aside>
      )}

      {tab === 'konsole' && (
        <>
          {/* Feste Spalte: fällt die Sidebar im schmalen Modus aus dem DOM,
              würde die Auto-Platzierung main sonst in die 0px-Spalte schieben. */}
          <main style={{ gridColumn: 2, display: 'flex', flexDirection: 'column', padding: '14px 18px 12px', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px', marginBottom: 6 }}>
              <div style={{ minWidth: 160, flex: '1 1 200px' }}>
                <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 500, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {session ? session.prompt.slice(0, 70) : 'Keine laufende Session'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>
                  {session
                    ? `${session.project.replace(/^\/Users\/[^/]+/, '~')} · ${session.model} · ${session.roles.length} Rollen` +
                      (wartet ? ` · Antwort fertig, wartet seit ${wartetSeit} auf Eingabe` : '')
                    : 'Links Projekt, Modell und Rollen wählen'}
                </div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 16px', fontSize: 12, color: 'var(--color-neutral-400)' }}>
                <div className="seg">
                  <label className="seg-opt" style={{ padding: '4px 10px', fontSize: 12 }}>
                    <input
                      type="radio"
                      name="ansicht"
                      checked={ansicht === 'graph'}
                      onChange={() => setAnsicht('graph')}
                      style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
                    />
                    <i className="ph ph-tree-structure" style={{ fontSize: 13 }} />
                    Rollen
                  </label>
                  <label className="seg-opt" style={{ padding: '4px 10px', fontSize: 12 }}>
                    <input
                      type="radio"
                      name="ansicht"
                      checked={ansicht === 'antwort'}
                      onChange={() => {
                        setAnsicht('antwort')
                        setNeueAntwort(false)
                      }}
                      style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
                    />
                    <i className="ph ph-article" style={{ fontSize: 13 }} />
                    Antwort{antwortenAnzeige.length > 1 ? ` (${antwortenAnzeige.length})` : ''}
                    {neueAntwort && ansicht !== 'antwort' && (
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: 'var(--color-accent)',
                          boxShadow: '0 0 6px rgba(145,132,217,.9)',
                        }}
                      />
                    )}
                  </label>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i className="ph ph-timer" style={{ color: 'var(--color-accent)' }} />
                  {elapsed}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i className="ph ph-coins" style={{ color: 'var(--color-accent)' }} />
                  {fmtTokens(tokens.out)} aus · {fmtTokens(tokens.in)} ein
                </div>
              </div>
            </div>

            {!session ? (
              <div className="leer">
                <div style={{ maxWidth: 380 }}>
                  <i className="ph ph-play-circle" style={{ fontSize: 30, color: 'var(--color-accent)' }} />
                  <div style={{ fontFamily: 'var(--font-heading)', fontSize: 15, margin: '10px 0 6px', color: 'var(--color-text)' }}>
                    Keine laufende Session
                  </div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                    Links Projekt, Modell und Rollen wählen, Auftrag eintippen, starten. Der Verlauf
                    früherer Läufe steht unter <strong style={{ color: 'var(--color-neutral-300)' }}>Verläufe</strong>.
                  </div>
                </div>
              </div>
            ) : ansicht === 'antwort' ? (
              <AnswerView antworten={antwortenAnzeige} wartet={wartet} />
            ) : (
            <AgentGraph
              nodes={
                nodes.length
                  ? nodes
                  : [
                      {
                        id: 'orchestrator',
                        status: 'idle',
                        phase: 'bereit',
                        tokensOut: 0,
                        tokensIn: 0,
                        anfragen: 0,
                        calls: 0,
                        order: 0,
                        auftrag: '',
                        ergebnis: '',
                        volltext: '',
                        bericht: null,
                        quelle: null,
                        startedAt: null,
                        endedAt: null,
                      },
                    ]
              }
              selected={selectedNode}
              onSelect={(id) => setSelectedNode(id === selectedNode ? null : id)}
              detail={detailPanel}
            />
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              {nodes
                .filter((n) => n.id !== 'orchestrator' && n.order)
                .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                .map((n) => (
                  <button
                    key={n.id}
                    onClick={() => setSelectedNode(n.id === selectedNode ? null : n.id)}
                    className="pill"
                    style={{
                      cursor: 'pointer',
                      borderColor: n.status === 'running' ? 'var(--color-accent)' : 'var(--color-divider)',
                      color: n.status === 'idle' ? 'var(--color-neutral-600)' : 'var(--color-neutral-300)',
                    }}
                  >
                    <span style={{ color: 'var(--color-accent)' }}>{n.order}.</span>
                    {n.id}
                    {n.startedAt && n.endedAt && (
                      <span style={{ color: 'var(--color-neutral-600)' }}>
                        {fmtDuration(new Date(n.endedAt).getTime() - new Date(n.startedAt).getTime())}
                      </span>
                    )}
                  </button>
                ))}
              {nodes.some((n) => n.id !== 'orchestrator' && n.order) && (
                <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--color-neutral-600)' }}>
                  Reihenfolge der Beauftragung · Rollen arbeiten isoliert, alles läuft über den Orchestrator
                </span>
              )}
            </div>

            {session && (
              <div className="card" style={{ marginTop: 10, gap: 8, padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <i className="ph ph-flow-arrow" style={{ fontSize: 16, color: 'var(--color-accent)' }} />
                  <div style={{ fontSize: 13, fontWeight: 500 }}>Rollenlauf</div>
                  <div style={{ fontSize: 10.5, color: 'var(--color-neutral-500)', flex: 1, minWidth: 0 }}>
                    {pipelineAktiv
                      ? `läuft · ${session.pipelineRollen?.join(', ') ?? ''}`
                      : 'jede Rolle als eigene Session — unabhängig vom Orchestrator'}
                  </div>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 11, padding: '3px 8px' }}
                    onClick={() => setPipelineOffen(!pipelineOffen)}
                    title="Auftrag und Modell einstellen"
                  >
                    <i className={`ph ${pipelineOffen ? 'ph-caret-up' : 'ph-sliders-horizontal'}`} />
                    {pipelineOffen ? 'zu' : 'einstellen'}
                  </button>
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: 11.5, padding: '4px 10px' }}
                    disabled={pipelineAktiv || !laufRollen.length}
                    onClick={() => void starteRollenlauf()}
                    title={
                      laufRollen.length
                        ? `${laufRollen.join(', ')} auf ${session.project.replace(/^\/Users\/[^/]+/, '~')} laufen lassen`
                        : 'Keine Rolle gewählt'
                    }
                  >
                    <i className={`ph ${pipelineAktiv ? 'ph-circle-notch' : 'ph-play'}`} />
                    {pipelineAktiv ? 'läuft …' : 'starten'}
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
                        disabled={pipelineAktiv}
                        title={r.description}
                        onClick={() =>
                          setLaufRollen(an ? laufRollen.filter((x) => x !== r.name) : [...laufRollen, r.name])
                        }
                      >
                        {r.name}
                      </button>
                    )
                  })}
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--color-neutral-600)' }}>
                    {pipelineMeta?.timeoutSec ? `Zeitgrenze ${pipelineMeta.timeoutSec} s je Rolle` : 'ohne Zeitgrenze'}
                  </span>
                </div>

                {pipelineOffen && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <textarea
                      className="input"
                      style={{ minHeight: 64, fontSize: 11.5 }}
                      value={pipelineAuftrag}
                      onChange={(e) => setPipelineAuftrag(e.target.value)}
                      placeholder={pipelineMeta?.standardAuftrag ?? 'Auftrag an jede Rolle …'}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>Modell</span>
                      <select
                        className="input"
                        style={{ width: 150, fontSize: 11.5, padding: '3px 6px' }}
                        value={pipelineModell}
                        onChange={(e) => setPipelineModell(e.target.value)}
                        title="„je Rolle“ lässt --model weg — dann gilt das model: aus der Rollendatei"
                      >
                        <option value="auto">je Rolle</option>
                        {models.map((m) => (
                          <option key={m.id} value={m.id}>
                            alle auf {m.label}
                          </option>
                        ))}
                      </select>
                      <button
                        className="chip"
                        data-on={pipelineStand}
                        onClick={() => setPipelineStand(!pipelineStand)}
                        title="Der Arbeitsstand wird einmal ermittelt und allen Rollen mitgegeben, statt dass ihn jede selbst zusammensucht"
                      >
                        Stand mitgeben
                      </button>
                      {pipelineAuftrag && (
                        <button
                          className="btn btn-ghost"
                          style={{ fontSize: 10.5, padding: '2px 7px' }}
                          onClick={() => setPipelineAuftrag('')}
                        >
                          Auftrag zurücksetzen
                        </button>
                      )}
                      <span style={{ fontSize: 10.5, color: 'var(--color-neutral-600)', flex: 1, minWidth: 180 }}>
                        Leerer Auftrag = Prüfung des uncommitteten Stands. Jeder andere Text geht jeder Rolle
                        wörtlich zu.
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

          </main>

          {(!schmal || schublade === 'rechts') && (
          <section
            className={schmal ? 'drawer drawer-rechts' : undefined}
            style={{
              display: 'flex',
              flexDirection: 'column',
              padding: '14px 16px 12px',
              minWidth: 0,
              overflowY: schmal ? 'auto' : undefined,
              background:
                'linear-gradient(to bottom,transparent,rgba(233,233,237,.12) 48px,rgba(233,233,237,.12) calc(100% - 48px),transparent) no-repeat left / 1px 100%',
            }}
          >
            {unterbrochen && (
              <div
                style={{
                  marginBottom: 10,
                  border: '1px solid #c8a06a',
                  background: 'rgba(200,160,106,.1)',
                  borderRadius: 'var(--radius-md)',
                  padding: '8px 10px',
                  fontSize: 11.5,
                  color: '#e2c79b',
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                <span style={{ flex: 1 }}>
                  Session unterbrochen — der Serverprozess ist gegangen. Die Unterhaltung liegt noch bei
                  Claude.
                </span>
                <button className="btn btn-secondary" style={{ fontSize: 11, padding: '3px 9px' }} onClick={fortsetzen}>
                  fortsetzen
                </button>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              <div
                className="card"
                style={{ gap: 1, padding: '9px 11px' }}
                title="Ausgabe und frische Eingabe sind neu verarbeitet. Cache-Schreiben kostet extra, Cache-Lesen ist billig und wird bei jeder Anfrage erneut gemeldet."
              >
                <div className="kicker">Tokens</div>
                <div style={{ fontSize: 15, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtTokens(tokens.out)} <span style={{ fontSize: 10, color: 'var(--color-neutral-500)' }}>aus</span>
                </div>
                <div style={{ fontSize: 9.5, color: 'var(--color-neutral-600)', lineHeight: 1.5 }}>
                  {fmtTokens(tokens.in)} ein · Cache {fmtTokens(tokens.cacheWrite)}↑ {fmtTokens(tokens.cached)}↓
                  <br />
                  {tokens.anfragen} Anfragen
                </div>
              </div>
              <div className="card" style={{ gap: 1, padding: '9px 11px' }}>
                <div className="kicker">Dauer</div>
                <div style={{ fontSize: 15, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{elapsed}</div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div className="kicker">Live-Feed</div>
              {arbeitet && (
                <span
                  style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-accent)', animation: 'nfPulse 1.6s infinite' }}
                />
              )}
              {wartet && <span className="tag tag-outline" style={{ fontSize: 9.5 }}>wartet</span>}
              <div className="mono" style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--color-neutral-600)' }}>
                stream-json
              </div>
            </div>

            <div className="toolbar" style={{ marginBottom: 6 }}>
              {(['alles', 'werkzeuge', 'rollen'] as const).map((f) => (
                <button key={f} className="chip" data-on={feedFilter === f} onClick={() => setFeedFilter(f)}>
                  {f}
                </button>
              ))}
              <span className="muted" style={{ marginLeft: 'auto', fontSize: 10 }}>
                {gefiltert.length} von {log.length}
              </span>
            </div>

            <div className="feed" ref={feedRef}>
              {gefiltert.length === 0 && <div style={{ color: 'var(--color-neutral-600)' }}>— nichts in dieser Auswahl —</div>}
              {gefiltert.map((l, i) => {
                const vorher = gefiltert[i - 1]
                const neuerSprecher = !vorher || vorher.agent !== l.agent
                return (
                  <div key={i} className={neuerSprecher ? 'feedgroup' : undefined}>
                    {neuerSprecher && (
                      <div
                        className="feedagent"
                        style={{ color: l.kind === 'error' ? '#e08c92' : l.agent === 'orchestrator' ? 'var(--color-accent)' : undefined }}
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
              <div
                style={{
                  marginTop: 10,
                  border: '1px solid #c8a06a',
                  background: 'rgba(200,160,106,.1)',
                  borderRadius: 'var(--radius-md)',
                  padding: '8px 10px',
                  fontSize: 11.5,
                  color: '#e2c79b',
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                <span style={{ flex: 1 }}>
                  Diese Runde lief ohne Rolle — kein Review erfolgt. Der Rollenlauf holt es nach, ohne den
                  Orchestrator zu fragen.
                </span>
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: 11, padding: '3px 9px' }}
                  disabled={pipelineAktiv}
                  onClick={() => void starteRollenlauf(session?.roles ?? [])}
                >
                  Rollenlauf starten
                </button>
              </div>
            )}
            {wartet && (
              <div
                style={{
                  marginTop: 10,
                  border: '1px solid #c8a06a',
                  background: 'rgba(200,160,106,.1)',
                  borderRadius: 'var(--radius-md)',
                  padding: '7px 10px',
                  fontSize: 11.5,
                  color: '#e2c79b',
                }}
              >
                Antwort liegt vor — die Session wartet seit {wartetSeit} auf deine Rückmeldung.
              </div>
            )}
            <div className="toolbar" style={{ marginTop: 8 }}>
              <span className="muted" style={{ fontSize: 10 }}>mitschicken:</span>
              {roles.map((r) => {
                const an = mitRollen.includes(r.name)
                return (
                  <button
                    key={r.name}
                    className="chip"
                    data-on={an}
                    title={`Nachricht weist den Orchestrator an, „${r.name}" zu beauftragen`}
                    onClick={() => setMitRollen(an ? mitRollen.filter((x) => x !== r.name) : [...mitRollen, r.name])}
                  >
                    {r.name.replace('-', ' ')}
                  </button>
                )
              })}
              <button
                className="chip"
                data-on={mitRollen.length === roles.length && roles.length > 0}
                onClick={() => setMitRollen(mitRollen.length === roles.length ? [] : roles.map((r) => r.name))}
              >
                alle
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input
                className="input"
                placeholder={wartet ? 'Antworten und weitermachen …' : 'Nachricht an die Session …'}
                value={draft}
                disabled={!running}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
                style={{ flex: 1 }}
              />
              <button className="btn btn-primary btn-icon" onClick={send} disabled={!running} title="Senden">
                <i className="ph ph-paper-plane-tilt" />
              </button>
            </div>
          </section>
          )}
        </>
      )}

      {tab === 'verlaeufe' && <RunsView />}
      {tab === 'hooks' && <HooksView />}
    </div>
  )
}
