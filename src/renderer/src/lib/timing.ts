import type { MessageInfo } from "@shared/types"

/** How long a finished turn took, keyed by the prompt that started it. */
export type TurnTimes = Record<string, number>

/** Longest turn to keep per session; older ones say little about the next one. */
const HISTORY_LIMIT = 12

/**
 * How long each finished turn took.
 *
 * A turn is one prompt and everything the model did in answer to it, tools
 * included — not one assistant message. With tools in play a single turn spans
 * several messages, so adding up the message durations would count only the
 * steps that happened to be timed and miss the waiting between them.
 *
 * The clock runs from the prompt to the last thing the server marked completed,
 * so tool execution is inside the number the user cares about. Keyed by the
 * prompt's id: that is what the stream needs in order to label the bubble.
 */
export function turnTimes(messages: MessageInfo[]): TurnTimes {
  const ordered = messages
    .filter((message) => message.type === "user" || message.type === "assistant")
    .slice()
    .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))

  const result: TurnTimes = {}
  let start = 0
  let startId = ""
  let lastDone = 0

  const close = () => {
    // Under a second means a clock artefact or a leftover, not a real turn.
    if (startId && lastDone > start && lastDone - start >= 1000) {
      result[startId] = lastDone - start
    }
  }

  for (const message of ordered) {
    if (message.type === "user") {
      close()
      start = message.time?.created ?? 0
      startId = start ? message.id : ""
      lastDone = 0
      continue
    }
    const completed = message.time?.completed
    if (completed && completed > lastDone) lastDone = completed
  }
  close()

  return result
}

/**
 * Samples for the forecast, oldest first, for one conversation.
 *
 * Sorted so the two consumers of these numbers — the tab and the chat — look at
 * the same ordering rather than each sorting for itself.
 */
export function durationSamples(messages: MessageInfo[]): number[] {
  return Object.values(turnTimes(messages)).sort((a, b) => a - b)
}

/**
 * How much longer the running turn is expected to take.
 *
 * The median of past turns, not the mean: tool-heavy turns vary wildly, and one
 * two-minute outlier would drag an average into minutes and leave a countdown
 * stuck near zero for the whole turn.
 *
 * Returns null when there is nothing to learn from — a first conversation, or
 * one whose turns have no timings. A wrong countdown is worse than none.
 */
export function remainingEstimate(
  samples: number[],
  elapsed: number,
  /** Turn overruns this often, so the estimate errs on the generous side. */
  quantile = 0.7,
): number | null {
  const usable = samples.filter((ms) => ms >= 1000 && ms < 15 * 60_000)
  if (usable.length < 2) return null

  const sorted = usable.slice().sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))
  const target = sorted[index]

  // Once the turn is past its own estimate the prediction has told us all it
  // can; keep counting up instead of showing a negative countdown.
  if (elapsed >= target) return 0
  return target - elapsed
}

/** "1:24", "0:07", "12:05" — minutes and seconds, or h:mm past an hour. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  const pad = (value: number) => String(value).padStart(2, "0")
  if (hours) return `${hours}:${pad(minutes)}:${pad(seconds)}`
  return `${minutes}:${pad(seconds)}`
}

/**
 * Fold a finished turn into the stored history for a conversation.
 *
 * Kept here rather than in the store so the shape of the data stays in one
 * place: the store holds it, the chat reads it, both agree on the rule.
 */
export function withTurnTime(history: number[] | undefined, ms: number): number[] {
  const next = [...(history ?? []), ms]
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next
}
