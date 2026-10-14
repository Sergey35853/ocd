import { useEffect, useRef, useState } from "react"
import type { ShellRun } from "../lib/store"
import { stripAnsi } from "../lib/ansi"
import { cx } from "../lib/format"
import { useT } from "../i18n"
import { IconChevron, IconTerminal } from "./Icon"

/**
 * Output of the commands running in the background.
 *
 * This is not a terminal: nothing is typed here. It exists so a long build or a
 * failing test can be watched and read without expanding every tool row, which
 * is the thing a chat window is bad at. Interactivity is one click away — the
 * per-run button hands the command to a real terminal.
 */
export function OutputPanel({
  runs,
  onOpenTerminal,
}: {
  runs: ShellRun[]
  onOpenTerminal(command: string): void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const bodyRef = useRef<HTMLDivElement | null>(null)

  const active = runs.filter((run) => run.running).length
  const failed = runs.filter((run) => run.exit !== undefined && run.exit !== 0).length

  // Follow the newest output while collapsed: a run that is printing wants to
  // be watched, and scrolling by hand every time it writes is not watching.
  useEffect(() => {
    if (!open) return
    const node = bodyRef.current
    if (!node) return
    const pinned = node.scrollHeight - node.scrollTop - node.clientHeight < 60
    if (!pinned) return
    node.scrollTop = node.scrollHeight
  }, [runs, open])

  if (runs.length === 0) return null

  return (
    <div className={cx("outp", open && "open")}>
      <button
        type="button"
        className="outp-head"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <IconChevron size={13} className="caret" />
        <IconTerminal size={14} />
        <span className="outp-title">{t("outp.title")}</span>
        {active ? <span className="badge accent">{t("outp.running", { n: active })}</span> : null}
        {!active && failed ? (
          <span className="badge err">{t("outp.failed", { n: failed })}</span>
        ) : null}
        {!active && !failed ? (
          <span className="badge ok">{t("outp.done", { n: runs.length })}</span>
        ) : null}
      </button>

      {open ? (
        <div className="outp-body" ref={bodyRef}>
          {runs.map((run) => {
            const isOpen = expanded[run.id] ?? run.running
            const text = stripAnsi(run.output)
            return (
              <div className={cx("outp-run", run.exit !== undefined && run.exit !== 0 && "bad")} key={run.id}>
                <button
                  type="button"
                  className="outp-cmd"
                  title={t("tool.openTerminalHint", { command: run.command })}
                  onClick={() => setExpanded((current) => ({ ...current, [run.id]: !isOpen }))}
                >
                  <span className={cx("dot", run.running ? "busy" : run.exit === 0 ? "live" : "err")} />
                  <code>{run.command}</code>
                  <span className="outp-exit">
                    {run.running
                      ? t("outp.runningOne")
                      : run.exit === 0
                        ? t("outp.exitOk")
                        : t("outp.exitBad", { n: run.exit ?? 0 })}
                  </span>
                </button>

                {isOpen ? (
                  <pre className="outp-text">{text.trim() || t("outp.waiting")}</pre>
                ) : null}

                <button
                  type="button"
                  className="iconbtn tiny outp-open"
                  title={t("tool.openTerminalHint", { command: run.command })}
                  onClick={() => onOpenTerminal(run.command)}
                >
                  <IconTerminal size={12} />
                </button>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
