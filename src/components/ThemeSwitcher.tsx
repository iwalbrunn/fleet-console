'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

type Theme = 'system' | 'light' | 'dark'

/** Gleicher Schlüssel wie im No-Flash-Script im Layout-Head. */
const SPEICHER = 'fleet.theme'

const REIHENFOLGE: Theme[] = ['system', 'light', 'dark']

const ICONS: Record<Theme, string> = {
  system: 'ph-circle-half',
  light: 'ph-sun',
  dark: 'ph-moon',
}

function anwenden(theme: Theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
}

export function ThemeSwitcher() {
  const t = useTranslations()
  const [theme, setTheme] = useState<Theme>('system')

  // Der Server kennt die Wahl nicht — erst nach dem Mount aus dem Speicher
  // lesen, das Dokument selbst hat das No-Flash-Script längst umgestellt.
  useEffect(() => {
    const roh = localStorage.getItem(SPEICHER)
    if (roh === 'light' || roh === 'dark') setTheme(roh)
  }, [])

  const weiter = () => {
    const neu = REIHENFOLGE[(REIHENFOLGE.indexOf(theme) + 1) % REIHENFOLGE.length]
    setTheme(neu)
    if (neu === 'system') localStorage.removeItem(SPEICHER)
    else localStorage.setItem(SPEICHER, neu)
    anwenden(neu)
  }

  return (
    <button
      className="btn btn-ghost btn-icon"
      style={{ width: 28, height: 28 }}
      onClick={weiter}
      title={t(`theme.${theme}`)}
    >
      <i className={`ph ${ICONS[theme]}`} style={{ fontSize: 15 }} />
    </button>
  )
}
