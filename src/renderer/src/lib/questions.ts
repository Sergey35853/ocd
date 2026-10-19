/**
 * The questions a turn is waiting on, and where they are asked.
 *
 * A question reaches the interface twice: the tool call carries the text and
 * the options, and the server parks the same thing in a form and holds the turn
 * until it is answered. The first arrives with the block, the second a moment
 * later, and either one alone is enough to show the user what is being asked.
 *
 * They are gathered here rather than rendered where the tool block happens to
 * sit, because a block can be anywhere in a long conversation: a question about
 * the format of a deck was being answered three turns above the one asking it,
 * with the reasoning and the reply to it below it. The card now goes to the end
 * of the stream, next to the composer, which is where the user is looking.
 */

import type { MessageContent, MessageInfo, PendingForm } from "@shared/types"
import { chronological } from "./format"
import { callKey } from "./diff"

export interface ToolQuestion {
  header?: string
  question: string
  /** `value` is what the server expects; the tool input has no separate one. */
  options: Array<{ label: string; description?: string; value: string }>
}

/**
 * Read a question out of a tool call.
 *
 * Matched on shape rather than on a tool name: the server reports these calls
 * with an empty tool name, so keying on the name would match nothing.
 */
export function questionOf(block: MessageContent): ToolQuestion | null {
  const input = block.state?.input
  if (!input || typeof input !== "object") return null
  const list = (input as Record<string, unknown>).questions
  if (!Array.isArray(list) || list.length === 0) return null

  const first = list[0] as Record<string, unknown>
  const question = typeof first.question === "string" ? first.question : null
  if (!question) return null

  const options: Array<{ label: string; description?: string; value: string }> = []
  if (Array.isArray(first.options)) {
    for (const raw of first.options) {
      const record = raw as Record<string, unknown>
      const label = typeof record.label === "string" ? record.label : ""
      if (!label) continue
      options.push({
        label,
        // No form means no authoritative value, so the label doubles as the
        // answer the user would type.
        value: typeof record.value === "string" ? record.value : label,
        description: typeof record.description === "string" ? record.description : undefined,
      })
    }
  }

  return {
    header: typeof first.header === "string" ? first.header : undefined,
    question,
    options,
  }
}

/** One question to answer, with the form that makes it answerable when there is one. */
export interface PendingQuestion {
  /** Stable key for React. */
  key: string
  form?: PendingForm
  /** Text and options read from the tool call, used until the form arrives. */
  fallback?: ToolQuestion | null
}

/**
 * Every question of this conversation that still needs an answer, in the order
 * it was asked.
 *
 * Questions are ordered by their place in the chat, and one whose tool call is
 * not in the loaded history goes last: it has no position to be found at, and
 * it still has to be visible rather than silently lost.
 *
 * `settled` names the calls this window answered or dismissed. The server only
 * marks a call finished a beat after the reply lands, and until it does the
 * call reads as still running, which would leave a card that looks live over an
 * answer already given.
 */
export function pendingQuestions(
  messages: MessageInfo[],
  forms: PendingForm[],
  settled: string[] = [],
): PendingQuestion[] {
  const byCall = new Map<string, PendingForm>()
  for (const form of forms) {
    const call = form.metadata?.tool?.id
    if (call) byCall.set(call, form)
  }

  const done = new Set(settled)
  const asked: PendingQuestion[] = []
  const taken = new Set<string>()

  for (const message of chronological(messages)) {
    for (const block of message.content ?? []) {
      if (block.type !== "tool") continue
      const fallback = questionOf(block)
      if (!fallback) continue
      const call = callKey(block)
      const form = call ? byCall.get(call) : undefined
      if (call && form) taken.add(call)
      // Answered or dismissed: the question stays in the transcript, but the
      // model is no longer waiting. Without this the card is rebuilt from the
      // block on every render and outlives the answer.
      if (!form && (block.state?.status === "completed" || (call && done.has(call)))) continue
      asked.push({
        key: call ?? `${message.id}-${asked.length}`,
        ...(form ? { form } : {}),
        fallback,
      })
    }
  }

  // Forms the transcript does not account for: asked in another window, or
  // beyond the part of the history that was loaded. Dropping these is how a
  // question becomes invisible and the turn looks hung.
  for (const form of forms) {
    const call = form.metadata?.tool?.id
    if (call && taken.has(call)) continue
    asked.push({ key: form.id, form })
  }

  return asked
}

/**
 * Which tool calls are waiting for an answer, keyed by call id.
 *
 * The link comes from the form's metadata, which names the exact call. A tool
 * call reports an empty name, so matching on the tool name would put every
 * question on every row of the turn.
 */
export function formsByCall(messages: MessageInfo[], forms: PendingForm[]): Map<string, PendingForm> {
  const onScreen = new Set<string>()
  for (const message of messages) {
    for (const block of message.content ?? []) {
      if (block.type !== "tool") continue
      const call = callKey(block)
      if (call) onScreen.add(call)
    }
  }

  const map = new Map<string, PendingForm>()
  for (const form of forms) {
    const call = form.metadata?.tool?.id
    if (call && onScreen.has(call)) map.set(call, form)
  }
  return map
}