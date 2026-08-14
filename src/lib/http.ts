import { NextResponse } from 'next/server'

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1'])

function blocked() {
  return NextResponse.json({ error: 'Cross-Origin-Zugriff abgelehnt' }, { status: 403 })
}

/** Schützt zustandsändernde Routen gegen Cross-Origin-Zugriffe. Auch wenn der
 *  Server nur an localhost bindet, kann eine im Browser geöffnete fremde
 *  Seite noch einen Request auslösen (DNS-Rebinding, CSRF ohne Preflight) —
 *  der Origin-Header, den Browser bei POST/PUT immer mitschicken, deckt das
 *  ab. Verglichen wird gegen den Host-Header (von Browser-JS nicht
 *  fälschbar), nicht gegen `req.url` — dessen Origin ist bei Next intern
 *  konstant "localhost", unabhängig davon, unter welcher Adresse der Browser
 *  tatsächlich verbunden ist (z. B. 127.0.0.1 nach `--hostname`). Fehlt der
 *  Origin-Header (z. B. curl, direkte API-Nutzung), wird nicht blockiert. */
export function rejectCrossOrigin(req: Request): NextResponse | null {
  const origin = req.headers.get('origin')
  if (!origin) return null

  let originUrl: URL
  try {
    originUrl = new URL(origin)
  } catch {
    return blocked()
  }

  const host = req.headers.get('host') ?? ''
  const sameHost = originUrl.host === host
  if (sameHost && LOOPBACK_HOSTNAMES.has(originUrl.hostname)) return null

  return blocked()
}
