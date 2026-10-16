import { describe, expect, it } from "vitest"
import {
  backendConfigured,
  feedbackEvent,
  installEvent,
  normalizeText,
  shouldReport,
  type Facts,
} from "./feedback"

/**
 * The counter is the whole reason this module exists, and it is wrong in one
 * direction or the other: reported on every launch it measures the author
 * testing his own build, never reported it cannot answer the question at all.
 * So the rule is asserted directly — one mark per version — along with what each
 * event is allowed to carry.
 */

const FACTS: Facts = {
  installId: "1f0a5a70-0000-4000-8000-000000000000",
  version: "0.1.13",
  os: "Windows_NT 10.0.22631",
  arch: "x64",
  electron: "44.5.1",
  locale: "ru",
}

const AT = new Date("2026-10-16T19:00:00.000Z")

describe("shouldReport", () => {
  it("reports a version that has never been seen", () => {
    expect(shouldReport([], "0.1.13")).toBe(true)
  })

  it("stays quiet for a version already marked", () => {
    expect(shouldReport(["0.1.12", "0.1.13"], "0.1.13")).toBe(false)
  })

  it("reports again after the app has been updated", () => {
    expect(shouldReport(["0.1.12"], "0.1.13")).toBe(true)
  })

  it("does not confuse a version with one that merely starts the same", () => {
    // "0.1.1" is a prefix of "0.1.13": a check that only looks at the beginning
    // would report 0.1.13 as already marked and the machine would vanish from
    // the count for the rest of the release.
    expect(shouldReport(["0.1.1"], "0.1.13")).toBe(true)
  })
})

describe("installEvent", () => {
  it("names the build and the machine", () => {
    const event = installEvent(FACTS, AT)
    expect(event).toMatchObject({
      app: "OCD",
      event: "install",
      at: "2026-10-16T19:00:00.000Z",
      version: "0.1.13",
      installId: FACTS.installId,
    })
  })

  it("carries nothing a person wrote", () => {
    // The mark goes out on every machine that ever launches the app, so it has
    // to be answerable to "what leaves here" without qualifications.
    const event = installEvent(FACTS, AT)
    expect(Object.keys(event).sort()).toEqual(
      ["app", "arch", "at", "electron", "event", "installId", "locale", "os", "version"].sort(),
    )
  })
})

describe("feedbackEvent", () => {
  it("keeps what the sender wrote", () => {
    const event = feedbackEvent(
      FACTS,
      { kind: "complaint", message: "  Привет  ", contact: "почта@example.com" },
      AT,
    )
    expect(event.kind).toBe("complaint")
    expect(event.message).toBe("Привет")
    expect(event.contact).toBe("почта@example.com")
  })

  it("leaves out a contact that was never filled in", () => {
    // An empty cell in a sheet reads as "this person refused to be contacted",
    // which is a different statement from the one the screen made by leaving
    // the field blank.
    const event = feedbackEvent(FACTS, { kind: "wish", message: "Пожелание", contact: "   " }, AT)
    expect("contact" in event).toBe(false)
  })

  it("drops the log unless the box was ticked", () => {
    const log = "C:\\Users\\someone\\AppData\\Roaming\\OCD\\logs\\ocd.log"
    expect("log" in feedbackEvent(FACTS, { kind: "problem", message: "упало", log }, AT)).toBe(
      false,
    )
    expect(
      feedbackEvent(FACTS, { kind: "problem", message: "упало", tech: true, log }, AT).log,
    ).toBe(log)
  })

  it("falls back to a kind it recognises", () => {
    const event = feedbackEvent(FACTS, { kind: "произвол" as never, message: "что-то" }, AT)
    expect(event.kind).toBe("other")
  })
})

describe("normalizeText", () => {
  it("caps a wall of text instead of refusing it", () => {
    // Rejecting the send loses the message; cutting it keeps the complaint.
    expect(normalizeText("а".repeat(5000), 100)).toHaveLength(100)
  })

  it("treats nothing as nothing", () => {
    expect(normalizeText(undefined, 100)).toBe("")
    expect(normalizeText("   ", 100)).toBe("")
  })
})

describe("backendConfigured", () => {
  it("is false in a build with no endpoint", () => {
    // The reason the About screen asks: a build without BACKEND_URL has to say
    // so rather than offer a button that fails when it is pressed. Flip the
    // constant in feedback.ts and this test is the thing to update.
    expect(backendConfigured()).toBe(false)
  })
})