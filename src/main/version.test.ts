import { describe, expect, it } from "vitest"
import { isNewer } from "./version"

describe("isNewer", () => {
  it("says no when the channel holds the version already installed", () => {
    expect(isNewer("0.1.9", "0.1.9")).toBe(false)
  })

  it("says yes for a later version", () => {
    expect(isNewer("0.1.10", "0.1.9")).toBe(true)
    expect(isNewer("0.2.0", "0.1.9")).toBe(true)
    expect(isNewer("1.0.0", "0.1.9")).toBe(true)
  })

  it("says no for an earlier one", () => {
    expect(isNewer("0.1.8", "0.1.9")).toBe(false)
    expect(isNewer("0.1.10", "0.1.11")).toBe(false)
  })

  it("compares numbers, not letters", () => {
    // "0.1.9" > "0.1.10" as text, and that is exactly backwards.
    expect(isNewer("0.1.10", "0.1.9")).toBe(true)
  })

  it("ignores a v prefix and a build suffix", () => {
    expect(isNewer("v0.2.0", "0.1.9")).toBe(true)
    expect(isNewer("v0.1.9", "0.1.9")).toBe(false)
    expect(isNewer("0.1.9-beta.2", "0.1.9")).toBe(false)
  })

  it("treats a missing channel version as nothing to install", () => {
    expect(isNewer(undefined, "0.1.9")).toBe(false)
    expect(isNewer("", "0.1.9")).toBe(false)
  })

  it("falls back to a plain comparison when a part is not a number", () => {
    expect(isNewer("dev", "0.1.9")).toBe(true)
    expect(isNewer("0.1.9", "0.1.9")).toBe(false)
  })
})