import { useMemo } from "react"
import type { MessageInfo } from "@shared/types"
import { cx } from "../lib/format"
import { sessionTasks, taskProgress } from "../lib/tasks"
import { useT } from "../i18n"
import { IconClose, IconTasks } from "./Icon"

/**
 * Session task board.
 *
 * Not a to-do store: it reads the checklist the model wrote into the reply,
 * so it cannot drift from what the assistant actually said. Collapsed to a
 * count in the chat header and expanded into the full list.
 */
export function TasksBoard({
  messages,
  open,
  onToggle,
}: {
  messages: MessageInfo[]
  open: boolean
  onToggle: () => void
}) {
  const t = useT()
  const items = useMemo(() => sessionTasks(messages), [messages])
  const progress = useMemo(() => taskProgress(items), [items])

  if (items.length === 0) return null

  return (
    <div className={cx("tasks", open && "open")}>
      <button
        type="button"
        className="tasks-bar"
        onClick={onToggle}
        title={t("tasks.title")}
        aria-expanded={open}
      >
        <IconTasks size={14} />
        <span className="tasks-count">
          {t("tasks.progress", { done: progress.done, total: progress.total })}
        </span>
        <span className="tasks-track" aria-hidden="true">
          <span className="tasks-fill" style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
        </span>
      </button>

      {open ? (
        <div className="tasks-panel">
          <div className="tasks-head">
            <span>{t("tasks.title")}</span>
            <button
              type="button"
              className="iconbtn tiny"
              title={t("tasks.close")}
              onClick={onToggle}
            >
              <IconClose size={13} />
            </button>
          </div>
          {items.length === 0 ? (
            <p className="tasks-empty">{t("tasks.emptyHint")}</p>
          ) : (
            <ul className="tasks-list">
              {items.map((item, index) => (
                <li key={`${index}-${item.text}`} className={cx("task", item.done && "done")}>
                  <span className="task-mark" aria-hidden="true">
                    {item.done ? "✓" : ""}
                  </span>
                  <span className="task-text">{item.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}