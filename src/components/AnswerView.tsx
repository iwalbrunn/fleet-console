'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { fmtTime } from '@/lib/types'

/**
 * Minimaler Markdown-Renderer für das, was Claude tatsächlich schreibt:
 * Überschriften, Listen, Codeblöcke, fett, `code`. Bewusst ohne Bibliothek und
 * ohne `dangerouslySetInnerHTML` — der Text kann aus fremden Dateien stammen,
 * deshalb wird nichts als HTML interpretiert.
 */
function inline(text: string, key: string) {
  // **fett** und `code` auszeichnen, alles andere bleibt Text
  const teile = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return teile.map((teil, i) => {
    if (teil.startsWith('**') && teil.endsWith('**')) {
      return (
        <strong key={`${key}-${i}`} style={{ fontWeight: 600, color: 'var(--color-text)' }}>
          {teil.slice(2, -2)}
        </strong>
      )
    }
    if (teil.startsWith('`') && teil.endsWith('`') && teil.length > 2) {
      return (
        <code
          key={`${key}-${i}`}
          style={{
            fontFamily: 'ui-monospace, Menlo, monospace',
            fontSize: '0.92em',
            background: 'color-mix(in srgb, var(--color-text) 7%, transparent)',
            borderRadius: 4,
            padding: '1px 5px',
            color: 'var(--color-accent-300)',
          }}
        >
          {teil.slice(1, -1)}
        </code>
      )
    }
    return <span key={`${key}-${i}`}>{teil}</span>
  })
}

