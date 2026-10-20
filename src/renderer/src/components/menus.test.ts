import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

/**
 * A menu that is in the DOM but not on the screen.
 *
 * The dropdowns are drawn in the document body and placed by hand, because the
 * chat header scrolls and a scroll container clips its children. The price of
 * that is that the position is not CSS any more: a menu that forgets its
 * coordinates is not misplaced, it is *unplaced* — it lands wherever the page
 * happens to end, which is below the window, and the user sees nothing at
 * all. That is exactly how the session menu behaved.
 *
 * The tests read the sources: there is no DOM in the project's tests, and
 * these mistakes are about wiring, not about pixels.
 */
const here = dirname(fileURLToPath(import.meta.url))
const components = join(here, "..", "components")
const ui = readFileSync(join(components, "ui.tsx"), "utf8")
const sessionActions = readFileSync(join(components, "SessionActions.tsx"), "utf8")
const exportMenu = readFileSync(join(components, "ExportMenu.tsx"), "utf8")

describe("every floating menu is placed", () => {
  it("the picker names its position", () => {
    expect(ui).toMatch(/style=\{\{ top: box\?\.top, left: box\?\.left/)
  })

  it("the session menu names its position", () => {
    expect(sessionActions).toMatch(/style=\{\{ top: box\?\.top, left: box\?\.left/)
  })

  it("the export menu names its position", () => {
    expect(exportMenu).toMatch(/style=\{\{ top: box\?\.top, left: box\?\.left/)
  })
})

describe("the menus are drawn in the document body", () => {
  it("so that no scroll container can clip them", () => {
    expect(ui).toMatch(/createPortal\(menu, document\.body\)/)
    expect(sessionActions).toMatch(/createPortal\(menu, document\.body\)/)
    expect(exportMenu).toMatch(/createPortal\(menu, document\.body\)/)
  })
})
