/**
 * What jsdom does not have and the app needs.
 *
 * The tests that run in a browser-like environment are the ones that draw
 * components, and Chromium gives them a few things jsdom leaves out. Each is
 * stubbed here with the smallest thing that behaves like the real one.
 */

/** jsdom has no `matchMedia`; the app asks it about the colour scheme. */
if ( typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
}

/** jsdom does not implement `ResizeObserver`, and the panes watch their box. */
if (typeof globalThis.ResizeObserver === "undefined") {
  class NoopResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver
}
