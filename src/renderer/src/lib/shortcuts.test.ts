import { describe, expect, it } from "vitest"
import {
  acceleratorFor,
  actionFor,
  defaultAccelerator,
  matchesAccelerator,
  prettyAccelerator,
} from "./shortcuts"

/**
 * A shortcut has to fire when it was asked for, and only then.
 *
 * The mistake that matters is a binding that fires while another modifier is
 * held: the user presses Control+Shift+K for something else and the app
 * answers anyway. The comparison is therefore exact, on every modifier.
 */
function press(
  key: string,
  mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {},
): KeyboardEvent {
  return {
    key,
    ctrlKey: Boolean(mods.ctrl),
    altKey: Boolean(mods.alt),
    shiftKey: Boolean(mods.shift),
    metaKey: Boolean(mods.meta),
  } as KeyboardEvent
}

describe("a combination", () => {
  it("fires on exactly its own key", () => {
    expect(matchesAccelerator(press("k", { ctrl: true }), "Control+K")).toBe(true)
    expect(matchesAccelerator(press("k"), "Control+K")).toBe(false)
  })

  it("does not fire with an extra modifier", () => {
    expect(matchesAccelerator(press("k", { ctrl: true, alt: true }), "Control+K")).toBe(false)
    expect(matchesAccelerator(press("k", { ctrl: true, shift: true }), "Control+K")).toBe(false)
  })

  it("cares about the shift in the combination itself", () => {
    expect(matchesAccelerator(press("L", { ctrl: true, shift: true }), "Control+Shift+L")).toBe(
      true,
    )
    expect(matchesAccelerator(press("l", { ctrl: true }), "Control+Shift+L")).toBe(false)
  })

  it("knows the keys that are longer than one character", () => {
    expect(matchesAccelerator(press("Tab", { ctrl: true }), "Control+Tab")).toBe(true)
    expect(matchesAccelerator(press("F2"), "F2")).toBe(true)
  })

  it("knows punctuation", () => {
    expect(matchesAccelerator(press(",", { ctrl: true }), "Control+,")).toBe(true)
  })

  it("never fires for an empty binding", () => {
    expect(matchesAccelerator(press("k", { ctrl: true }), "")).toBe(false)
  })
})

describe("the bindings of the app", () => {
  it("start with the combinations people expect", () => {
    expect(defaultAccelerator("palette")).toBe("Control+K")
    expect(defaultAccelerator("newSession")).toBe("Control+N")
  })

  it("use the user's own combination when there is one", () => {
    expect(acceleratorFor("palette", { palette: "Control+Shift+P" })).toBe("Control+Shift+P")
    expect(acceleratorFor("palette", { palette: "" })).toBe("")
    expect(acceleratorFor("palette", undefined)).toBe("Control+K")
  })

  it("find the action a key press asks for", () => {
    expect(actionFor(press("k", { ctrl: true }), undefined)).toBe("palette")
    expect(actionFor(press("k", { ctrl: true }), { palette: "Control+Shift+P" })).toBeNull()
    expect(actionFor(press("p", { ctrl: true, shift: true }), { palette: "Control+Shift+P" })).toBe(
      "palette",
    )
  })
})

describe("how a combination is shown", () => {
  it("says Ctrl, not CommandOrControl", () => {
    expect(prettyAccelerator("CommandOrControl+K")).toBe("Ctrl+K")
    expect(prettyAccelerator("Control+Shift+L")).toBe("Control+Shift+L")
    expect(prettyAccelerator("")).toBe("—")
  })
})
