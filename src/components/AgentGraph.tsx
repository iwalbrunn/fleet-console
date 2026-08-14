'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { fmtTokens, type GraphNode } from '@/lib/types'

const ICONS: Record<string, string> = {
  orchestrator: 'ph-tree-structure',
  'security-reviewer': 'ph-shield-check',
  'senior-developer': 'ph-code',
  'project-manager': 'ph-kanban',
  'business-analyst': 'ph-clipboard-text',
  'ux-ui-expert': 'ph-layout',
}

function icon(id: string) {
  return ICONS[id] ?? 'ph-robot'
}

interface Teilchen {
  x: number
  y: number
  vx: number
  vy: number
}

/** Farbe je Zustand — Zeitgrenze bekommt einen eigenen Ton, sie ist kein
 *  Fehler der Rolle. */
function statusFarbe(status: GraphNode['status']): string {
  if (status === 'running') return '#b5abfc'
  if (status === 'done') return '#d2cefd'
  if (status === 'error') return '#e08c92'
  if (status === 'timeout') return '#e2c79b'
  return '#75798c'
}

function punktFarbe(status: GraphNode['status']): string {
  if (status === 'running') return '#9184d9'
  if (status === 'done') return '#d2cefd'
  if (status === 'error') return '#b4545a'
  if (status === 'timeout') return '#c8a06a'
  return '#595d6c'
}

