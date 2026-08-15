'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import AgentGraph from '@/components/AgentGraph'
import AnswerView from '@/components/AnswerView'
import RunsView from '@/components/RunsView'
import { NodeDetailPanel } from '@/components/NodeDetailPanel'
import { RoleRunCard } from '@/components/RoleRunCard'
import { SessionFeed } from '@/components/SessionFeed'
import { SessionSidebar } from '@/components/SessionSidebar'
import { Topbar, type Tab } from '@/components/Topbar'
import {
  fmtDuration,
  fmtTokens,
  type Anforderung,
  type FeedLine,
  type GraphNode,
  type ProjectEntry,
  type Role,
  type SessionState,
} from '@/lib/types'

export default function Page() {
  const t = useTranslations()
  const sessionStatusLabel: Record<SessionState['status'], string> = {
    startet: t('session.statusStartet'),
    läuft: t('session.statusLaeuft'),
    fertig: t('session.statusFertig'),
    fehler: t('session.statusFehler'),
    abgebrochen: t('session.statusAbgebrochen'),
    unterbrochen: t('session.statusUnterbrochen'),
  }
  const [tab, setTab] = useState<Tab>('konsole')

  const [projects, setProjects] = useState<ProjectEntry[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [models, setModels] = useState<{ id: string; label: string }[]>([])

  const [projectId, setProjectId] = useState('')
  const [project, setProject] = useState('') // gewählte Arbeitskopie
  // Standard ist das stärkste Modell — die Umsetzung trägt die Session,
  // gespart wird bei den Prüfrollen, nicht beim Orchestrator.
  const [model, setModel] = useState('fable')
  const [picked, setPicked] = useState<string[]>([])
  const [prompt, setPrompt] = useState('')
  const [skip, setSkip] = useState(false)
  const [worktree, setWorktree] = useState(false)
  /** Session-Id, deren offene Anforderungen die nächste Session übernimmt. */
  const [uebergabeVon, setUebergabeVon] = useState<string | null>(null)

  const [session, setSession] = useState<SessionState | null>(null)
  const [sessions, setSessions] = useState<SessionState[]>([])
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [log, setLog] = useState<FeedLine[]>([])
  const [tokens, setTokens] = useState({ in: 0, out: 0, cached: 0, cacheWrite: 0, anfragen: 0, kosten: 0 })
  const [anforderungen, setAnforderungen] = useState<Anforderung[]>([])
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [ansicht, setAnsicht] = useState<'graph' | 'antwort'>('graph')
  const [neueAntwort, setNeueAntwort] = useState(false)
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

  const sessionAnzeigen = useCallback((s: SessionState) => {
    setSession(s)
    setNodes(s.nodes)
    setLog(s.log)
    setAntworten(s.antworten ?? [])
    setTokens({ in: s.tokensIn, out: s.tokensOut, cached: s.tokensCached, cacheWrite: s.tokensCacheWrite ?? 0, anfragen: s.anfragen ?? 0, kosten: s.kostenUsd ?? 0 })
  }, [])

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
          sessionAnzeigen(wieder)
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
  }, [sessionAnzeigen])

  useEffect(() => {
    const uhr = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(uhr)
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
      setTokens({ in: s.tokensIn, out: s.tokensOut, cached: s.tokensCached, cacheWrite: s.tokensCacheWrite ?? 0, anfragen: s.anfragen ?? 0, kosten: s.kostenUsd ?? 0 })
      setAnforderungen(s.anforderungen ?? [])
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
    es.addEventListener('tokens', (e) => setTokens((alt) => ({ ...alt, ...JSON.parse((e as MessageEvent).data) })))
    es.addEventListener('anforderungen', (e) => setAnforderungen(JSON.parse((e as MessageEvent).data)))
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
      body: JSON.stringify({ project, model, roles: picked, prompt, skipPermissions: skip, worktree, uebergabeVon: uebergabeVon ?? undefined }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? t('errors.startFailed'))
      return
    }
    setUebergabeVon(null)
    setSessions((prev) => [data.session, ...prev])
    sessionAnzeigen(data.session)
    setTab('konsole')
  }, [project, model, picked, prompt, skip, worktree, uebergabeVon, sessionAnzeigen, t])

  /** Übergabe: beendete Session → frische Session mit vollem Kontext-Reset.
   *  Die offenen Anforderungen wandern in den Prompt UND (serverseitig) in
   *  die Anforderungsliste der neuen Session. */
  const uebergabeVorbereiten = () => {
    if (!session) return
    const offene = anforderungen.filter((a) => a.status === 'offen')
    const liste = offene.map((a) => `- ${a.text.split('\n')[0].slice(0, 200)}`).join('\n')
    setUebergabeVon(session.id)
    setPrompt(t('handover.promptIntro') + (liste ? `\n\n${liste}` : ''))
    setModel(session.model)
    setPicked(session.roles)
    setProject(session.project)
  }

  const send = async () => {
    if (!session || !draft.trim()) return
    // Folgenachrichten gehen unverändert an den Orchestrator. Früher hing
    // hier ein Delegations-Anhang dran — der hat aus jedem „ja bitte" eine
    // volle Review-Runde gemacht. Reviews laufen jetzt über den Rollenlauf.
    const text = draft.trim()
    setDraft('')
    await fetch(`/api/sessions/${session.id}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  }

  /** Rollenlauf: jede gewählte Rolle bekommt eine eigene Session auf dem
   *  Projekt. Läuft unabhängig davon, ob der Orchestrator delegieren will —
   *  das ist der Unterschied zum Anhängen von Text an die Nachricht. */
  const starteRollenlauf = async (rollen?: string[]) => {
    if (!session) return
    const gewaehlt = (rollen ?? laufRollen).filter(Boolean)
    if (!gewaehlt.length) {
      setError(t('roleRun.noRoleError'))
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
    if (!res.ok) setError((await res.json()).error ?? t('errors.roleRunFailed'))
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
      setError(data.error ?? t('errors.resumeFailed'))
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
    if (!res.ok) setError((await res.json()).error ?? t('errors.applyFailed'))
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
        title={t('layout.resizerTitle')}
      />
      )}
      {tab === 'konsole' && !schmal && (
      <div
        className="resizer"
        style={{ right: rechts - 3 }}
        onPointerDown={ziehen('rechts')}
        onDoubleClick={() => setRechts(rechts > 0 ? 0 : 348)}
        title={t('layout.resizerTitle')}
      />
      )}

      <Topbar
        tab={tab}
        onTab={setTab}
        session={session}
        sessions={sessions}
        onSession={sessionAnzeigen}
        arbeitet={arbeitet}
        wartet={wartet}
        wartetSeit={wartetSeit}
        statusLabel={sessionStatusLabel}
        projektAnzahl={projects.length}
      />

      {tab === 'konsole' && (schmal ? schublade !== 'links' : links === 0) && (
        <button
          className="aufklappen"
          style={{ left: 0 }}
          onClick={() => (schmal ? setSchublade('links') : setLinks(270))}
          title={t('layout.showSidebar')}
        >
          <i className="ph ph-caret-right" />
        </button>
      )}
      {tab === 'konsole' && (schmal ? schublade !== 'rechts' : rechts === 0) && (
        <button
          className="aufklappen"
          style={{ right: 0 }}
          onClick={() => (schmal ? setSchublade('rechts') : setRechts(348))}
          title={t('layout.showFeed')}
        >
          <i className="ph ph-caret-left" />
        </button>
      )}
      {tab === 'konsole' && schmal && schublade && (
        <button className="drawer-backdrop" onClick={() => setSchublade(null)} title={t('layout.close')} />
      )}

      {tab === 'konsole' && (!schmal || schublade === 'links') && (
      <aside
        className={`sidebar${schmal ? ' drawer drawer-links' : ''}`}
        style={{ display: !schmal && links === 0 ? 'none' : undefined }}
      >
        <SessionSidebar
          session={session}
          prozessLebt={prozessLebt}
          wartet={wartet}
          abweichung={abweichung}
          error={error}
          projects={projects}
          projectId={projectId}
          project={project}
          onProject={(id, path) => {
            setProjectId(id)
            setProject(path)
          }}
          onWorkingCopy={setProject}
          models={models}
          model={model}
          onModel={setModel}
          roles={roles}
          picked={picked}
          onPicked={setPicked}
          prompt={prompt}
          onPrompt={setPrompt}
          skip={skip}
          onSkip={() => setSkip(!skip)}
          worktree={worktree}
          onWorktree={() => setWorktree(!worktree)}
          cliPreview={cliPreview}
          onStart={() => void start()}
          onStop={() => void stop()}
          onApply={() => void uebernehmen()}
        />
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
                  {session ? session.prompt.slice(0, 70) : t('console.noSession')}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>
                  {session
                    ? `${session.project.replace(/^\/Users\/[^/]+/, '~')} · ${session.model} · ${t('console.rolesCount', { count: session.roles.length })}` +
                      (wartet ? ` ${t('console.answerReady', { time: wartetSeit ?? '' })}` : '')
                    : t('console.chooseLeft')}
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
                    {t('console.viewRoles')}
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
                    {t('console.viewAnswer')}{antwortenAnzeige.length > 1 ? ` (${antwortenAnzeige.length})` : ''}
                    {neueAntwort && ansicht !== 'antwort' && (
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: 'var(--color-accent)',
                          boxShadow: '0 0 6px color-mix(in srgb, var(--color-accent) 90%, transparent)',
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
                  {fmtTokens(tokens.out)} {t('stats.out')} · {fmtTokens(tokens.in)} {t('stats.in')}
                </div>
              </div>
            </div>

            {!session ? (
              <div className="leer">
                <div style={{ maxWidth: 380 }}>
                  <i className="ph ph-play-circle" style={{ fontSize: 30, color: 'var(--color-accent)' }} />
                  <div style={{ fontFamily: 'var(--font-heading)', fontSize: 15, margin: '10px 0 6px', color: 'var(--color-text)' }}>
                    {t('console.noSession')}
                  </div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                    {t('console.emptyHint')}{' '}
                    <strong style={{ color: 'var(--color-neutral-300)' }}>{t('navigation.history')}</strong>.
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
                        kostenUsd: 0,
                        befunde: null,
                        nachpruefungen: 0,
                      },
                    ]
              }
              selected={selectedNode}
              onSelect={(id) => setSelectedNode(id === selectedNode ? null : id)}
              detail={detail ? (
                <NodeDetailPanel detail={detail} roles={roles} now={now} onClose={() => setSelectedNode(null)} />
              ) : null}
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
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-neutral-600)' }}>
                  {t('console.orderNote')}
                </span>
              )}
            </div>

            {session && (
              <RoleRunCard
                session={session}
                roles={roles}
                models={models}
                meta={pipelineMeta}
                aktiv={pipelineAktiv}
                laufRollen={laufRollen}
                onLaufRollen={setLaufRollen}
                auftrag={pipelineAuftrag}
                onAuftrag={setPipelineAuftrag}
                modell={pipelineModell}
                onModell={setPipelineModell}
                stand={pipelineStand}
                onStand={() => setPipelineStand(!pipelineStand)}
                offen={pipelineOffen}
                onOffen={setPipelineOffen}
                onStart={() => void starteRollenlauf()}
              />
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
                'linear-gradient(to bottom,transparent,color-mix(in srgb, var(--color-text) 12%, transparent) 48px,color-mix(in srgb, var(--color-text) 12%, transparent) calc(100% - 48px),transparent) no-repeat left / 1px 100%',
            }}
          >
            <SessionFeed
              session={session}
              prozessLebt={prozessLebt}
              arbeitet={arbeitet}
              wartet={wartet}
              wartetSeit={wartetSeit}
              unterbrochen={Boolean(unterbrochen)}
              ohneRolle={ohneRolle}
              pipelineAktiv={pipelineAktiv}
              tokens={tokens}
              elapsed={elapsed}
              anforderungen={anforderungen}
              log={log}
              feedRef={feedRef}
              draft={draft}
              onDraft={setDraft}
              onSend={() => void send()}
              onResume={() => void fortsetzen()}
              onHandover={uebergabeVorbereiten}
              onRoleRun={() => void starteRollenlauf(session?.roles ?? [])}
            />
          </section>
          )}
        </>
      )}

      {tab === 'verlaeufe' && <RunsView />}
    </div>
  )
}
