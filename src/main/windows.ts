import { BrowserWindow, globalShortcut, shell } from "electron"
import { join } from "node:path"
import { windowIcon } from "./icon"
import { getSettings } from "./settings"
import { applyBackdrop, backdropMaterial, windowNeedsTransparency } from "./backdrop"

/** One extra window per session, keyed so re-opening focuses the existing one. */
const sessionWindows = new Map<string, BrowserWindow>()

/**
 * Open `sessionId` in its own OS window.
 *
 * One window per session, tracked so a second request focuses the first rather
 * than stacking duplicates. It loads the same renderer bundle and picks the
 * session up from the hash, so there is no second implementation of the chat.
 */
export function openSessionWindow(sessionId: string, title: string | null): BrowserWindow {
  const existing = sessionWindows.get(sessionId)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return existing
  }

  const settings = getSettings()
  const material = backdropMaterial()
  const win = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    show: false,
    frame: false,
    // Layered whenever the system can draw a backdrop: the flag cannot be
    // changed later, and switching the backdrop on has to keep working.
    transparent: windowNeedsTransparency(),
    backgroundColor: "#00000000",
    // Mica Alt — the material behind a folder window in Explorer.
    backgroundMaterial: material,
    icon: windowIcon(),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Same preview pane as the main window; guests stay on their partition.
      webviewTag: true,
    },
  })

  sessionWindows.set(sessionId, win)
  win.setAlwaysOnTop(settings.alwaysOnTop, "screen-saver")

  // Some Windows 11 builds only honour the backdrop when it is set post-create.
  applyBackdrop(win)

  win.once("ready-to-show", () => {
    win.show()
    win.setTitle(title ? `OCD — ${title}` : "OCD")
  })

  win.on("closed", () => {
    if (sessionWindows.get(sessionId) === win) sessionWindows.delete(sessionId)
  })

  // External links leave for the system browser, exactly as in the main window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: "deny" }
  })

  void win.loadFile(join(__dirname, "../renderer/index.html"), {
    hash: `session/${sessionId}`,
  })

  return win
}

export function closeAllSessionWindows(): void {
  for (const win of sessionWindows.values()) {
    if (!win.isDestroyed()) win.destroy()
  }
  sessionWindows.clear()
}

/**
 * Register the global hotkey. Returns false when the accelerator is already
 * owned by another program — the common case for Ctrl+Shift+Space, and worth
 * reporting rather than failing silently.
 */
export function registerGlobalHotkey(
  accelerator: string,
  action: () => void,
): { ok: boolean; error?: string } {
  globalShortcut.unregisterAll()
  if (!accelerator) return { ok: true }
  try {
    const ok = globalShortcut.register(accelerator, action)
    return ok ? { ok: true } : { ok: false, error: "TAKEN" }
  } catch {
    return { ok: false, error: "TAKEN" }
  }
}

export function unregisterHotkeys(): void {
  globalShortcut.unregisterAll()
}