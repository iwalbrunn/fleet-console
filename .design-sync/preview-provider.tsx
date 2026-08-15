// Nur für den Design-Sync: die Fleet-Console-Komponenten lesen ihre Texte
// über next-intl — außerhalb der App braucht jede Vorschau diesen Provider,
// sonst wirft useTranslations() beim Rendern.
import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import de from '../messages/de.json'

export function NocturneProvider({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  )
}
