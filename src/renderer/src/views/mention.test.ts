import { describe, expect, it } from "vitest"
import { mentionAt } from "./mention"

/**
 * The file search opens on `@`.
 *
 * The rule has to be narrow: a sign in the middle of a word is part of that
 * word, and a mention with a space in it has already ended. Both mistakes
 * would open a search nobody asked for, right in the middle of a sentence.
 */
describe("a file mention", () => {
  it("opens on a sign that starts a word", () => {
    expect(mentionAt("@read", 5)).toBe("read")
    expect(mentionAt("look at @read", 13)).toBe("read")
  })

  it("is empty right after the sign", () => {
    expect(mentionAt("@", 1)).toBe("")
  })

  it("does not open in the middle of a word", () => {
    // An address, not a mention.
    expect(mentionAt("write to me@example", 19)).toBeNull()
  })

  it("ends at the first space", () => {
    expect(mentionAt("@read the file", 13)).toBeNull()
  })

  it("looks only at what is before the caret", () => {
    expect(mentionAt("@read and more", 5)).toBe("read")
  })

  it("is not there at all without a sign", () => {
    expect(mentionAt("just words", 10)).toBeNull()
  })
})
