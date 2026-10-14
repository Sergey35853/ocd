import { useEffect, useState } from "react"
import type { FinishNotice } from "@shared/types"

/**
 * The finished-reply card that appears in the bottom-right corner.
 *
 * The whole card is one button because the only thing anybody wants from a
 * finished-turn notification is the conversation it is about. It never takes
 * focus on its own: the click hands focus to the chat, and a notification that
 * stole the keyboard would interrupt the work it is reporting on.
 */
export function NoticeCard() {
  const [notice, setNotice] = useState<FinishNotice | null>(null)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    return window.ocd.notice.onShow((next) => {
      // A card that replaces another one replays its entrance, so a second
      // reply arriving on top of the first still reads as new.
      setLeaving(false)
      setNotice(next)
    })
  }, [])

  if (!notice) return null

  const open = () => {
    setLeaving(true)
    // Out first, then hand over: dismissing and opening in the same tick would
    // put the chat behind the card's own fade-out.
    window.setTimeout(() => void window.ocd.notice.dismiss(notice.sessionId), 160)
  }

  return (
    <button
      type="button"
      className={
        "notice" + (notice.failed ? " notice--failed" : "") + (leaving ? " notice--leaving" : "")
      }
      onClick={open}
    >
      <div className="notice-head">
        <span className="notice-dot" />
        <span className="notice-title">{notice.title}</span>
      </div>
      <div className="notice-text">{notice.body}</div>
      <div className="notice-hint">открыть беседу</div>
    </button>
  )
}
