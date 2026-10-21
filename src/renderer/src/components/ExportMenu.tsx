import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { ExportRecord, MessageInfo } from "@shared/types"
import { textOf, toolLabel } from "../lib/format"
import { useT } from "../i18n"
import { IconExport } from "./Icon"
import { useAnchoredMenu } from "./ui"

const FORMATS = [
  { id: "markdown", ext: "md" },
  { id: "html", ext: "html" },
  { id: "pdf", ext: "pdf" },
  { id: "jsonl", ext: "jsonl" },
] as const

type Format = (typeof FORMATS)[number]["id"]

/**
 * Turn the visible conversation into a Markdown document.
 *
 * Tools are reduced to one `> command` line each: their full payloads are
 * kilobytes of JSON and would bury the actual conversation. Reasoning is
 * dropped for the same reason — it is a transcript, not an answer.
 */
function toMarkdown(messages: MessageInfo[]): string {
  const lines: string[] = []

  for (const message of messages) {
    const body = textOf(message.content ?? []).trim()
    if (body) {
      lines.push(body, "")
      continue
    }

    for (const part of message.content ?? []) {
      if (part.type !== "tool") continue
      const label = toolLabel(part)
      const status = part.state?.status
      lines.push(`> **${label}**${status && status !== "completed" ? ` — ${status}` : ""}`, "")
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

/**
 * The conversation as records, for the JSONL export.
 *
 * The window knows which message was the user's and which was the model's —
 * the server's transcript is a stream of parts, and the two are told apart by
 * the message they belong to. A tool call becomes a line of its own: the
 * command that was run is part of what happened, and a consumer that cannot
 * make sense of it still reads it as a line.
 */
function toRecords(messages: MessageInfo[]): ExportRecord[] {
  const records: ExportRecord[] = []
  for (const message of messages) {
    const body = textOf(message.content ?? []).trim()
    if (body) {
      records.push({ role: message.type === "user" ? "user" : "assistant", content: body })
    }
    for (const part of message.content ?? []) {
      if (part.type !== "tool") continue
      const error = part.state?.error
      const status = part.state?.status
      records.push({
        role: "tool",
        name: toolLabel(part),
        content: error ? String(error) : status ?? "",
      })
    }
  }
  return records
}

/**
 * Export button with a popup of formats.
 *
 * The heavy lifting lives in main: it owns the save dialog, the HTML shell and
 * `printToPDF`, so this component only has to hand over Markdown.
 */
export function ExportMenu({
  sessionId,
  title,
  messages,
  directory,
  onDone,
  onFailed,
}: {
  sessionId: string
  title: string
  messages: MessageInfo[]
  /** The project the conversations belong to, for the "all sessions" export. */
  directory?: string
  onDone: (path: string) => void
  onFailed: () => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<Format | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const box = useAnchoredMenu(open, rootRef, 178, 178, 5)

  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("pointerdown", away)
    window.addEventListener("keydown", escape)
    return () => {
      window.removeEventListener("pointerdown", away)
      window.removeEventListener("keydown", escape)
    }
  }, [open])

  const payload = () => ({
    sessionId,
    title,
    markdown: toMarkdown(messages),
    messages: messages.length,
    records: toRecords(messages),
  })

  const run = async (format: Format) => {
    setOpen(false)
    setBusy(format)
    try {
      const result = await window.ocd.app.exportConversation({ ...payload(), format })
      if (result.ok && result.path) onDone(result.path)
      else if (!result.canceled) onFailed()
    } catch {
      onFailed()
    } finally {
      setBusy(null)
    }
  }

  /** Print dialog; it ends in Windows, so there is no path to report back. */
  const runPrint = async () => {
    setOpen(false)
    try {
      await window.ocd.app.printConversation(payload())
    } catch {
      onFailed()
    }
  }
  /** The session itself, in the server's own file: it can be taken back. */
  const runSessionFile = async () => {
    setOpen(false)
    try {
      const result = await window.ocd.app.exportSessionFile(sessionId, title)
      if (result.ok && result.path) onDone(result.path)
      else if (!result.canceled) onFailed()
    } catch {
      onFailed()
    }
  }

  /** Every conversation of the project, in one file. */
  const runProjectFile = async () => {
    setOpen(false)
    setBusy("project" as Format)
    try {
      const result = await window.ocd.app.exportProjectSessions(directory)
      if (result.ok && result.path) onDone(result.path)
      else if (!result.canceled) onFailed()
    } catch {
      onFailed()
    } finally {
      setBusy(null)
    }
  }

  const menu = (
    <div
      className="menu-pop"
      ref={menuRef}
      role="menu"
      style={{ top: box?.top, left: box?.left }}
    >
      {FORMATS.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className="menu-pop-item"
          onClick={() => void run(item.id)}
        >
          <span>{t(`export.${item.id}` as never)}</span>
          <span className="kbd">.{item.ext}</span>
        </button>
      ))}
      <div className="menu-pop-sep" />
      <button
        type="button"
        role="menuitem"
        className="menu-pop-item"
        onClick={() => void runSessionFile()}
      >
        <span>{t("export.sessionFile")}</span>
        <span className="kbd">.json</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="menu-pop-item"
        onClick={() => void runProjectFile()}
      >
        <span>{t("export.projectSessions")}</span>
        <span className="kbd">.json</span>
      </button>
      <div className="menu-pop-sep" />
      <button
        type="button"
        role="menuitem"
        className="menu-pop-item"
        onClick={() => void runPrint()}
      >
        <span>{t("export.print")}</span>
        <span className="kbd">Ctrl+P</span>
      </button>
    </div>
  )

  return (
    <div className="export-menu" ref={rootRef}>
      <button
        type="button"
        className="iconbtn"
        title={busy ? t(`export.${busy}Working`) : t("export.title")}
        disabled={busy !== null}
        onClick={() => setOpen((value) => !value)}
      >
        <IconExport size={15} />
      </button>
      {open && box ? createPortal(menu, document.body) : null}
    </div>
  )
}

