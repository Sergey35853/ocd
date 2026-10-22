// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest"
import { addTag, allTags, readTags, removeTag, setTags } from "../lib/tags"

/**
 * The labels a person puts on a conversation.
 *
 * They are pure local state, so the whole behaviour is the shape of the store:
 * a tag is added once no matter how often it is offered, the last tag taken off
 * leaves nothing behind, and the same empty array comes back while there is
 * nothing to show.
 *
 * Each test uses its own session ids: the module keeps its cache for the life of
 * the file, which is exactly what a browser tab does, and the assertions are
 * written to match that.
 */
beforeEach(() => {
  try {
    localStorage.clear()
  } catch {
    /* no storage in this environment */
  }
})

describe("session tags", () => {
  it("is empty at first and hands back one shared empty array", () => {
    expect(readTags("ses_a")).toEqual([])
    expect(readTags("ses_a")).toBe(readTags("ses_a"))
  })

  it("adds once, trims, and keeps the order", () => {
    addTag("ses_b", "важное")
    addTag("ses_b", "важное")
    addTag("ses_b", "  доделать  ")
    expect(readTags("ses_b")).toEqual(["важное", "доделать"])
  })

  it("ignores a tag that is only spaces", () => {
    addTag("ses_f", "   ")
    expect(readTags("ses_f")).toEqual([])
  })

  it("replaces the whole set on setTags and deduplicates", () => {
    setTags("ses_g", ["one", "two", "one", " two "])
    expect(readTags("ses_g")).toEqual(["one", "two"])
  })

  it("clears the entry when the last tag is taken off", () => {
    setTags("ses_c", ["solo", "two"])
    removeTag("ses_c", "solo")
    expect(readTags("ses_c")).toEqual(["two"])
    removeTag("ses_c", "two")
    expect(readTags("ses_c")).toEqual([])
    expect(allTags()).not.toContain("solo")
  })

  it("lists distinct tags across conversations", () => {
    setTags("ses_d", ["alpha"])
    setTags("ses_e", ["alpha", "beta"])
    const tags = allTags()
    expect(tags).toContain("alpha")
    expect(tags).toContain("beta")
  })
})
