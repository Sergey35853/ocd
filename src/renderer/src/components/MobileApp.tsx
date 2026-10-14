import { useCallback, useEffect, useMemo, useRef, useState } from "react"

/**
 * The phone client.
 *
 * Deliberately not the desktop app in a narrow window: that is a sidebar, a
 * tab strip and a composer squeezed into 360 pixels, and none of those earn
 * their place there. This is the two screens that do — the conversations, and
 * one conversation.
 *
 * It talks to the gateway on the same origin, never to the OpenCode server
 * directly. That is what keeps the token, the allowlist and the
 * Tailscale-only binding between the phone and everything the server can do.
 */

/** Carried from the bookmark; the gateway rejects anything without it. */
const TOKEN = new URLSearchParams(location.search).get("token") ?? ""

interface Session {
  id: string
  title?: string
  time?: { created?: number; updated?: number }
}

interface Message {
  id: string
  type: string
  text?: string
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const sep = path.includes("?") ? "&" : "?"
  const res = await fetch(`${path}${sep}token=${encodeURIComponent(TOKEN)}`, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  })
  if (!res.ok) throw new Error(String(res.status))
  return (await res.json()) as T
}

function ago(value?: number): string {
  if (!value) return ""
  const minutes = Math.round((Date.now() - value) / 60000)
  if (minutes < 1) return "сейчас"
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} ч`
  return `${Math.round(hours / 24)} д`
}

function Bubble({ message }: { message: Message }) {
  const mine = message.type === "user"
  return <div className={"m-msg" + (mine ? " m-msg--mine" : "")}>{message.text ?? ""}</div>
}

export function MobileApp() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottom = useRef<HTMLDivElement>(null)

  const loadSessions = useCallback(async () => {
    try {
      const list = await api<Session[]>("/api/session")
      setSessions(Array.isArray(list) ? list : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const openSession = useCallback(async (id: string) => {
    setOpen(id)
    setMessages([])
    try {
      const list = await api<Message[]>(`/api/session/${id}/message`)
      setMessages(Array.isArray(list) ? list : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  /**
   * The same events the desktop sees.
   *
   * Not a poll: a conversation is a live thing, and a phone that re-read it
   * every few seconds would show half an answer most of the time.
   */
  useEffect(() => {
    if (!open) return
    const source = new EventSource(`/events?token=${encodeURIComponent(TOKEN)}`)
    source.onmessage = (event) => {
      const payload = JSON.parse(event.data) as { type?: string; sessionID?: string }
      if (payload.sessionID !== open) return
      if (!payload.type?.startsWith("session.")) return
      void openSession(open)
      if (payload.type === "session.idle" || payload.type === "session.error") {
        setBusy(false)
        void loadSessions()
      }
    }
    // The gateway restarts with the app, so a dropped stream is expected and
    // not something to put in front of the user.
    source.onerror = () => source.close()
    return () => source.close()
  }, [open, openSession, loadSessions])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" })
  }, [messages, busy])

  const send = useCallback(async () => {
    const text = draft.trim()
    if (!text || !open || busy) return
    setDraft("")
    setBusy(true)
    try {
      await api(`/api/session/${open}/prompt`, { method: "POST", body: JSON.stringify({ text }) })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }, [draft, open, busy])

  const stop = useCallback(async () => {
    if (!open) return
    try {
      await api(`/api/session/${open}/interrupt`, { method: "POST", body: "{}" })
    } finally {
      setBusy(false)
    }
  }, [open])

  const current = useMemo(
    () => sessions.find((session) => session.id === open),
    [sessions, open],
  )

  return (
    <div className="m-app">
      {error ? <div className="m-error">{error}</div> : null}

      {!open ? (
        <>
          <header className="m-head">Беседы</header>
          <ul className="m-list">
            {sessions.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  className="m-row"
                  onClick={() => void openSession(session.id)}
                >
                  <span className="m-row-t">{session.title || "Без названия"}</span>
                  <span className="m-row-when">
                    {ago(session.time?.updated ?? session.time?.created)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <header className="m-head">
            <button type="button" className="m-back" onClick={() => setOpen(null)}>
              ‹
            </button>
            <span className="m-head-t">{current?.title || "Без названия"}</span>
          </header>

          <div className="m-stream">
            {messages.map((message) => (
              <Bubble key={message.id} message={message} />
            ))}
            {busy ? <div className="m-typing">печатает…</div> : null}
            <div ref={bottom} />
          </div>

          <div className="m-compose">
            <textarea
              className="m-input"
              rows={1}
              value={draft}
              placeholder="Сообщение"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  void send()
                }
              }}
            />
            {busy ? (
              <button
                type="button"
                className="m-send m-send--stop"
                onClick={() => void stop()}
              >
                ■
              </button>
            ) : (
              <button
                type="button"
                className="m-send"
                disabled={!draft.trim()}
                onClick={() => void send()}
              >
                ↑
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
