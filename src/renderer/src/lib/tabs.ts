/**
 * Open tabs, and the one rule that governs them.
 *
 * Tabs outlive the list they came from: a session can be deleted somewhere else,
 * and a tab pointing at nothing has to be closed. The subtlety is *when* a tab
 * may be judged, and that is what this module exists to say in one place.
 */

export interface OpenTab {
  sessionId: string
  /**
   * Which session list was the newest when this tab was opened.
   *
   * Tabs restored from disk carry 0, so they are judged by the first list that
   * arrives.
   */
  openedAt: number
}

/**
 * Drop tabs whose session is gone, judging each only by a list fetched after
 * the tab was opened.
 *
 * `fetched` is the id of the session list now in hand. A tab opened at or after
 * that id postdates the list, so the list cannot speak for it — and asking
 * anyway is what deleted the tab the "+" button had just made, a moment before
 * the list that would have confirmed it arrived.
 */
export function pruneTabs(
  tabs: OpenTab[],
  alive: ReadonlySet<string>,
  fetched: number,
): OpenTab[] {
  return tabs.filter((tab) => tab.openedAt >= fetched || alive.has(tab.sessionId))
}

/**
 * Which tab to show after a prune: the active one if it survived, otherwise the
 * rightmost of what is left, otherwise nothing.
 */
export function nextActiveTab(tabs: OpenTab[], current: string | null): string | null {
  if (current && tabs.some((tab) => tab.sessionId === current)) return current
  return tabs.at(-1)?.sessionId ?? null
}
