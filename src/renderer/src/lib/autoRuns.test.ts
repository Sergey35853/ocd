import { describe, expect, it } from "vitest"
import { CATCH_UP_MS, dueMoment, lastDue, stampKey } from "./autoRuns"
import type { AutoRun } from "@shared/types"

/**
 * The conversations that start by themselves.
 *
 * The rule fires once for the moment it was due, and not again for the rest
 * of the day — and a start that was missed hours ago is a different moment,
 * not a late one.
 */
const RULE: AutoRun = {
  id: "r1",
  prompt: "собери отчёт",
  agent: "",
  time: "09:00",
  days: [],
  enabled: true,
}

/** A moment, in the machine's own time. */
function at(hours: number, minutes: number, day = 21): Date {
  const date = new Date(2026, 9, day, hours, minutes, 0, 0)
  return date
}

/** The weekday of the day the tests use, so nothing is guessed. */
const WEEKDAY = at(12, 0).getDay()

describe("the auto-runs", () => {
  it("finds the moment it was last due", () => {
    const now = at(14, 30)
    const due = lastDue(RULE, now)
    expect(due).not.toBeNull()
    expect(due?.getHours()).toBe(9)
    expect(due?.getMinutes()).toBe(0)
  })

  it("does not run a rule that is switched off", () => {
    expect(dueMoment({ ...RULE, enabled: false }, at(14, 30))).toBeNull()
  })

  it("does not run a rule with no prompt", () => {
    expect(dueMoment({ ...RULE, prompt: "  " }, at(14, 30))).toBeNull()
  })

  it("does not run a rule whose days do not include today", () => {
    const today = at(9, 30)
    // A day that is not today.
    const other = (WEEKDAY + 1) % 7
    expect(dueMoment({ ...RULE, days: [other] }, today)).toBeNull()
  })

  it("runs on the days it names", () => {
    // Shortly after the slot, so the start is not already too old to run.
    const today = at(9, 30)
    expect(dueMoment({ ...RULE, days: [WEEKDAY] }, today)).not.toBeNull()
  })

  it("does not run a start that was missed long ago", () => {
    // The machine was asleep through the moment and woke up much later.
    const now = at(14, 30)
    const due = lastDue(RULE, now)
    expect(due).not.toBeNull()
    expect(now.getTime() - (due?.getTime() ?? 0)).toBeGreaterThan(CATCH_UP_MS)
    expect(dueMoment(RULE, now)).toBeNull()
  })

  it("runs a start that was missed by a little", () => {
    const now = at(10, 30)
    const due = lastDue(RULE, now)
    expect(now.getTime() - (due?.getTime() ?? 0)).toBeLessThan(CATCH_UP_MS)
    expect(dueMoment(RULE, now)).not.toBeNull()
  })

  it("tells one moment from another", () => {
    // The rule fires once a day, so the same day has one moment whatever the
    // hour — and a different day has another.
    const today = lastDue(RULE, at(9, 30))!
    const tomorrow = lastDue(RULE, at(9, 30, 22))!
    expect(stampKey(RULE, today)).not.toBe(stampKey(RULE, tomorrow))
  })
})
