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
}

export interface UsageZaehler {
  staende: Map<string, Stand>
  reihenfolge: string[]
}

export interface UsageDelta {
  in: number
  out: number
  cacheWrite: number
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
    in: u.input_tokens ?? 0,
    out: u.output_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
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
    neueNachricht: false,
  }
  z.staende.set(id, {
    in: Math.max(vorher.in, stand.in),
    out: Math.max(vorher.out, stand.out),
    cacheWrite: Math.max(vorher.cacheWrite, stand.cacheWrite),
  })
  return delta
}
