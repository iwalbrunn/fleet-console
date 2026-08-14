import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

// Lokales Werkzeug: bindet bewusst nur an localhost (siehe README).
const nextConfig: NextConfig = {
  reactStrictMode: false, // sonst doppelte SSE-Verbindungen im Dev-Modus
  serverExternalPackages: [],
}

export default withNextIntl(nextConfig)
