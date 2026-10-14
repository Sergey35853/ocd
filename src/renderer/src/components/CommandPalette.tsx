import { useEffect, useMemo, useRef, useState } from "react"
import type { SessionInfo } from "@shared/types"
import { cx } from "../lib/format"
import { useT } from "../i18n"

/**
 * One list of everything the app can do, reachable by typing.
 *
 * The commands already existed as scattered buttons and menu entries; with this
 * many features the palette is what keeps them findable. It is deliberately a
 * plain list over a plain array — no command registry, because each entry is
 * still wired where it lives and the palette only borrows the handler.
 */

export interface Command {
  id: string
  label: string
  hint?: string
  /** Free text used for matching when the label is a dictionary key. */
  keywords?: string
  group: "nav" | "chat" | "session" | "app"
  run(): void
}

interface Props {
  open: boolean
  commands: Command[]
  sessions: SessionInfo[]
  onClose(): void
  onOpenSession(id: string): void
}

export function CommandPalette({ open, commands, sessions, onClose, onOpenSession }: Props) {
  const t = useT()
  const [query, setQuery] = useState("")
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Session entries are built here rather than in the caller: they need the
  // list, and the caller does not.
  const items = useMemo<Command[]>(() => {
    const fromSessions: Command[] = sessions.slice(0, 50).map((session) => ({
      id: `session:${session.id}`,
      label: session.title || t("session.untitled"),
      hint: "session",
      keywords: session.id,
      group: "session" as const,
      run: () => onOpenSession(session.id),
    }))
    return [...commands, ...fromSessions]
  }, [commands, sessions, onOpenSession, t])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return items
    return items.filter((item) => {
      return `${item.label} ${item.keywords ?? ""} ${item.id}`.toLowerCase().includes(needle)
    })
  }, [items, query])

  useEffect(() => {
    if (!open) return
    setQuery("")
    setCursor(0)
    // Focus after mount: the element does not exist on the first render.
    const timer = setTimeout(() => inputRef.current?.focus(), 10)
    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => {
    setCursor((current) => (current >= filtered.length ? 0 : current))
  }, [filtered.length])

  // Keep the highlighted row visible while arrowing through a long list.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }, [cursor])

  if (!open) return null

  const activate = (command: Command | undefined) => {
    if (!command) return
    onClose()
    command.run()
  }

  return (
    <div className="palette-back" onPointerDown={onClose}>
      <div className="palette" onPointerDown={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder={t("palette.placeholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              onClose()
              return
            }
            if (event.key === "ArrowDown") {
              event.preventDefault()
              setCursor((current) => Math.min(current + 1, filtered.length - 1))
              return
            }
            if (event.key === "ArrowUp") {
              event.preventDefault()
              setCursor((current) => Math.max(current - 1, 0))
              return
            }
            if (event.key === "Enter") {
              event.preventDefault()
              activate(filtered[cursor])
            }
          }}
        />

        <div className="palette-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="palette-empty">{t("palette.empty")}</div>
          ) : null}
          {filtered.map((item, index) => (
            <button
              key={item.id}
              type="button"
              data-index={index}
              className={cx("palette-item", index === cursor && "sel")}
              onPointerEnter={() => setCursor(index)}
              onClick={() => activate(item)}
            >
              <span className="palette-label">{item.label}</span>
              {item.hint ? (
                <span className="palette-hint">{item.hint}</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
