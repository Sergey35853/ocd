import type { InboxItem } from "@shared/types"
import { cx, truncate } from "../lib/format"
import { useT } from "../i18n"
import { IconClose, IconLayers, IconSend } from "./Icon"

/**
 * Prompts the server is holding for the running turn.
 *
 * Rendered in place of the composer hint so it cannot push the input around:
 * the queue is exactly what the user needs to see while the box is disabled.
 *
 * These are the server's own items, not a copy kept here — the server owns
 * the order and delivers them itself, so every action on the bar is a request
 * and the list is re-read afterwards rather than patched optimistically.
 */
export function QueueBar({
  items,
  onCancel,
  onSendNow,
  onClear,
}: {
  items: InboxItem[]
  onCancel(id: string): void
  onSendNow(id: string): void
  onClear(): void
}) {
  const t = useT()
  if (items.length === 0) return null

  return (
    <div className="queue">
      <div className="queue-head">
        <IconLayers size={13} />
        <span>{t("queue.waiting", { n: items.length })}</span>
        <button type="button" className="linkbtn" onClick={onClear}>
          {t("queue.clear")}
        </button>
      </div>
      <ul className="queue-list">
        {items.map((item, index) => (
          <li key={item.id} className={cx("queue-item", index === 0 && "next")}>
            <span className="queue-pos">{index + 1}</span>
            <span className="queue-text">{truncate(item.text, 140)}</span>
            {/* Steer it now: the server wakes its own loop for a steered item,
                so this is one request rather than a wait for the turn to end. */}
            <button
              type="button"
              className="iconbtn tiny"
              title={t("queue.sendNow")}
              onClick={() => onSendNow(item.id)}
            >
              <IconSend size={12} />
            </button>
            <button
              type="button"
              className="iconbtn tiny"
              title={t("queue.remove")}
              onClick={() => onCancel(item.id)}
            >
              <IconClose size={12} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
