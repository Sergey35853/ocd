import { describe, expect, it } from "vitest"
import { clock, withTurnTime } from "./timing"

describe("clock", () => {
  it("reads as minutes and seconds", () => {
    expect(clock(0)).toBe("0:00")
    expect(clock(1000)).toBe("0:01")
    expect(clock(89_000)).toBe("1:29")
    expect(clock(600_000)).toBe("10:00")
  })

  it("adds an hour only when it is needed", () => {
    expect(clock(3_599_000)).toBe("59:59")
    expect(clock(3_600_000)).toBe("1:00:00")
    expect(clock(7_265_000)).toBe("2:01:05")
  })

  it("does not show a negative time for a clock that has not started", () => {
    expect(clock(-1)).toBe("0:00")
  })
})

describe("withTurnTime", () => {
  it("appends a sample to an empty history", () => {
    expect(withTurnTime(undefined, 5000)).toEqual([5000])
  })

  it("appends in order, oldest first", () => {
    expect(withTurnTime([1000, 2000], 3000)).toEqual([1000, 2000, 3000])
  })

  it("keeps the history short enough to stay useful", () => {
    // An unbounded list makes the estimate worse, not better: the turns that
    // mattered are the recent ones.
    let history: number[] | undefined
    for (let i = 0; i < 60; i += 1) history = withTurnTime(history, 1000 + i)
    expect(history?.length).toBeLessThanOrEqual(20)
    // The newest sample is the one kept.
    expect(history?.[history.length - 1]).toBe(1059)
  })
})
