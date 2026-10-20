import { useEffect, useRef, useState } from "react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"
import { useT } from "../i18n"
import { IconClose, IconTerminal } from "./Icon"

/**
 * A terminal inside the app.
 *
 * The command runs on the server — the same place the agent's commands run —
 * and the bytes come over a websocket to a real terminal emulator. That is
 * why this is not a log window: the colours, the cursor and the line editing
 * are the ones the command expects.
 *
 * The window that opens the terminal is the one that shows it; the process
 * belongs to the server and outlives the window.
 */
export function TerminalPanel({
  cwd,
  onClose,
}: {
  cwd?: string
  onClose(): void
}) {
  const t = useT()
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const idRef = useRef<string | null>(null)
  const [title, setTitle] = useState("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const term = new Terminal({
      fontFamily: '"Cascadia Mono", Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.2,
      cursorBlink: true,
      convertEol: true,
      scrollback: 5000,
      theme: { background: "#101418", foreground: "#d8dee9" },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    try {
      fit.fit()
    } catch {
      // The panel may not have a size yet; the resize handler will fit it.
    }
    termRef.current = term

    const onResize = () => {
      try {
        fit.fit()
      } catch {
        /* not laid out yet */
      }
    }
    window.addEventListener("resize", onResize)

    const offOutput = window.ocd.pty.onOutput((payload) => {
      if (payload.id !== idRef.current) return
      if (payload.data) term.write(payload.data)
    })

    const input = term.onData((data) => {
      if (!idRef.current) return
      void window.ocd.pty.input(idRef.current, data)
    })

    void window.ocd.pty
      .open({ command: "powershell.exe", cwd, title: t("terminal.title") })
      .then((info) => {
        idRef.current = info.id
        setTitle(info.title)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      offOutput()
      input.dispose()
      window.removeEventListener("resize", onResize)
      const id = idRef.current
      idRef.current = null
      term.dispose()
      if (id) void window.ocd.pty.close(id)
    }
  }, [cwd, t])

  return (
    <div className="terminal-panel">
      <header className="terminal-head">
        <IconTerminal size={14} />
        <span className="grow">{title || t("terminal.title")}</span>
        {error ? <span className="terminal-error">{error}</span> : null}
        <button
          type="button"
          className="iconbtn"
          title={t("common.close")}
          aria-label={t("common.close")}
          onClick={onClose}
        >
          <IconClose size={14} />
        </button>
      </header>
      <div className="terminal-host" ref={hostRef} />
    </div>
  )
}