export default function AgentGraph({
  nodes,
  selected,
  onSelect,
  detail,
}: {
  nodes: GraphNode[]
  selected: string | null
  onSelect: (id: string) => void
  /** Seitenpanel, das über der Bühne liegt. */
  detail?: ReactNode
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const nodeRefs = useRef(new Map<string, HTMLDivElement>())
  const nodesRef = useRef(nodes)
  const prevStatus = useRef(new Map<string, string>())
  /** Knoten, die gerade zurückgemeldet haben → kurz fließt es zurück. */
  const burstUntil = useRef(new Map<string, number>())
  /** Physik: Ort und Geschwindigkeit je Knoten. Lebt über Renders hinweg. */
  const sim = useRef(new Map<string, Teilchen>())

  useEffect(() => {
    nodesRef.current = nodes
    for (const n of nodes) {
      const vorher = prevStatus.current?.get(n.id)
      if (vorher === 'running' && n.status !== 'running' && n.status !== 'idle') {
        burstUntil.current?.set(n.id, Date.now() + 2200)
      }
      prevStatus.current?.set(n.id, n.status)
    }
  }, [nodes])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    const stroeme = new Map<string, { t: number; v: number }[]>()
    const DICHTE = 12

    /** Neue Knoten kommen auf einem Bogen rechts vom Orchestrator dazu,
     *  damit die Simulation sie nicht erst auseinandertreiben muss. */
    const sorgeFuerTeilchen = (W: number, H: number) => {
      const agenten = nodesRef.current.filter((n) => n.id !== 'orchestrator')
      if (!sim.current.has('orchestrator')) {
        sim.current.set('orchestrator', { x: W * 0.3, y: H * 0.5, vx: 0, vy: 0 })
      }
      agenten.forEach((n, i) => {
        if (sim.current.has(n.id)) return
        const winkel = -Math.PI / 2 + (i * (Math.PI * 2)) / Math.max(1, agenten.length)
        sim.current.set(n.id, {
          x: W * 0.55 + Math.cos(winkel) * H * 0.28,
          y: H * 0.5 + Math.sin(winkel) * H * 0.3,
          vx: 0,
          vy: 0,
        })
      })
      // Knoten, die es nicht mehr gibt, aus der Physik nehmen
      const bekannt = new Set(nodesRef.current.map((n) => n.id))
      for (const id of [...sim.current.keys()]) if (!bekannt.has(id)) sim.current.delete(id)
    }

    /** Ein Schritt: Abstoßung zwischen allen, Federn entlang der
     *  Verbindungen, sanfter Zug auf die Wunschseite, Zittern bei Arbeit. */
    const schritt = (W: number, H: number): number => {
      const ids = [...sim.current.keys()]

      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = sim.current.get(ids[i])!
          const b = sim.current.get(ids[j])!
          let dx = b.x - a.x
          let dy = b.y - a.y
          const d2 = dx * dx + dy * dy || 1
          const d = Math.sqrt(d2)
          const f = Math.min(8, 26000 / d2)
          dx /= d
          dy /= d
          a.vx -= dx * f
          a.vy -= dy * f
          b.vx += dx * f
          b.vy += dy * f
        }
      }

      const orch = sim.current.get('orchestrator')
      if (orch) {
        for (const id of ids) {
          if (id === 'orchestrator') continue
          const b = sim.current.get(id)!
          const dx = b.x - orch.x
          const dy = b.y - orch.y
          const d = Math.sqrt(dx * dx + dy * dy) || 1
          const f = (d - 235) * 0.004
          orch.vx += (dx / d) * f
          orch.vy += (dy / d) * f
          b.vx -= (dx / d) * f
          b.vy -= (dy / d) * f
        }
      }

      let energie = 0
      for (const id of ids) {
        const t = sim.current.get(id)!
        const istOrch = id === 'orchestrator'
        t.vx += (W * (istOrch ? 0.3 : 0.55) - t.x) * (istOrch ? 0.012 : 0.0012)
        t.vy += (H * 0.5 - t.y) * (istOrch ? 0.012 : 0.0018)

        const knoten = nodesRef.current.find((n) => n.id === id)
        if (knoten?.status === 'running') {
          t.vx += (Math.random() - 0.5) * 0.9
          t.vy += (Math.random() - 0.5) * 0.9
        }
        t.vx *= 0.86
        t.vy *= 0.86
        energie += Math.abs(t.vx) + Math.abs(t.vy)
        t.x = Math.max(95, Math.min(Math.max(96, W - 95), t.x + t.vx))
        t.y = Math.max(48, Math.min(Math.max(49, H - 54), t.y + t.vy))

        const el = nodeRefs.current.get(id)
        if (el?.isConnected)
          el.style.transform = `translate(${t.x}px,${t.y}px) translate(-50%,-50%)`
      }
      return energie
    }

    // Ruht die Zeichnung? Ohne das läuft die Physik auch dann mit 60 Bildern
    // je Sekunde, wenn sich nichts mehr rührt — und die Chips bleiben ein
    // bewegliches Ziel, das man kaum treffen kann.
    let ruhig = 0
    let signatur = ''

    const zeichne = () => {
      raf = requestAnimationFrame(zeichne)
      if (!canvas.isConnected) return
      const dpr = window.devicePixelRatio || 1
      const W = wrap.clientWidth
      const H = wrap.clientHeight
      if (!W || !H) return

      // Jede Änderung an Bestand oder Zustand weckt die Simulation wieder auf.
      const neu = nodesRef.current.map((n) => `${n.id}:${n.status}`).join('|')
      if (neu !== signatur) {
        signatur = neu
        ruhig = 0
      }
      if (ruhig > 40) return
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr)
        canvas.height = Math.round(H * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)

      sorgeFuerTeilchen(W, H)
      const energie = schritt(W, H)
      const arbeitet = nodesRef.current.some((n) => n.status === 'running')
      const rueckfluss = [...burstUntil.current.values()].some((t) => t > Date.now())
      ruhig = !arbeitet && !rueckfluss && energie < 0.4 ? ruhig + 1 : 0

      // Halo unter den arbeitenden Knoten
      for (const n of nodesRef.current) {
        if (n.status !== 'running') continue
        const p = sim.current.get(n.id)
        if (!p) continue
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 64)
        g.addColorStop(0, 'rgba(145,132,217,.14)')
        g.addColorStop(1, 'rgba(145,132,217,0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(p.x, p.y, 64, 0, Math.PI * 2)
        ctx.fill()
      }

      const orch = sim.current.get('orchestrator')
      if (!orch) return

      for (const n of nodesRef.current) {
        if (n.id === 'orchestrator') continue
        const ziel = sim.current.get(n.id)
        if (!ziel) continue

        const rueck = (burstUntil.current.get(n.id) ?? 0) > Date.now()
        const laeuft = n.status === 'running'
        const fertig = n.status !== 'running' && n.status !== 'idle'
        const aktiv = laeuft || rueck

        const A = rueck ? ziel : orch
        const B = rueck ? orch : ziel
        const dx = (B.x - A.x) * 0.5
        const punkt = (u: number) => {
          const g = 1 - u
          return {
            x:
              g * g * g * A.x +
              3 * g * g * u * (A.x + dx) +
              3 * g * u * u * (B.x - dx) +
              u * u * u * B.x,
            y: g * g * g * A.y + 3 * g * g * u * A.y + 3 * g * u * u * B.y + u * u * u * B.y,
          }
        }

        ctx.beginPath()
        ctx.moveTo(A.x, A.y)
        ctx.bezierCurveTo(A.x + dx, A.y, B.x - dx, B.y, B.x, B.y)
        ctx.strokeStyle = aktiv
          ? 'rgba(145,132,217,0.35)'
          : fertig
            ? 'rgba(145,132,217,0.14)'
            : 'rgba(233,233,237,0.06)'
        ctx.lineWidth = aktiv ? 1.2 : 1
        ctx.stroke()

        const schluessel = `${rueck ? n.id : 'orchestrator'}>${rueck ? 'orchestrator' : n.id}`
        if (!aktiv) {
          stroeme.delete(schluessel)
          continue
        }

        let strom = stroeme.get(schluessel)
        if (!strom) {
          strom = Array.from({ length: DICHTE }, () => ({
            t: Math.random(),
            v: 0.003 + Math.random() * 0.004,
          }))
          stroeme.set(schluessel, strom)
        }

        ctx.save()
        ctx.shadowColor = '#9184d9'
        ctx.shadowBlur = 9
        for (const teilchen of strom) {
          teilchen.t += teilchen.v * (rueck ? 1.8 : 1)
          if (teilchen.t > 1) teilchen.t -= 1
          const pt = punkt(teilchen.t)
          ctx.beginPath()
          ctx.arc(pt.x, pt.y, 1.1 + teilchen.v * 260, 0, Math.PI * 2)
          const helligkeit = 0.35 + 0.6 * Math.sin(Math.PI * teilchen.t)
          ctx.fillStyle = rueck
            ? `rgba(226,220,255,${helligkeit})`
            : `rgba(213,206,253,${helligkeit})`
          ctx.fill()
        }
        ctx.restore()
      }
    }

    raf = requestAnimationFrame(zeichne)
    return () => cancelAnimationFrame(raf)
  }, [])

  const orchestrator = nodes.find((n) => n.id === 'orchestrator')
  const agents = nodes.filter((n) => n.id !== 'orchestrator')

  const chip = (
    status: GraphNode['status'],
    gewaehlt: boolean,
    gross: boolean
  ): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: gross ? 9 : 8,
    padding: gross ? '7px 15px 7px 8px' : '7px 13px',
    borderRadius: 99,
    cursor: 'pointer',
    background: 'rgba(35,37,50,.94)',
    backdropFilter: 'blur(3px)',
    border: gewaehlt
      ? '1px solid #d2cefd'
      : status === 'running'
        ? '1px solid rgba(145,132,217,.7)'
        : `1px solid ${status === 'error' ? '#b4545a' : status === 'timeout' ? '#c8a06a' : 'var(--color-divider)'}`,
    boxShadow: status === 'running' ? '0 0 26px rgba(145,132,217,.3)' : 'var(--shadow-sm)',
    opacity: status === 'idle' ? 0.75 : 1,
    transition: 'border-color .4s, box-shadow .4s, opacity .4s',
    color: 'inherit',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  })

  const punkt = (status: GraphNode['status']): React.CSSProperties => ({
    flex: 'none',
    width: 8,
    height: 8,
    borderRadius: '50%',
    marginLeft: 'auto',
    background: punktFarbe(status),
    boxShadow: status === 'running' ? '0 0 10px rgba(145,132,217,.9)' : 'none',
    animation: status === 'running' ? 'nfPulse 1.6s infinite' : 'none',
  })

  return (
    <div ref={wrapRef} className="stage">
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />

      {orchestrator && (
        <div
          ref={(el) => {
            if (el) nodeRefs.current.set('orchestrator', el)
          }}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            willChange: 'transform',
            transform: 'translate(-300px,-300px)',
          }}
        >
          <button
            style={chip(orchestrator.status, selected === 'orchestrator', true)}
            onClick={() => onSelect('orchestrator')}
          >
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                background: 'rgba(145,132,217,.14)',
                border: '1px solid rgba(145,132,217,.5)',
                flex: 'none',
              }}
            >
              <i
                className="ph ph-tree-structure"
                style={{ fontSize: 17, color: 'var(--color-accent)' }}
              />
            </div>
            <div style={{ minWidth: 0, textAlign: 'left' }}>
              <div style={{ fontSize: 12.5, fontWeight: 500 }}>orchestrator</div>
              <div
                style={{
                  fontSize: 9.5,
                  color: 'var(--color-neutral-500)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 150,
                }}
              >
                {orchestrator.phase || '—'}
              </div>
            </div>
            <span style={punkt(orchestrator.status)} />
          </button>
        </div>
      )}

      {agents.map((n) => (
        <div
          key={n.id}
          ref={(el) => {
            if (el) nodeRefs.current.set(n.id, el)
          }}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            willChange: 'transform',
            transform: 'translate(-300px,-300px)',
          }}
        >
          <button
            style={chip(n.status, selected === n.id, false)}
            onClick={() => onSelect(n.id)}
            title={n.ergebnis || n.auftrag}
          >
            <i
              className={`ph ${icon(n.id)}`}
              style={{ fontSize: 15, color: statusFarbe(n.status), flex: 'none' }}
            />
            <span style={{ fontSize: 11.5, fontWeight: 500 }}>{n.id}</span>
            {n.order ? (
              <span style={{ fontSize: 9.5, color: 'var(--color-neutral-500)' }}>
                {n.order}.{n.calls > 1 ? ` ${n.calls}×` : ''}
              </span>
            ) : null}
            <span style={punkt(n.status)} />
          </button>
          {/* Phase steht unter dem Chip und erscheint nur, solange gearbeitet
              wird — sonst flimmert der Graph vor Text. */}
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              marginTop: 5,
              fontSize: 10,
              color: 'var(--color-neutral-400)',
              whiteSpace: 'nowrap',
              textAlign: 'center',
              pointerEvents: 'none',
              maxWidth: 220,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              opacity: n.status === 'running' ? 1 : 0,
              transition: 'opacity .4s',
            }}
          >
            {n.phase}
            {n.tokensOut ? ` · ${fmtTokens(n.tokensOut)} aus` : ''}
          </div>
        </div>
      ))}

      {detail}
    </div>
  )
}
