import { BrowserWindow, screen } from "electron"
import { join } from "node:path"
import { windowIcon } from "./icon"
import { log } from "./log"

/**
 * The finished-reply notice: a small card in the bottom-right corner.
 *
 * The Windows toast this sits beside is the system's, and it is easy to miss —
 * it arrives wherever Windows decides, it says "OpenCode" rather than which
 * conversation finished, and on a busy desktop it is gone before it is read.
 * This one is ours: same corner every time, named after the conversation, with
 * the first lines of the answer in it, and a click that opens that
 * conversation.
 *
 * A separate frameless window rather than a panel in the main one, for the same
 * reason the HUD is one: it has to be visible while something else has focus.
 * It takes no focus itself — clicking it hands focus to the conversation, which
 * is the only thing the user could want from it.
 */

const WIDTH = 380
const HEIGHT = 168
/** How long the card stays up when nobody clicks it. */
const LIFETIME_MS = 9_000
const MARGIN = 20

let notice: BrowserWindow | null = null
let timer: NodeJS.Timeout | null = null
/** What to show if the card is still on screen when the next one arrives. */
let pending: NoticePayload | null = null

export interface NoticePayload {
  title: string
  body: string
  failed: boolean
  sessionId: string
}

/** Bottom-right of the work area, clear of the taskbar. */
function position(win: BrowserWindow): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const area = display.workArea
  win.setPosition(
    Math.round(area.x + area.width - WIDTH - MARGIN),
    Math.round(area.y + area.height - HEIGHT - MARGIN),
    false,
  )
}

function showNotice(payload: NoticePayload): void {
  if (notice && !notice.isDestroyed()) {
    // Replace what is on screen rather than stacking: two cards saying the
    // same thing at the same corner is noise, and the newer one is the one
    // worth reading.
    pending = payload
    notice.webContents.send("ocd:notice", payload)
    armTimer()
    return
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
    // The card never takes focus. A notification that steals the keyboard
    // interrupts the very work it is reporting on.
    focusable: false,
    hasShadow: false,
    icon: windowIcon(),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  notice = win
  win.setAlwaysOnTop(true, "screen-saver")
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })
  win.on("closed", () => {
    if (notice === win) notice = null
    clearTimer()
  })

  void win.loadFile(join(__dirname, "../renderer/notice.html"))
  win.once("ready-to-show", () => {
    position(win)
    if (pending) win.webContents.send("ocd:notice", pending)
    win.showInactive()
  })

  armTimer()
}

function clearTimer(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

function armTimer(): void {
  clearTimer()
  timer = setTimeout(() => {
    timer = null
    // Anything that arrived while the card was up replaces it once, rather
    // than being dropped on the floor.
    if (pending) {
      const next = pending
      pending = null
      showNotice(next)
      return
    }
    notice?.hide()
  }, LIFETIME_MS)
}

/** Put the finished-reply card up. Respects the same setting as the toast. */
export function showFinishNotice(payload: NoticePayload): boolean {
  try {
    showNotice(payload)
    log.info(`finish notice shown for ${payload.sessionId}`)
    return true
  } catch (err) {
    log.warn("could not show the finish notice", err)
    return false
  }
}

/** The card was clicked: hand the conversation over and get out of the way. */
export function dismissNotice(sessionId: string): void {
  clearTimer()
  pending = null
  notice?.hide()
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    if (win.webContents.getURL().includes("notice.html")) continue
    win.webContents.send("ocd:command", { kind: "open-session", sessionId })
  }
}

export function closeNotice(): void {
  clearTimer()
  pending = null
  notice?.destroy()
  notice = null
}
