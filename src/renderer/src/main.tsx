import React from "react"
import { createRoot } from "react-dom/client"
import App from "./App"
import "./styles.css"

/**
 * Hand uncaught failures to the main process.
 *
 * A renderer has no other way to leave a note: an error in an event handler
 * reaches a console nobody is watching, and the process it eventually kills is
 * the one window the user was reading in. Reporting costs one IPC message and
 * makes "it just closed" a question the log can answer.
 *
 * Reporting must never itself throw — a rejected `invoke` here would loop back
 * into the same handler — so every path is wrapped and every failure swallowed.
 */
function report(kind: string, message: string, stack?: string): void {
  try {
    void window.ocd.diag.report({ kind, message, stack }).catch(() => undefined)
  } catch {
    /* the bridge is gone; the crash it would describe is already happening */
  }
}

window.addEventListener("error", (event) => {
  report("error", event.message || String(event.error ?? "unknown error"), event.error?.stack)
})

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason
  report(
    "unhandledrejection",
    reason instanceof Error ? reason.message : String(reason),
    reason instanceof Error ? reason.stack : undefined,
  )
})

const container = document.getElementById("root")
if (!container) throw new Error("Root container missing")

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