function Markdown({ text }: { text: string }) {
  const zeilen = text.split('\n')
  const blocks: React.ReactNode[] = []
  let liste: string[] = []
  let code: string[] | null = null

  const listeSchliessen = () => {
    if (!liste.length) return
    blocks.push(
      <ul key={`ul-${blocks.length}`} style={{ margin: '6px 0 10px', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {liste.map((l, i) => (
          <li key={i} style={{ lineHeight: 1.6 }}>
            {inline(l, `li-${blocks.length}-${i}`)}
          </li>
        ))}
      </ul>,
    )
    liste = []
  }

  zeilen.forEach((zeile, index) => {
    if (zeile.trim().startsWith('```')) {
      if (code === null) {
        listeSchliessen()
        code = []
      } else {
        blocks.push(
          <pre
            key={`pre-${index}`}
            style={{
              background: 'var(--color-code-bg)',
              border: '1px solid var(--color-divider)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 12px',
              fontSize: 11.5,
              lineHeight: 1.6,
              overflowX: 'auto',
              margin: '8px 0 12px',
              color: 'var(--color-neutral-300)',
            }}
          >
            {code.join('\n')}
          </pre>,
        )
        code = null
      }
      return
    }
    if (code !== null) {
      code.push(zeile)
      return
    }

    const ueberschrift = zeile.match(/^(#{1,4})\s+(.*)$/)
    if (ueberschrift) {
      listeSchliessen()
      const stufe = ueberschrift[1].length
      blocks.push(
        <div
          key={`h-${index}`}
          style={{
            fontFamily: 'var(--font-heading)',
            fontWeight: 500,
            fontSize: stufe <= 1 ? 18 : stufe === 2 ? 16 : 14,
            margin: blocks.length ? '16px 0 6px' : '0 0 6px',
          }}
        >
          {inline(ueberschrift[2], `h-${index}`)}
        </div>,
      )
      return
    }

    const punkt = zeile.match(/^\s*[-*•]\s+(.*)$/) || zeile.match(/^\s*\d+\.\s+(.*)$/)
    if (punkt) {
      liste.push(punkt[1])
      return
    }

    if (!zeile.trim()) {
      listeSchliessen()
      return
    }

    listeSchliessen()
    blocks.push(
      <p key={`p-${index}`} style={{ margin: '0 0 10px', lineHeight: 1.65 }}>
        {inline(zeile, `p-${index}`)}
      </p>,
    )
  })
  listeSchliessen()

  return <>{blocks}</>
}

/**
 * Zieht aus einer Antwort die Stellen, die eine Reaktion des Menschen
 * verlangen: Fragen und Aufforderungen. Heuristik, kein Modellaufruf — sie
 * findet das meiste, weil Claude Rückfragen als eigene Zeile ans Ende stellt.
 */
function extrahiereBedarf(text: string): string[] {
  // Codeblöcke enthalten Fragezeichen, die keine Fragen sind.
  const ohneCode = text.replace(/```[\s\S]*?```/g, '')
  const zeilen = ohneCode
    .split('\n')
    .map((z) => z.replace(/^[\s>#*•\-\d.)]+/, '').replace(/\*\*/g, '').trim())
    .filter(Boolean)
  const aufforderung =
    /^(soll ich|möchtest du|willst du|brauchst du|bitte (gib|sag|prüf|bestätig|entscheid|schick)|sag (mir |)bescheid|entscheide|gib mir|wie soll|was soll|welche[rs]? (variante|option|weg)|should i|do you want|would you like|please (confirm|check|decide|tell|send)|let me know|which (option|variant|way)|how should|what should)/i
  const fragen = zeilen.filter((z) => (z.endsWith('?') && z.length > 12) || aufforderung.test(z))
  return [...new Set(fragen)].slice(-5)
}

export default function AnswerView({
  antworten,
  wartet = false,
}: {
  antworten: { t: string; text: string }[]
  wartet?: boolean
}) {
  const t = useTranslations()
  const box = useRef<HTMLDivElement>(null)
  const letzte = useRef<HTMLDivElement>(null)
  const anzahl = antworten.length
  /** Auf-/Zugeklappt je Antwort. Ohne Eintrag gilt: nur die neueste offen. */
  const [offen, setOffen] = useState<Record<number, boolean>>({})

  /**
   * Beim Öffnen der Ansicht (und bei jeder neuen Antwort) steht die *neueste*
   * im Bild — nicht die älteste. `useLayoutEffect`, damit der Sprung vor dem
   * ersten Bild passiert.
   */
  useLayoutEffect(() => {
    const b = box.current
    const l = letzte.current
    if (!b || !l) return
    const passt = l.offsetHeight <= b.clientHeight
    b.scrollTop = passt ? b.scrollHeight : Math.max(0, l.offsetTop - 12)
  }, [anzahl])

  if (!antworten.length) {
    return (
      <div className="stage" style={{ display: 'grid', placeItems: 'center', color: 'var(--color-neutral-600)', fontSize: 13 }}>
        {t('answer.none')}
      </div>
    )
  }

  const neueste = antworten[anzahl - 1]
  const bedarf = extrahiereBedarf(neueste.text)

  return (
    <div className="stage" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Was jetzt gebraucht wird, steht über dem Text — nicht darin begraben. */}
      {(bedarf.length > 0 || wartet) && (
        <div className="fragebox" style={{ margin: '12px 14px 0', flex: 'none' }}>
          <div className="kicker">{t('answer.needsYou')}</div>
          {bedarf.length > 0 ? (
            bedarf.map((f, i) => (
              <div key={i} className="fragezeile">
                {f}
              </div>
            ))
          ) : (
            <div className="fragezeile">{t('answer.freeForm')}</div>
          )}
        </div>
      )}

      <div
        ref={box}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 22px 18px', fontSize: 13.5, color: 'var(--color-neutral-200)' }}
      >
        {antworten.map((a, i) => {
          const istLetzte = i === anzahl - 1
          const auf = offen[i] ?? istLetzte
          const erste = a.text.trim().split('\n').find((z) => z.trim()) ?? ''
          if (!auf) {
            return (
              <button
                key={i}
                className="antwortzeile"
                style={{ marginBottom: 8 }}
                onClick={() => setOffen((o) => ({ ...o, [i]: true }))}
                title={t('answer.expand')}
              >
                <i className="ph ph-caret-right" style={{ fontSize: 11, flex: 'none' }} />
                <span style={{ flex: 'none', color: 'var(--color-neutral-600)' }}>
                  {i + 1} · {fmtTime(a.t)}
                </span>
                <span className="truncate" style={{ minWidth: 0 }}>
                  {erste.replace(/^#+\s*/, '').replace(/\*\*/g, '')}
                </span>
                <span style={{ marginLeft: 'auto', flex: 'none', color: 'var(--color-neutral-600)' }}>
                  {a.text.length > 1200 ? t('answer.chars', { n: Math.round(a.text.length / 1000) }) : ''}
                </span>
              </button>
            )
          }
          return (
            <div key={i} ref={istLetzte ? letzte : undefined} style={{ marginBottom: istLetzte ? 0 : 22 }}>
              <div
                className="kicker"
                style={{ marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center', position: 'sticky', top: -14, background: 'var(--color-bg)', paddingTop: 4, zIndex: 1 }}
              >
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 10, padding: '1px 6px' }}
                  onClick={() => setOffen((o) => ({ ...o, [i]: false }))}
                  title={t('answer.collapse')}
                >
                  <i className="ph ph-caret-down" />
                </button>
                {t('answer.answerN', { n: i + 1 })} · {fmtTime(a.t)}
                <button
                  className="btn btn-ghost"
                  style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 8px' }}
                  onClick={() => navigator.clipboard?.writeText(a.text)}
                >
                  <i className="ph ph-copy" /> {t('answer.copy')}
                </button>
              </div>
              <div style={{ maxWidth: 780 }}>
                <Markdown text={a.text} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
