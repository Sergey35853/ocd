import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

/**
 * The transcript must not be redrawn while the model writes.
 *
 * The store's context changes ten times a second while an answer is being
 * written, and every turn in the list listened to it: a hundred messages
 * meant a hundred trees walked for every piece of text that arrived. The
 * fix is two halves — the turn is memoised, and the turn takes nothing from
 * the store — and either half alone does nothing.
 */
const here = dirname(fileURLToPath(import.meta.url))
const chat = readFileSync(join(here, "ChatView.tsx"), "utf8")

describe("a turn is drawn once and then left alone", () => {
  it("is memoised", () => {
    expect(chat).toMatch(/const Turn = memo\(TurnInner\)/)
  })

  it("takes nothing from the store", () => {
    // The turn's own body: the store would change with the running turn, and
    // every turn in the list would be redrawn with it.
    const body = chat.slice(chat.indexOf("function TurnInner("), chat.indexOf("const Turn = memo("))
    expect(body).not.toMatch(/useStore\(\)/)
  })

  it("gets its actions as stable props", () => {
    // A callback written inline would change on every render and would make
    // the memo useless.
    expect(chat).toMatch(/onStop=\{stopTurn\}/)
    expect(chat).toMatch(/onSpeak=\{speakText\}/)
    expect(chat).not.toMatch(/onStop=\{\(\) =>/)
  })
})
