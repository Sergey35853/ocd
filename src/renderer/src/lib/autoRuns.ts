import type { AutoRun } from "@shared/types"

/**
 * The conversations that start by themselves.
 *
 * The same task every morning: the app opens the conversation and sends the
 * prompt, so the work is already waiting when the user sits down. The rules
 * live in the settings and are read from there — the store is the only thing
 * that knows how to open a conversation and send a prompt.
 */

/**
 * How long a missed start stays missed.
 *
 * A rule that was due six hours ago and did not run is not late: it is a
 * different moment, and running it now would be a surprise. Two hours is
 * long enough to cover a machine that was asleep through the moment, and
 * short enough that nothing arrives out of nowhere.
 */
export const CATCH_UP_MS = 2 * 60 * 60 * 1000

/**
 * The moment the rule was last due.
 *
 * The rules fire on the weekdays they name, at the time they name. The
 * answer is the most recent such moment that has already passed — which may
 * be today, or a day or a week ago.
 */
export function lastDue(rule: AutoRun, now: Date): Date | null {
  const [hours, minutes] = rule.time.split(":").map((part) => Number(part) || 0)
  for (let back = 0; back < 8; back += 1) {
    const day = new Date(now)
    day.setDate(day.getDate() - back)
    day.setHours(hours, minutes, 0, 0)
    if (rule.days.length && !rule.days.includes(day.getDay())) continue
    if (day.getTime() > now.getTime()) continue
    return day
  }
  return null
}

/** The key that says the rule already ran for that moment. */
export function stampKey(rule: AutoRun, due: Date): string {
  return `ocd.autorun.${rule.id}.${due.getTime()}`
}

/**
 * Whether the rule is due now.
 *
 * A rule with no weekdays named runs every day — the empty list is not "never",
 * it is "every day", because a rule that never runs is a rule nobody set.
 */
export function isDue(rule: AutoRun, now: Date, alreadyRan: (key: string) => boolean): boolean {
  if (!rule.enabled) return false
  if (!rule.prompt.trim()) return false
  const due = lastDue(rule, now)
  if (!due) return false
  if (now.getTime() - due.getTime() > CATCH_UP_MS) return false
  return !alreadyRan(stampKey(rule, due))
}

/**
 * The moment the rule is due, or null when it is not.
 *
 * The same question as `isDue`, but the answer is the moment rather than a
 * yes — the caller has to stamp that moment to know it has run.
 */
export function dueMoment(rule: AutoRun, now: Date): Date | null {
  if (!rule.enabled) return null
  if (!rule.prompt.trim()) return null
  const due = lastDue(rule, now)
  if (!due) return null
  if (now.getTime() - due.getTime() > CATCH_UP_MS) return null
  return due
}
