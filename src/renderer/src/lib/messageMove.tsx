import type { MessageInfo } from "@shared/types"
import { useEffect, useState } from "react"
import { useStore } from "../lib/store"
import { useT } from "../i18n"
import { IconClipboard } from "../components/Icon"

/**
 * Move one exchange into another conversation.
 *
 * The server has no message-level API (no delete, no move), so this copies the
 * *text* into the other conversation's composer instead. That is honest about
 * what it does: nothing is removed here, and the user can see and adjust what
 * they are about to send.
 *
 * The clipboard is used as the hand-off because it is the only channel that
 * survives a jump between two independently mounted chats, and it leaves the
 * user something to paste even if the target tab never opens.
 */

const CLIP_MARK = "ocd-clip:"

export function useClipboardBridge(): {
  take(text: string): Promise<void>
  peek(): string | null
} {
  const [pending, setPending] = useState<string | null>(null)

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData("text/plain") ?? ""
      if (!text.startsWith(CLIP_MARK)) return
      // Swallow the marker so nothing private-looking lands in the prompt.
      event.preventDefault()
      setPending(text.slice(CLIP_MARK.length))
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [])

  return {
    take: async (text: string) => {
      await navigator.clipboard.writeText(CLIP_MARK + text).catch(() => undefined)
    },
    peek: () => pending,
  }
}

/** Button that copies an exchange for pasting into another conversation. */
export function MoveButton({ text }: { text: string }) {
  const t = useT()
  const store = useStore()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2200)
    return () => clearTimeout(timer)
  }, [copied])

  if (!text.trim()) return null

  return (
    <button
      type="button"
      className="iconbtn"
      title={copied ? t("move.copied") : t("move.to")}
      style={{ width: 24, height: 24 }}
      onClick={async () => {
        await navigator.clipboard
          .writeText(CLIP_MARK + text)
          .then(() => {
            setCopied(true)
            store.toast(t("move.copiedHint"), "info")
          })
          .catch(() => store.toast(t("move.failed"), "error"))
      }}
    >
      <IconClipboard size={13} />
    </button>
  )
}

export { CLIP_MARK }

/** One exchange as plain text, ready to paste elsewhere. */
export function exchangeText(message: MessageInfo): string {
  const body = (message.content ?? [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n\n")
  if (message.type === "user") return message.text ?? ""
  return body
}
