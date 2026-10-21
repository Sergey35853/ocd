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

/** The text of the last marked paste, for a composer that asks for it. */
let pending: string | null = null

/** Told when a marked paste arrives. */
const listeners = new Set<(text: string) => void>()

let installed = false

/**
 * Put the bridge in place.
 *
 * The listener is on the window and not inside a component: the two ends of
 * this hand-off are in two different conversations, and only one of them is on
 * screen at a time. A bridge that lived in a hook would be alive only while
 * the component that called it was mounted, and the marker would reach the
 * model as plain text.
 *
 * Calling this more than once does nothing the second time.
 */
export function installClipboardBridge(): void {
  if (installed) return
  if (typeof window === "undefined") return
  installed = true
  window.addEventListener("paste", onPaste, true)
}

/**
 * The paste of a marked text.
 *
 * The marker is swallowed here and nowhere else: what is left is the text
 * itself, and it goes into the field the user pasted into.
 */
function onPaste(event: ClipboardEvent): void {
  const text = event.clipboardData?.getData("text/plain") ?? ""
  if (!text.startsWith(CLIP_MARK)) return
  // Swallow the marker so nothing private-looking lands in the prompt, and so
  // the browser does not insert the text a second time.
  event.preventDefault()
  event.stopPropagation()

  const body = text.slice(CLIP_MARK.length)
  // The field the user pasted into takes the text itself; there is nothing
  // left to hand over afterwards, and nobody is told about it — a consumer
  // that was told would put the same text into the field a second time.
  if (insertInto(event.target, body)) {
    pending = null
    return
  }
  // Pasted anywhere else: the text is kept for whoever wants it.
  pending = body
  for (const listener of listeners) listener(body)
}

/**
 * Put the text where the user is typing.
 *
 * Only a textarea is written to: it is the composer of the chat, while the
 * search boxes of the app are inputs, and a moved exchange has no business in
 * a search box.
 */
function insertInto(target: EventTarget | null, text: string): boolean {
  if (!(target instanceof HTMLTextAreaElement)) return false
  const start = target.selectionStart ?? target.value.length
  const end = target.selectionEnd ?? start
  target.value = target.value.slice(0, start) + text + target.value.slice(end)
  const caret = start + text.length
  target.setSelectionRange(caret, caret)
  // The field listens for `input` rather than for the value: this is what
  // tells it that there is something to send.
  target.dispatchEvent(new Event("input", { bubbles: true }))
  return true
}

/**
 * The text of the last marked paste, if it has not been taken already.
 *
 * It is empty when the text went into a composer: there is nothing left to
 * hand over in that case, and a consumer that wrote it into the composer
 * again would have it there twice.
 */
export function peekClip(): string | null {
  return pending
}

/** Take the text of the last marked paste, and forget it. */
export function takeClip(): string | null {
  const text = pending
  pending = null
  return text
}

/**
 * Be told when a marked paste arrives.
 *
 * Only when it did not land in a composer: the bridge writes the text into
 * the field itself, and a listener that was told about it would write it
 * there a second time.
 */
export function onClipText(listener: (text: string) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * The bridge, as a hook.
 *
 * The bridge works without it — the module puts the listener in place by
 * itself — so this is only for a view that wants to be told when a marked
 * paste arrived somewhere other than a composer.
 */
export function useClipboardBridge(): {
  take(text: string): Promise<void>
  peek(): string | null
} {
  const [arrived, setArrived] = useState<string | null>(null)

  useEffect(() => {
    installClipboardBridge()
    return onClipText((text) => setArrived(text))
  }, [])

  return {
    take: async (text: string) => {
      await navigator.clipboard.writeText(CLIP_MARK + text).catch(() => undefined)
    },
    peek: () => arrived,
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

// The bridge is put in place as soon as the module is loaded: the chat that
// offers the button is loaded at the start of the window, and the button is
// only one of the two ends of this hand-off.
installClipboardBridge()
