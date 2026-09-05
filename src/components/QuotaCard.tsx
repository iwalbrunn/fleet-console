'use client'
import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { requestJson } from '@/lib/api-client'
import type { QuotaSnapshot } from '@/lib/quota'

export function QuotaCard() {
  const t = useTranslations('quota')
  const locale = useLocale()
  const [quota, setQuota] = useState<QuotaSnapshot | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const controller = new AbortController()
    let loading = false
    const refresh = async () => {
      if (loading || document.hidden) return
      loading = true
      try {
        const data = await requestJson<{ quota: QuotaSnapshot | null }>('/api/quota', {
          signal: controller.signal,
        })
        if (!controller.signal.aborted) {
          setQuota(data.quota)
          setUnavailable(false)
          setNow(Date.now())
        }
      } catch {
        if (!controller.signal.aborted) setUnavailable(true)
      } finally {
        loading = false
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 15000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      controller.abort()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  const date = (ms: number) =>
    new Date(ms).toLocaleString(locale, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  const stale = !quota || unavailable || now - Date.parse(quota.updatedAt) > 5 * 60 * 1000
  return (
    <section
      className="card"
      aria-label={t('title')}
      style={{ padding: '10px 11px', gap: 8, marginBottom: 12 }}
    >
      <div className="kicker">{t('title')}</div>
      {quota ? (
        <>
          <div style={{ fontSize: 12 }}>
            {t(quota.status)}
            {stale ? ` · ${t('stale')}` : ''}
          </div>
          {quota.windows.map((window) => {
            const expired = window.resetsAt !== null && window.resetsAt * 1000 <= now
            const remaining =
              window.usedPercent === null || expired ? null : Math.max(0, 100 - window.usedPercent)
            return (
              <div key={window.type} style={{ fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>{t(window.type)}</span>
                  <strong>
                    {remaining === null
                      ? t('unknown')
                      : t('remaining', { value: Number(remaining.toFixed(1)) })}
                  </strong>
                </div>
                {remaining !== null && (
                  <progress
                    aria-label={t(window.type)}
                    value={remaining}
                    max={100}
                    style={{ width: '100%', height: 6, accentColor: 'var(--color-accent)' }}
                  />
                )}
                {window.resetsAt && (
                  <div style={{ fontSize: 10, color: 'var(--color-neutral-500)' }}>
                    {t(expired ? 'expired' : 'reset', { time: date(window.resetsAt * 1000) })}
                  </div>
                )}
              </div>
            )
          })}
          {quota.isUsingOverage && <div className="banner">{t('overageActive')}</div>}
          <div style={{ fontSize: 10, color: 'var(--color-neutral-500)' }}>
            {t('updated', { time: date(Date.parse(quota.updatedAt)) })}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12 }}>{t('noData')}</div>
      )}
      <div style={{ fontSize: 10, color: 'var(--color-neutral-500)' }}>{t('note')}</div>
      <a
        href="https://claude.ai/settings/usage"
        target="_blank"
        rel="noreferrer"
        style={{ fontSize: 11 }}
      >
        {t('open')}
      </a>
    </section>
  )
}
