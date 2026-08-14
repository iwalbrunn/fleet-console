'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useRouter, usePathname } from '@/i18n/routing'

export function LanguageSwitcher() {
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const t = useTranslations('navigation')

  const toggleLanguage = () => {
    const nextLocale = locale === 'de' ? 'en' : 'de'
    router.push(pathname, { locale: nextLocale })
  }

  return (
    <button
      onClick={toggleLanguage}
      className="btn btn-ghost"
      style={{ fontSize: 11, padding: '4px 10px', marginLeft: 'auto' }}
      title={t('toggleLanguage')}
      aria-label={t('toggleLanguage')}
    >
      {locale === 'de' ? 'EN' : 'DE'}
    </button>
  )
}
