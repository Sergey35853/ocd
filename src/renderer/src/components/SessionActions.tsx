import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useStore } from "../lib/store"
import { useT } from "../i18n"
import { IconMore } from "./Icon"
import { PermissionRules } from "./PermissionRules"
import { useAnchoredMenu } from "./ui"

/**
 * What can be done to a conversation besides talking to it.
 *
 * The server can shrink a long chat, branch it, move it to another project,
 * run one of its commands and remember the permission answers. All of that
 * used to be reachable only from the command line, which made it a part of
 * OpenCode the app did not have.
 *
 * The menu is drawn in the document body: the chat header scrolls sideways
 * and a scroll container clips its children.
 */
export function SessionActions({
  sessionId,
  projectID,
}: {
  sessionId: string
  projectID?: string
}) {
  const store = useStore()
  const t = useT()
  const [open, setOpen] = useState(false)
  /** "menu" shows the actions, "commands" the server's own commands. */
  const [mode, setMode] = useState<"menu" | "commands">("menu")
  /** Whether the list of remembered permission answers is on screen. */
  const [rulesOpen, setRulesOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const box = useAnchoredMenu(open, rootRef, 220, 320, 6)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const close = () => {
    setOpen(false)
    setMode("menu")
  }

  const move = async () => {
    const directory = await window.ocd.app.pickDirectory()
    if (!directory) return
    close()
    await store.moveSession(sessionId, directory)
  }

  const menu = (
    <div className="picker-menu" ref={menuRef} role="menu">
      {mode === "commands" ? (
        <>
          <button
            type="button"
            className="item"
            onClick={() => setMode("menu")}
            style={{ color: "var(--text-faint)" }}
          >
            <span className="grow">← {t("session.back")}</span>
          </button>
          {store.commands.length === 0 ? (
            <div style={{ padding: "10px", color: "var(--text-faint)" }}>{t("common.notFound")}</div>
          ) : null}
          {store.commands.map((command) => (
            <button
              key={command.name}
              type="button"
              className="item"
              role="menuitem"
              onClick={() => {
                close()
                void store.runSessionCommand(sessionId, {
                  name: command.name,
                  text: command.description ?? command.name,
                })
              }}
            >
              <span className="grow">{command.name}</span>
              {command.description ? (
                <span style={{ color: "var(--text-faint)", fontSize: 11 }}>{command.description}</span>
              ) : null}
            </button>
          ))}
        </>
      ) : (
        <>
          <button
            type="button"
            className="item"
            role="menuitem"
            onClick={() => {
              close()
              void store.compactSession(sessionId)
            }}
          >
            <span className="grow">{t("session.compact")}</span>
          </button>
          <button
            type="button"
            className="item"
            role="menuitem"
            onClick={() => {
              close()
              void store.forkSession(sessionId)
            }}
          >
            <span className="grow">{t("session.fork")}</span>
          </button>
          <button
            type="button"
            className="item"
            role="menuitem"
            onClick={() => void move()}
          >
            <span className="grow">{t("session.move")}</span>
          </button>
          <button
            type="button"
            className="item"
            role="menuitem"
            onClick={() => setMode("commands")}
          >
            <span className="grow">{t("session.command")}</span>
          </button>
          <button
            type="button"
            className="item"
            role="menuitem"
            onClick={() => {
              close()
              setRulesOpen(true)
            }}
          >
            <span className="grow">{t("session.rules")}</span>
          </button>
        </>
      )}
    </div>
  )

  return (
    <div className="session-actions" ref={rootRef}>
      <button
        type="button"
        className="iconbtn"
        title={t("session.actions")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value)
          setMode("menu")
        }}
      >
        <IconMore size={15} />
      </button>
      {open && box ? createPortal(menu, document.body) : null}
      {rulesOpen ? (
        <PermissionRules projectID={projectID} onClose={() => setRulesOpen(false)} />
      ) : null}
    </div>
  )
}
