import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { WorktreeInfo } from "@shared/types"
import { useStore } from "../lib/store"
import { useT } from "../i18n"
import { IconMore } from "./Icon"
import { PermissionRules } from "./PermissionRules"
import { Modal, useAnchoredMenu } from "./ui"

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
  const [mode, setMode] = useState<"menu" | "commands" | "move">("menu")
  /** The worktrees the server keeps: places a session can be moved to. */
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([])
  /** Whether the list of remembered permission answers is on screen. */
  const [rulesOpen, setRulesOpen] = useState(false)
  /** The server's own log of this session, when it was asked for. */
  const [logLines, setLogLines] = useState<string[] | null>(null)
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
    try {
      const directory = await window.ocd.app.pickDirectory()
      if (!directory) return
      close()
      await store.moveSession(sessionId, directory)
    } catch (err) {
      store.toast(err instanceof Error ? err.message : String(err), "error")
    }
  }

  const menu = (
    <div
      className="picker-menu"
      ref={menuRef}
      role="menu"
      style={{ top: box?.top, left: box?.left, width: box?.width, maxHeight: box?.maxHeight }}
    >
      {mode === "move" ? (
        <>
          <button
            type="button"
            className="item"
            onClick={() => setMode("menu")}
            style={{ color: "var(--text-faint)" }}
          >
            <span className="grow">← {t("session.back")}</span>
          </button>
          <button
            type="button"
            className="item"
            role="menuitem"
            onClick={() => void move()}
          >
            <span className="grow">{t("session.moveFolder")}</span>
          </button>
          {worktrees.map((worktree) => (
            <button
              key={worktree.directory}
              type="button"
              className="item"
              role="menuitem"
              onClick={() => {
                close()
                void store.moveSession(sessionId, worktree.directory)
              }}
            >
              <span className="grow">{worktree.directory.split(/[\\/]/).pop()}</span>
              {worktree.strategy ? (
                <span style={{ color: "var(--text-faint)", fontSize: 11 }}>
                  {worktree.strategy}
                </span>
              ) : null}
            </button>
          ))}
        </>
      ) : mode === "commands" ? (
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
            onClick={() => {
              setMode("move")
              void window.ocd.api
                .worktrees()
                .then((list) => setWorktrees(list))
                .catch((err: unknown) =>
                  store.toast(err instanceof Error ? err.message : String(err), "error"),
                )
            }}
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
              void store.importSession()
            }}
          >
            <span className="grow">{t("session.import")}</span>
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
          <button
            type="button"
            className="item"
            role="menuitem"
            onClick={() => {
              close()
              void window.ocd.api
                .sessionLog(sessionId)
                .then((lines) => setLogLines(lines))
                .catch(() => setLogLines([]))
            }}
          >
            <span className="grow">{t("session.log")}</span>
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
      {logLines ? (
        <Modal title={t("session.log")} onClose={() => setLogLines(null)}>
          {logLines.length === 0 ? (
            <p style={{ color: "var(--text-faint)" }}>{t("session.logEmpty")}</p>
          ) : (
            <pre className="log-view mono" style={{ margin: 0, maxHeight: "50vh" }}>
              {logLines.join("\n")}
            </pre>
          )}
        </Modal>
      ) : null}
    </div>
  )
}
