import { describe, expect, it } from "vitest"
import { nextActiveTab, pruneTabs, type OpenTab } from "./tabs"

const tab = (sessionId: string, openedAt = 0): OpenTab => ({ sessionId, openedAt })
const ids = (tabs: OpenTab[]) => tabs.map((item) => item.sessionId)

describe("pruneTabs", () => {
  it("drops a tab whose session the server no longer lists", () => {
    const tabs = [tab("here", 1), tab("gone", 1)]
    expect(ids(pruneTabs(tabs, new Set(["here"]), 2))).toEqual(["here"])
  })

  it("keeps tabs restored from disk that the server still lists", () => {
    // Restored tabs carry 0, so the first list that arrives judges them.
    const tabs = [tab("a"), tab("b")]
    expect(ids(pruneTabs(tabs, new Set(["a", "b"]), 1))).toEqual(["a", "b"])
  })

  it("keeps a tab opened after the list in hand", () => {
    // The list now in hand (fetch 2) predates this tab (opened at 2), so it
    // cannot mention it and must not be used to close it. This is the "+"
    // button: create, open the tab, then ask for the session list.
    const tabs = [tab("older", 1), tab("fresh", 2)]
    expect(ids(pruneTabs(tabs, new Set(["older"]), 2))).toEqual(["older", "fresh"])
  })

  it("judges that tab as soon as a newer list arrives", () => {
    const tabs = [tab("fresh", 2)]
    expect(ids(pruneTabs(tabs, new Set(["fresh"]), 3))).toEqual(["fresh"])
    expect(pruneTabs(tabs, new Set(), 3)).toEqual([])
  })

  it("leaves the order of the surviving tabs alone", () => {
    const tabs = [tab("a", 1), tab("b", 1), tab("c", 1)]
    expect(ids(pruneTabs(tabs, new Set(["c", "a"]), 2))).toEqual(["a", "c"])
  })
})

describe("nextActiveTab", () => {
  it("keeps the active tab when it survived the prune", () => {
    expect(nextActiveTab([tab("a"), tab("b")], "a")).toBe("a")
  })

  it("falls back to the rightmost tab when the active one is gone", () => {
    expect(nextActiveTab([tab("a"), tab("b")], "closed")).toBe("b")
  })

  it("has nothing to fall back to when every tab is gone", () => {
    expect(nextActiveTab([], "closed")).toBeNull()
  })
})
