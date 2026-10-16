import { app, nativeImage } from "electron"
import { existsSync } from "node:fs"
import { join } from "node:path"

/**
 * Preferred size for the window and tray icon.
 *
 * Windows asks for 24px at 100% scaling, 32 at 150% and 40 at 200%, and scales
 * whatever it gets up when it is too small. Handing it exactly 32 - which is
 * what this used to do - meant every taskbar past 100% upsampled a pre-shrunk
 * bitmap and showed a blur. 64 covers the highest scaling Windows ships
 * without bloating the package.
 */
const ICON_SIZE = 64

/**
 * Prefer the shipped ICO; fall back to the PNG, then to a generated disc so
 * the window and tray always have something to show even if a resource is
 * missing.
 *
 * The ICO carries all nine frames (16 through 256) and is what the taskbar
 * picks from once the AppUserModelId points at it, so the window icon has to
 * come from the same file or the two disagree at small sizes.
 */
function loadIcon(stem: string): Electron.NativeImage | null {
  const candidates = [
    process.resourcesPath ? join(process.resourcesPath, `${stem}.ico`) : "",
    process.resourcesPath ? join(process.resourcesPath, `${stem}.png`) : "",
    join(__dirname, `../../resources/${stem}.ico`),
    join(__dirname, `../../resources/${stem}.png`),
  ].filter(Boolean)

  for (const candidate of candidates) {
    try {
      if (candidate && existsSync(candidate)) {
        const image = nativeImage.createFromPath(candidate)
        if (!image.isEmpty()) return image.resize({ width: ICON_SIZE, height: ICON_SIZE })
      }
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

/** Last resort when no icon resource is on disk at all: a flat gradient disc. */
function generatedDisc(): Electron.NativeImage {
  const size = ICON_SIZE
  const buf = Buffer.alloc(size * size * 4)
  const center = (size - 1) / 2
  const radius = size * 0.46
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const dx = x - center
      const dy = y - center
      if (Math.hypot(dx, dy) > radius) continue
      const t = (x + y) / (size * 2)
      buf[i] = Math.round(99 + (167 - 99) * t)
      buf[i + 1] = Math.round(102 + (139 - 102) * t)
      buf[i + 2] = Math.round(241 + (250 - 241) * t)
      buf[i + 3] = 255
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size })
}

export function windowIcon(): Electron.NativeImage {
  return loadIcon("icon") ?? generatedDisc()
}

/**
 * The variant stamped with an arrow while an update is waiting.
 *
 * Falls back to the plain icon rather than to the generated disc: a missing
 * badge file is a packaging mistake, and showing no badge at all is a much
 * smaller problem than showing the fallback gradient in the taskbar.
 */
export function updateIcon(): Electron.NativeImage {
  return loadIcon("icon-update") ?? windowIcon()
}

/**
 * The arrow alone, for the taskbar overlay.
 *
 * A separate file from `icon-update` on purpose: Windows draws an overlay in
 * the corner of the taskbar button at 16px, and handing it the full tile puts a
 * shrunken second copy of the app icon there instead of the sign it is supposed
 * to carry. Falls back to the badge icon, which at least ends in an arrow.
 */
export function updateOverlayIcon(): Electron.NativeImage {
  return loadIcon("icon-overlay") ?? updateIcon()
}

/** Tooltip shown on the taskbar and in the Alt-Tab switcher. */
export function appTitle(): string {
  return app.getName() || "OCD"
}