/**
 * Commands the shell asks the conversation to carry out.
 *
 * The palette lives in the shell and the conversation lives in the chat: the
 * palette knows what the app can do, the chat knows what the open session can
 * do. A short list of named commands is the seam between them — a window
 * event, because both live in the same page.
 */

export type ChatCommand = "compact" | "terminal" | "fileSearch" | "move"

const EVENT = "ocd:chat-command"

/** Ask the open conversation to do something. */
export function askChat(command: ChatCommand): void {
  window.dispatchEvent(new CustomEvent<ChatCommand>(EVENT, { detail: command }))
}

/** Listen for what the conversation is asked to do. */
export function onChatCommand(handler: (command: ChatCommand) => void): () => void {
  const listener = (event: Event) => {
    handler((event as CustomEvent<ChatCommand>).detail)
  }
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
