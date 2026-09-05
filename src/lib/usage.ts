/** Usage-Zählung des stream-json-Ausgangs. Die CLI schickt pro API-Nachricht
 *  mehrere assistant-Events (Text- und Tool-Blöcke), jedes trägt die Usage
 *  der ganzen Nachricht — wer je Event addiert, zählt dieselben Tokens
 *  mehrfach. Gezählt wird deshalb je Nachrichten-Id die Differenz zum
 *  zuletzt gesehenen Stand: identische Wiederholungen ergeben null, eine
 *  gewachsene Angabe nur den Zuwachs. */

export interface StreamUsage {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

interface Stand {
  in: number
  out: number
  cacheWrite: number
  cacheRead: number
}

export interface UsageZaehler {
  staende: Map<string, Stand>
  reihenfolge: string[]
}

export interface UsageDelta {
  in: number
  out: number
  cacheWrite: number
  cacheRead: number
  /** Erste Sichtung dieser Nachrichten-Id — zählt als eine Anfrage. */
  neueNachricht: boolean
}

/** Wie viele Nachrichten-Ids sich der Zähler merkt. Die Events einer
 *  Nachricht kommen direkt hintereinander — die Grenze ist nur ein Deckel
 *  gegen unbegrenztes Wachstum langer Sessions. */
const MAX_IDS = 500

export function neuerUsageZaehler(): UsageZaehler {
  return { staende: new Map(), reihenfolge: [] }
}

export function usageDelta(z: UsageZaehler, id: unknown, u: StreamUsage): UsageDelta {
  const stand: Stand = {
    in: validToken(u.input_tokens),
    out: validToken(u.output_tokens),
    cacheWrite: validToken(u.cache_creation_input_tokens),
    cacheRead: validToken(u.cache_read_input_tokens),
  }

  // Ohne Id lässt sich nichts wiedererkennen — voll zählen ist dann die
  // ehrlichere Näherung als gar nicht.
  if (typeof id !== 'string' || !id) {
    return { ...stand, neueNachricht: true }
  }

  const vorher = z.staende.get(id)
  if (!vorher) {
    z.staende.set(id, stand)
    z.reihenfolge.push(id)
    if (z.reihenfolge.length > MAX_IDS) {
      const alt = z.reihenfolge.shift()
      if (alt) z.staende.delete(alt)
    }
    return { ...stand, neueNachricht: true }
  }

  const delta: UsageDelta = {
    in: Math.max(0, stand.in - vorher.in),
    out: Math.max(0, stand.out - vorher.out),
    cacheWrite: Math.max(0, stand.cacheWrite - vorher.cacheWrite),
    cacheRead: Math.max(0, stand.cacheRead - vorher.cacheRead),
    neueNachricht: false,
  }
  z.staende.set(id, {
    in: Math.max(vorher.in, stand.in),
    out: Math.max(vorher.out, stand.out),
    cacheWrite: Math.max(vorher.cacheWrite, stand.cacheWrite),
    cacheRead: Math.max(vorher.cacheRead, stand.cacheRead),
  })
  return delta
}

function validToken(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/** Ersetzt vorläufige Stream-Zahlen mit den kumulativen Modellwerten der CLI.
 * Nur der Anteil dieses Prozesses wird ersetzt, unabhängige Rollen bleiben erhalten. */
export function reconcileUsage(
  state: { tokensIn: number; tokensOut: number; tokensCacheWrite: number; tokensCached: number },
  processUsage: { in: number; out: number; cacheWrite: number; cacheRead: number },
  modelUsage: unknown
): void {
  if (!modelUsage || typeof modelUsage !== 'object' || !Object.keys(modelUsage).length) return
  const total = { in: 0, out: 0, cacheWrite: 0, cacheRead: 0 }
  for (const model of Object.values(modelUsage)) {
    if (!model || typeof model !== 'object') return
    const fields = [
      'inputTokens',
      'outputTokens',
      'cacheCreationInputTokens',
      'cacheReadInputTokens',
    ] as const
    if (
      fields.some(
        (key) => typeof model[key] !== 'number' || !Number.isFinite(model[key]) || model[key] < 0
      )
    )
      return
    total.in += model.inputTokens
    total.out += model.outputTokens
    total.cacheWrite += model.cacheCreationInputTokens
    total.cacheRead += model.cacheReadInputTokens
  }
  state.tokensIn += total.in - processUsage.in
  state.tokensOut += total.out - processUsage.out
  state.tokensCacheWrite += total.cacheWrite - processUsage.cacheWrite
  state.tokensCached += total.cacheRead - processUsage.cacheRead
  Object.assign(processUsage, total)
}
