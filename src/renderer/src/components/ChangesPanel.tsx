import { useMemo, useState } from "react"
import { cx } from "../lib/format"
import {
  changeTotals,
  patchDocument,
  toPatch,
  type FileChange,
} from "../lib/diff"
import { previewSpec } from "@shared/preview"
import { useT, type DictKey } from "../i18n"
import { IconChevron, IconClose, IconEdit, IconPanel, IconWindow } from "./Icon"
import { DiffView } from "./DiffView"

/**
 * Everything the agent changed in this conversation, in one list.
 *
 * Not a task list and not a promise: it is read out of the tool calls, so it
 * answers "what did it do to my files" without anyone having to open a terminal
 * and run `git diff`. Collapsed to a count in the chat header, expanded into
 * the files themselves.
 */
export function ChangesPanel({
  changes,
  open,
  onToggle,
  onOpenFile,
  onToast,
}: {
  changes: FileChange[]
  open: boolean
  onToggle: () => void
  /** Hands a path to the preview pane, converting it first if need be. */
  onOpenFile: (path: string) => void
  onToast: (text: string, kind?: "info" | "error") => void
}) {
  const t = useT()
  const [shown, setShown] = useState<Record<string, boolean>>({})
  const totals = useMemo(() => changeTotals(changes), [changes])

  if (changes.length === 0) return null

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      onToast(t("changes.copied"), "info")
    } catch {
      onToast(t("changes.copyFailed"), "error")
    }
  }

  const exportPatch = async () => {
    const document = patchDocument(changes)
    if (!document.trim()) {
      onToast(t("changes.nothingToExport"), "error")
      return
    }
    try {
      const result = await window.ocd.app.saveText({
        name: "changes",
        ext: "patch",
        content: document,
      })
      if (result.ok && result.path) onToast(t("changes.exported", { path: result.path }), "info")
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error")
    }
  }

  return (
    <div className={cx("changes", open && "open")}>
      <button
        type="button"
        className="tasks-bar"
        onClick={onToggle}
        title={t("changes.title")}
        aria-expanded={open}
      >
        <IconEdit size={14} />
        <span className="tasks-count">
          {t("changes.summary", {
            files: totals.files,
            added: totals.added,
            removed: totals.removed,
          })}
        </span>
      </button>

      {open ? (
        <div className="changes-panel">
          <div className="tasks-head">
            <span>{t("changes.title")}</span>
            <button
              type="button"
              className="code-act"
              title={t("changes.copyAll")}
              onClick={() => void copy(patchDocument(changes))}
            >
              {t("changes.copyAll")}
            </button>
            <button type="button" className="code-act" onClick={() => void exportPatch()}>
              {t("changes.exportPatch")}
            </button>
            <button
              type="button"
              className="iconbtn tiny"
              title={t("changes.close")}
              onClick={onToggle}
            >
              <IconClose size={13} />
            </button>
          </div>

          <ul className="changes-list">
            {changes.map((change) => {
              const expanded = shown[change.path] === true
              // A file the pane can render goes to the pane; anything else -
              // which for a code change is most of them - goes to whatever the
              // machine opens it with, i.e. the editor.
              const viewable = Boolean(previewSpec(change.path))
              const status = statusOf(change)
              const statusText = status ? t(`changes.status.${status}` as DictKey) : ""
              return (
                <li key={change.path} className="change">
                  <div className="change-row">
                    <button
                      type="button"
                      className="change-name"
                      aria-expanded={expanded}
                      title={change.path}
                      onClick={() => setShown((state) => ({ ...state, [change.path]: !expanded }))}
                    >
                      <IconChevron size={12} className={cx("caret", expanded && "open")} />
                      <span className="change-label">{fileLabel(change.path)}</span>
                      {status ? (
                        <span className={cx("badge", status)} title={statusText}>
                          {statusText}
                        </span>
                      ) : null}
                    </button>
                    <span className="diff-stat add">+{change.stats.added}</span>
                    <span className="diff-stat del">−{change.stats.removed}</span>
                    {change.edits > 1 ? (
                      <span className="badge" title={t("changes.editsHint", { n: change.edits })}>
                        ×{change.edits}
                      </span>
                    ) : null}
                    {viewable ? (
                      <button
                        type="button"
                        className="iconbtn tiny"
                        title={t("preview.openFile")}
                        onClick={() => onOpenFile(change.path)}
                      >
                        <IconPanel size={13} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="iconbtn tiny"
                        title={t("changes.openInEditor")}
                        onClick={() => void window.ocd.app.openPath(change.path)}
                      >
                        <IconWindow size={13} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="code-act"
                      title={t("diff.copyPatch")}
                      onClick={() => void copy(toPatch(change))}
                    >
                      {t("changes.copy")}
                    </button>
                  </div>

                  {expanded ? (
                    <div className="change-body">
                      {change.whole && !change.authoritative ? (
                        <p className="diff-note">{t("changes.wholeNote")}</p>
                      ) : null}
                      {change.exact ? (
                        <DiffView lines={change.lines} limit={180} />
                      ) : (
                        <div className="change-steps">
                          <p className="diff-note">{t("changes.brokenChain")}</p>
                          {change.steps.map((step) => (
                            <DiffView key={step.key} lines={step.lines} limit={120} />
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

/** "src\main\updater.ts" -> "updater.ts", with the folder kept as a hint. */
function fileLabel(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  const name = parts[parts.length - 1] ?? path
  const folder = parts[parts.length - 2]
  return folder ? `${folder} / ${name}` : name
}

/**
 * Whether the file was created, removed or changed, as the server reported it.
 *
 * Only meaningful when the server sent its own diff; a rebuilt edit knows what
 * it replaced and nothing about the file's fate.
 */
function statusOf(change: FileChange): "added" | "deleted" | "modified" | null {
  if (!change.authoritative) return null
  const last = change.steps[change.steps.length - 1]?.status
  if (last === "added" || last === "deleted" || last === "modified") return last
  // Several calls, all of them edits: the file exists and moved.
  return change.whole ? "added" : "modified"
}