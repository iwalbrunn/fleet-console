import fs from 'node:fs/promises'
import path from 'node:path'
import { FLEET_DIR } from './config'

export interface QuotaWindow {
  type: string
  usedPercent: number | null
  resetsAt: number | null
}
export interface QuotaSnapshot {
  status: 'allowed' | 'allowed_warning' | 'rejected'
  updatedAt: string
  windows: QuotaWindow[]
  isUsingOverage: boolean
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Ausschließlich von der CLI gelieferte Werte; niemals aus Tokens geschätzt. */
export function parseQuota(
  value: unknown,
  updatedAt = new Date().toISOString()
): QuotaSnapshot | null {
  const info = record(value)
  if (!['allowed', 'allowed_warning', 'rejected'].includes(String(info.status))) return null
  const windows: QuotaWindow[] = []
  const unified = record(info.unifiedWindows)
  const sources = Object.keys(unified).length
    ? unified
    : info.rateLimitType
      ? { [String(info.rateLimitType)]: info }
      : {}
  for (const [type, value] of Object.entries(sources)) {
    if (!['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'overage'].includes(type))
      continue
    const window = record(value)
    windows.push({
      type,
      usedPercent:
        finite(window.utilization) && window.utilization >= 0 && window.utilization <= 1
          ? window.utilization * 100
          : null,
      resetsAt: finite(window.resetsAt) && window.resetsAt > 0 ? window.resetsAt : null,
    })
  }
  return {
    status: info.status as QuotaSnapshot['status'],
    updatedAt,
    windows,
    isUsingOverage: info.isUsingOverage === true,
  }
}

declare global {
  var __fleetQuota: QuotaSnapshot | undefined
}
const file = path.join(FLEET_DIR, 'quota.json')
let writes = Promise.resolve()
export function captureQuota(value: unknown): void {
  const snapshot = parseQuota(value)
  if (!snapshot) return
  globalThis.__fleetQuota = snapshot
  writes = writes
    .catch(() => {})
    .then(async () => {
      await fs.mkdir(FLEET_DIR, { recursive: true })
      await fs.writeFile(file + '.tmp', JSON.stringify(snapshot), { mode: 0o600 })
      await fs.rename(file + '.tmp', file)
    })
    .catch(() => {})
}
export async function readQuota(): Promise<QuotaSnapshot | null> {
  if (globalThis.__fleetQuota) return globalThis.__fleetQuota
  try {
    const saved = JSON.parse(await fs.readFile(file, 'utf8')) as QuotaSnapshot
    if (!Array.isArray(saved.windows) || !Number.isFinite(Date.parse(saved.updatedAt))) return null
    return globalThis.__fleetQuota ?? saved
  } catch {
    return null
  }
}
