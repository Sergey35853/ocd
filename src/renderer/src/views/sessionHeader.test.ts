import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

/**
 * The header must talk about the session, not about the next turn.
 *
 * Three things went wrong here, and none of them announced itself: the model
 * picker was drawn inside a scrolling header and came out cut off (the menu
 * was in the DOM, the user just could not see it); the agent picker only
 * changed what the *next* prompt would carry, while the session itself kept
 * the old agent; and the history stopped at the two hundredth message, so the
 * beginning of a long conversation was simply gone.
 *
 * The tests read the sources: the project runs in node with no DOM, and these
 * mistakes are about wiring, not about pixels.
 */
const here = dirname(fileURLToPath(import.meta.url))
const chat = readFileSync(join(here, "ChatView.tsx"), "utf8")
const store = readFileSync(join(here, "..", "lib", "store.tsx"), "utf8")
const ui = readFileSync(join(here, "..", "components", "ui.tsx"), "utf8")
const css = readFileSync(join(here, "..", "styles.css"), "utf8")

describe("the header speaks about the session", () => {
  it("pins the agent on the session, not only in the next prompt", () => {
    // The agent used to travel with every prompt, so the picker spoke about
    // the next turn and said nothing about the conversation itself.
    expect(chat).toMatch(/store\.setAgent\(key, sessionId\)/)
    expect(store).toMatch(/api\.setSessionAgent\(sessionId, agent\)/)
  })

  it("shows the agent the server has, not the app's default", () => {
    expect(chat).toMatch(/selected=\{sessionAgent \?\? store\.settings\?\.defaultAgent/)
  })

  it("keeps the model in step with the server", () => {
    // The server owns the model: it may be changed from another client, and
    // the header has to say what is true now.
    expect(store).toMatch(/sessionModels/)
    expect(chat).toMatch(/storeModel === undefined/)
  })
})

describe("the model picker offers the reasoning level", () => {
  it("reads the levels the server lists for the model", () => {
    expect(chat).toMatch(/model\?\.variants/)
  })

  it("sends the level together with the model", () => {
    // The server keeps the level inside the model reference; a model without
    // it would be pinned to the default level.
    expect(store).toMatch(/setSessionModel\(sessionId, ref\)/)
    expect(store).toMatch(/variant \? \{ variant \}/)
  })
})

describe("the dropdown is not cut off by the header", () => {
  it("draws the menu in the document body", () => {
    // The header scrolls sideways on a narrow window, and a scroll container
    // clips its children: the menu was in the DOM and invisible.
    expect(ui).toMatch(/createPortal\(menu, document\.body\)/)
  })

  it("positions the menu itself instead of hanging it off the button", () => {
    expect(css).toMatch(/\.picker-menu \{\s*position: fixed/)
  })
})

describe("the history has no end", () => {
  it("asks for one page at a time", () => {
    // A fixed limit of two hundred messages silently dropped the beginning of
    // every long conversation.
    expect(chat).toMatch(/messagePage\(sessionId, \{ limit: PAGE_SIZE \}\)/)
    expect(chat).not.toMatch(/limit: 200/)
  })

  it("fetches the page above when the user scrolls up", () => {
    expect(chat).toMatch(/cursor: history\.cursor/)
    expect(chat).toMatch(/node\.scrollTop < 160/)
  })
})
