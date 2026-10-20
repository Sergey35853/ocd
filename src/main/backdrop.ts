import { BrowserWindow } from "electron"
import { getSettings } from "./settings"

/** Windows 11 build 22000+ is required for the DWM system backdrop. */
export function supportsSystemBackdrop(): boolean {
  if (process.platform !== "win32") return false
  // "10.0.26200". The build number is what separates Windows 11 (22000 and up)
  // from Windows 10, which stopped at 19045. The first two parts have been
  // 10.0 on every Windows since 2015 and say nothing about the version — and
  // reading the build out of the second part turned the whole backdrop off.
  const parts = process.getSystemVersion().split(".").map((part) => parseInt(part, 10) || 0)
  return (parts[2] ?? 0) >= 22000
}

/**
 * Whether the window has to be layered for the backdrop to show.
 *
 * A system backdrop reaches the screen through the window's own transparency,
 * so a window that is not layered cannot show one. The flag is fixed when the
 * window is created, which is why it is decided by the system and not by the
 * current setting: switching the backdrop on later has to keep working. With
 * the backdrop switched off the page paints its own background instead.
 */
export function windowNeedsTransparency(): boolean {
  return supportsSystemBackdrop()
}

/**
 * The DWM material behind the window.
 *
 * The folder window in Explorer is made of Mica: the wallpaper is sampled
 * rather than blurred, so the surface stays quiet and the text on top of it
 * stays readable. Electron cannot draw plain Mica — a layered window never
 * gets it — but the "tabbed" material is the same Mica Alt family that
 * Explorer's own tabbed windows use, and it does render.
 *
 * Acrylic is the alternative: it blurs everything behind the window, which
 * reads as a smear. One setting away, for anyone who wants that.
 */
export function backdropMaterial(): "none" | "tabbed" | "acrylic" {
  const settings = getSettings()
  if (!settings.blurBehind || !supportsSystemBackdrop()) return "none"
  return settings.backdrop === "acrylic" ? "acrylic" : "tabbed"
}

/**
 * Put the material on a window.
 *
 * Some Windows 11 builds only honour the backdrop when it is set after the
 * window exists, so this is called both from the constructor and afterwards.
 */
export function applyBackdrop(win: BrowserWindow): void {
  if (process.platform !== "win32") return
  try {
    win.setBackgroundMaterial(backdropMaterial())
  } catch {
    /* older build: the constructor value stands */
  }
}

/**
 * Re-apply the material to every window.
 *
 * Called when the settings change: the material is a property of the native
 * window, so a change made in the renderer cannot reach it on its own.
 */
export function refreshBackdrop(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    applyBackdrop(win)
  }
}
