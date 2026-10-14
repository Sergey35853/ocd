// Preload for the preview pane's `<webview>` guests.
//
// This file is attached ONLY to guests carrying PREVIEW_PARTITION (see
// installPreviewGuestPreload in main/index.ts). The partition is the ownership
// key: any future <webview> that does not opt into it inherits nothing.
//
// The guest never opens anything itself. It forwards a clicked `_blank` anchor
// to the host renderer, which admits the scheme and routes the URL through the
// audited preview:openExternal channel.
//
// The DOM is reached through the narrow host interface below rather than the
// `window`/`document` globals: this file is compiled by tsconfig.node.json,
// which deliberately has no DOM lib so main-process code cannot reach for
// `document` by accident.

export const PREVIEW_PARTITION = "persist:ocd-preview"
export const GUEST_EXTERNAL_CHANNEL = "preview-open-external"

interface AnchorLike {
  href: string
}

interface TargetLike {
  closest(selector: string): { href: string } | null
}

export interface GuestClickEvent {
  button?: number
  isTrusted?: boolean
  target?: unknown
}

export interface GuestHandoffHost {
  addEventListener(type: "click", listener: (event: GuestClickEvent) => void, capture?: boolean): void
  sendToHost(channel: string, ...args: unknown[]): void
}

/**
 * Only a trusted primary-button click qualifies. `isTrusted` is what keeps this
 * bridge out of the gesture-less forced-navigation class (GHSA-9f4c-93c8-jc8g):
 * page script can dispatchEvent a synthetic click on an anchor, but it cannot
 * forge `isTrusted`.
 */
export function anchorForHandoff(event: GuestClickEvent): AnchorLike | null {
  if (event.isTrusted !== true || (event.button ?? 0) !== 0) return null

  const target = event.target as TargetLike | null
  if (!target || typeof target.closest !== "function") return null

  // `closest` climbs through the click's own DOM, which this isolated preload
  // world shares with the page: an inner <span> resolves to the enclosing
  // <a target="_blank"> the same way it would for page script.
  const anchor = target.closest('a[target="_blank"]')
  if (!anchor || typeof anchor.href !== "string" || anchor.href === "") return null

  // href is the browser-resolved absolute URL, not the raw attribute, so
  // relative and protocol-relative hrefs arrive fully qualified for the host's
  // scheme admission check.
  return anchor
}

export function installGuestExternalHandoff(host: GuestHandoffHost): void {
  host.addEventListener(
    "click",
    (event) => {
      const anchor = anchorForHandoff(event)
      if (!anchor) return
      // Stop the guest from navigating itself; the host decides.
      if (typeof (event as { preventDefault?: () => void }).preventDefault === "function") {
        ;(event as { preventDefault: () => void }).preventDefault()
      }
      host.sendToHost(GUEST_EXTERNAL_CHANNEL, anchor.href)
    },
    true,
  )
}

/** The slice of the guest's `window` this preload actually uses. */
interface GuestWindow {
  addEventListener(type: "click", listener: (event: GuestClickEvent) => void, capture?: boolean): void
  sendToHost(channel: string, ...args: unknown[]): void
}

const guestWindow = (globalThis as unknown as { window?: GuestWindow }).window
if (guestWindow) installGuestExternalHandoff(guestWindow)