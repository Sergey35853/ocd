import { BrowserWindow, screen } from "electron"
import { join } from "node:path"
import { windowIcon } from "./icon"

/**
 * Heads-up display: a small always-on-top strip that mirrors what the app is
 * doing right now.
 *
 * Why a separate frameless window instead of a panel inside the main one: the
 * point of a HUD is to be visible while something else has focus. It is also
 * the only place where "the model is working" is useful when the chat itself
 * is buried under a dozen windows.
 *
 * It is off by default — an always-on-top strip nobody asked for is noise —
 * and is created lazily so a user who never opens it pays nothing.
 */

const WIDTH = 340
const HEIGHT = 92

let hud: BrowserWindow | null = null

/** Remembered so the strip comes back where the user put it. */
type Placement = "top-right" | "top-left" | "bottom-right" | "bottom-left"

let placement: Placement = "top-right"
let offset = { x: 24, y: 24 }

export function setPlacement(next: Placement, dx?: number, dy?: number): void {
  placement = next
  if (typeof dx === "number" && typeof dy === "number") offset = { x: dx, y: dy }
  if (hud && !hud.isDestroyed()) position(hud)
}

/**
 * Place the window a few pixels off a screen corner.
 *
 * Uses the work area rather than the display bounds so the strip never lands
 * under the taskbar or a docked app bar.
 */
function position(win: BrowserWindow): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const area = display.workArea

  const left = placement.endsWith("left") ? area.x + offset.x : area.x + area.width - WIDTH - offset.x
  const top: number =
    placement.startsWith("top") ? area.y + offset.y : area.y + area.height - HEIGHT - offset.y

  win.setPosition(Math.round(left), Math.round(top), false)
}

export function showHud(): BrowserWindow {
  if (hud && !hud.isDestroyed()) {
    hud.showInactive()
    return hud
  }

  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    icon: windowIcon(),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  hud = win

  // "Always on top" above full-screen apps would be hostile; screen-saver level
  // keeps it over ordinary windows and out of the way of real work.
  win.setAlwaysOnTop(true, "screen-saver")
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })
  win.on("closed", () => {
    if (hud === win) hud = null
  })

  void win.loadFile(join(__dirname, "../renderer/hud.html"))
  win.once("ready-to-show", () => {
    position(win)
    win.showInactive()
  })

  return win
}

export function hideHud(): void {
  if (hud && !hud.isDestroyed()) hud.hide()
}

export function toggleHud(): boolean {
  if (hud && !hud.isDestroyed() && hud.isVisible()) {
    hideHud()
    return false
  }
  showHud()
  return true
}

export function hudVisible(): boolean {
  return Boolean(hud && !hud.isDestroyed() && hud.isVisible())
}

/** Payload the HUD renders; kept loose so main owns the shape, not this file. */
export interface HudPayload {
  connected: boolean
  busy: Array<{ id: string; title: string }>
  status: string
}

export function setHudData(payload: HudPayload): void {
  if (!hud || hud.isDestroyed() || !hud.isVisible()) return
  hud.webContents.send("ocd:hud", payload)
}

export function closeHud(): void {
  hud?.destroy()
  hud = null
}

