import type { MessageInfo } from "@shared/types"

/**
 * The conversation on screen, and the one it belongs to.
 *
 * A tab strip keeps several conversations open at once and the window shows
 * one of them, so the transcript has to say which conversation the messages
 * belong to. Without that, a page fetched for one conversation is merged into
 * the messages of another.
 */
export interface Transcript {
  /** The conversation the messages belong to. Empty before the first page. */
  sessionId: string
  items: MessageInfo[]
}

/** The transcript of a window that has not shown a conversation yet. */
export const EMPTY_TRANSCRIPT: Transcript = { sessionId: "", items: [] }

/**
 * Put a freshly fetched page into the transcript.
 *
 * A refresh of the same conversation must not throw away the older half the
 * user scrolled up to and read: keep what is above the new page.
 *
 * A page of another conversation replaces the transcript outright. The
 * messages of the conversation the user just left belong to another tab, and
 * keeping them here is how one conversation's question ends up answering in
 * another: the card is built from the whole transcript, so a question that is
 * still open in the first tab shows up in the second one too.
 */
export function mergePage(current: Transcript, sessionId: string, fresh: MessageInfo[]): Transcript {
  if (current.sessionId !== sessionId) return { sessionId, items: fresh }
  const freshIds = new Set(fresh.map((message) => message.id))
  const kept = current.items.filter((message) => !freshIds.has(message.id))
  return { sessionId, items: [...kept, ...fresh] }
}

/**
 * Put an older page in front of the transcript.
 *
 * The page belongs to the conversation that was asked for, so it only goes in
 * front of that conversation's messages.
 */
export function prependOlder(
  current: Transcript,
  sessionId: string,
  older: MessageInfo[],
): Transcript {
  if (current.sessionId !== sessionId) return current
  const known = new Set(current.items.map((message) => message.id))
  const fresh = older.filter((message) => !known.has(message.id))
  return fresh.length ? { ...current, items: [...fresh, ...current.items] } : current
}

/** A prompt that was sent but the server has not listed yet. */
export interface PendingRequest {
  /** The conversation it was sent to. */
  sessionId: string
  message: MessageInfo
}

/**
 * The prompt to show as sent, if it still is one.
 *
 * Two things end it. The server listing it — its copy replaces the optimistic
 * one, matched on the exact body, because the same sentence twice in a row
 * would otherwise leave a phantom bubble on screen. And the user leaving the
 * conversation it was sent to: a request that follows the user into another
 * tab is a request the model never received.
 */
export function pendingRequest(
  current: PendingRequest | null,
  sessionId: string,
  fresh: MessageInfo[],
): PendingRequest | null {
  if (!current) return null
  if (current.sessionId !== sessionId) return null
  const landed = fresh.some(
    (message) => message.type === "user" && message.text === current.message.text,
  )
  return landed ? null : current
}
