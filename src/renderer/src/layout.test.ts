import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

/**
 * The transcript must fit the window.
 *
 * In a narrow window every message bubble hung off the right edge with its text
 * cut in half, and the header toolbar disappeared past the edge along with it.
 * The cause was not the bubbles: two containers were allowed to keep their
 * min-content width as a floor, so one wide toolbar decided how wide the whole
 * conversation column was on a 412px screen.
 *
 * CSS alone cannot be measured here — the project's tests run in node with no
 * layout engine, and installing jsdom would not lay anything out either, since
 * jsdom reports every box as zero. So what is pinned is the specific mistake:
 * a track or flex item that names its minimum, which is what let the overflow
 * happen, and whose absence is easy to reintroduce as a tidying-up.
 */
const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, "styles.css"), "utf8")

/** The declarations inside one rule block. */
function rule(selector: string, from = 0): string {
  const at = css.indexOf(selector, from)
  if (at === -1) throw new Error(`нет правила ${selector}`)
  const open = css.indexOf("{", at)
  const close = css.indexOf("}", open)
  return css.slice(open + 1, close)
}

/** Every rule for a selector, in file order — media queries repeat them. */
function rules(selector: string): string[] {
  const found: string[] = []
  let at = 0
  for (;;) {
    const next = css.indexOf(selector, at)
    if (next === -1) break
    found.push(rule(selector, next))
    at = next + selector.length
  }
  return found
}

describe("the conversation column may shrink", () => {
  it("lets the shell's main track go below its content", () => {
  // `1fr` is `minmax(auto, 1fr)`. The `auto` minimum is the content's
  // min-content size, which is exactly the floor that pushed the column past
  // the window; `minmax(0, …)` is the only spelling that removes it.
  //
  // Every rule for every variant, not the first one found. There are six: three
  // in the base rules and three again inside the narrow media query, where they
  // win. Fixing the base three left narrow windows exactly as broken while this
  // test passed — a test that names one rule and calls it done is worse than
  // none, because it says the work is done.
  for (const selector of [".shell {", ".shell.no-sidebar {", ".shell.expanded {"]) {
    const found = rules(selector)
    expect(found.length).toBeGreaterThan(0)
    for (const body of found) {
      const columns = body.match(/grid-template-columns:[^;]*/)
      if (!columns) continue
      expect(columns[0]).toMatch(/minmax\(0,\s*1fr\)/)
    }
  }
  expect(rules(".shell {").length).toBeGreaterThanOrEqual(2)
})

  it("lets the chat body go below its content", () => {
    // Same mistake one level down: as a flex item its minimum defaults to
    // `auto`, which is min-content. Its sibling already declares `min-width: 0`.
    expect(rule(".chat-body {")).toMatch(/min-width:\s*0/)
  })

  it("keeps the header toolbar reachable instead of past the edge", () => {
    // The toolbar is wider than a narrow window. Scrolling it keeps every
    // control pressable; clipping it silently removes buttons.
    const head = rule(".chat-head {")
    expect(head).toMatch(/overflow-x:\s*auto/)
    expect(head).toMatch(/min-width:\s*0/)
  })

  it("still uses minmax where the columns already said so", () => {
    // Guards against the fix being "just add overflow hidden": these grids
    // already named their minimum and must keep naming it. Counting would pass
    // on the number going up for the wrong reason; naming them cannot.
    expect(css).toMatch(/grid-template-columns:[^;]*\d+px\s+minmax\(0,\s*1fr\)/)
    expect(css).toMatch(/grid-template-columns:\s*42px 42px minmax\(0,\s*1fr\)|grid-template-columns:[^;]*42px 42px[^;]*1fr/)
  })
})