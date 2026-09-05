import { getSession, listSessions, subscribe } from '@/lib/sessions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const state = getSession(id) ?? (await listSessions()).find((entry) => entry.id === id)
  if (!state) return new Response(null, { status: 204 }) // EventSource soll nicht endlos neu verbinden.
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let beat: ReturnType<typeof setInterval> | null = null
  let closed = false
  let abort: () => void = () => {}
  const cleanup = () => {
    if (closed) return
    closed = true
    unsubscribe?.()
    if (beat) clearInterval(beat)
    req.signal.removeEventListener('abort', abort)
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          cleanup()
        }
      }
      abort = () => {
        cleanup()
        try {
          controller.close()
        } catch {
          /* bereits geschlossen */
        }
      }
      req.signal.addEventListener('abort', abort, { once: true })
      if (req.signal.aborted) {
        abort()
        return
      }
      unsubscribe = subscribe(id, send)
      if (!unsubscribe) {
        send(`event: state\ndata: ${JSON.stringify(state)}\n\n`)
        send('event: archived\ndata: {}\n\n')
        abort()
        return
      }
      beat = setInterval(() => send(': ping\n\n'), 20000)
    },
    cancel() {
      cleanup()
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
