// Ab Next.js 16 heißt die Datei `proxy.ts` statt `middleware.ts` — die alte
// Konvention ist deprecated. Der Import aus `next-intl/middleware` bleibt davon
// unberührt, das ist der Pfad der Bibliothek und nicht die Next-Konvention.
// Achtung: `proxy` läuft immer in der Node-Runtime, `edge` gibt es hier nicht.
import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'

export default createMiddleware(routing)

export const config = {
  matcher: ['/', '/(de|en)/:path*'],
}
