import React, { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import "./styles.css"

/** What main pushes into the strip. Mirrors the fields the HUD renders. */
interface HudState {
  connected: boolean
  /** Conversation titles currently streaming, newest first. */
  busy: Array<{ id: string; title: string }>
  /** Plain status line in Russian; the HUD has no i18n runtime of its own. */
  status: string
}

const OFFLINE: HudState = { connected: false, busy: [], status: "Сервер недоступен" }

/**
 * Heads-up display.
 *
 * A bare renderer: no store, no routing, no React context. Main owns the state
 * and pushes it, because the HUD is a read-only mirror and a second copy of
 * the app store would be a second thing to keep in sync.
 */
function Hud() {
  const [state, setState] = useState<HudState>(OFFLINE)

  useEffect(() => {
    const off = window.ocd.hud.onState((next) => setState(next))
    // Main sends the current state as soon as the window exists; this asks for
    // it in case that message landed before React mounted.
    void window.ocd.hud.request()
    return off
  }, [])

  const working = state.busy.length > 0
  const headline = working ? state.busy[0].title : state.status
  const extra = working && state.busy.length > 1 ? ` +${state.busy.length - 1}` : ""

  return (
    <div className={working ? "hud working" : "hud"}>
      <div className="hud-row">
        <span className={"hud-dot" + (state.connected ? " on" : "")} />
        <span className="hud-title">{headline}</span>
        {extra ? <span className="hud-more">{extra}</span> : null}
      </div>
      <div className="hud-sub">
        {working ? "работаю" : state.status}
      </div>
    </div>
  )
}

const container = document.getElementById("root")
if (!container) throw new Error("Root container missing")

createRoot(container).render(
  <React.StrictMode>
    <Hud />
  </React.StrictMode>,
)
