import { app, nativeImage } from "electron"
import { existsSync } from "node:fs"
import { join } from "node:path"

/**
 * Prefer the shipped PNG; fall back to a generated disc so the window and tray
 * always have something to show even if the resource is missing.
 */
export function windowIcon(): Electron.NativeImage {
  const candidates = [
    process.resourcesPath ? join(process.resourcesPath, "icon.png") : "",
    join(__dirname, "../../resources/icon.png"),
  ].filter(Boolean)

  for (const candidate of candidates) {
    try {
      if (candidate && existsSync(candidate)) {
        const image = nativeImage.createFromPath(candidate)
        if (!image.isEmpty()) return image.resize({ width: 32, height: 32 })
      }
    } catch {
      /* try the next candidate */
    }
  }

  const size = 32
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

/** Tooltip shown on the taskbar and in the Alt-Tab switcher. */
export function appTitle(): string {
  return app.getName() || "OCD"
}