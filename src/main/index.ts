import { app, BrowserWindow, shell } from "electron"
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { registerIpc, broadcastServiceEvents, startAutoSpeech } from "./ipc"
import { service } from "./service"
import { voice } from "./voice"
import { getSettings, setSettings } from "./settings"
import { windowIcon } from "./icon"
import { createTray, destroyTray, updateTrayState, setTrayActions, trayExists } from "./tray"
import { closeAllSessionWindows, registerGlobalHotkey, unregisterHotkeys } from "./windows"
import { type UiLanguage } from "./i18n"
import { repairLegacyLanguageInstruction } from "./configFile"
import { initLog, log } from "./log"
import { refreshShellAssociations } from "./shellNotify"
import { reportInstall } from "./feedback"

let mainWindow: BrowserWindow | null = null
let quitting = false

const isDev = !app.isPackaged

/** Partition for the preview pane's <webview> guests; it doubles as the
 * ownership key that decides who gets the guest preload. */
const PREVIEW_PARTITION = "persist:ocd-preview"

const previewGuestPreload = join(__dirname, "../preload/previewGuest.js")

/**
 * Give the preview pane's <webview> guests a preload — and ONLY those guests.
 * The pane's webview is the one <webview> tag in the app and it always carries
 * the preview partition, so a future webview that does not opt in inherits
 * nothing from this mechanism.
 */
function installPreviewGuestPreload(): void {
  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() !== "window") return
    contents.on("will-attach-webview", (_attachEvent, webPreferences, params) => {
      if (params.partition !== PREVIEW_PARTITION) return
      webPreferences.preload = previewGuestPreload
    })
  })
}

/** Windows 11 build 22000+ is required for the DWM system backdrop. */
function supportsSystemBackdrop(): boolean {
  if (process.platform !== "win32") return false
  const [major, minor] = process.getSystemVersion().split(".").map((part) => parseInt(part, 10) || 0)
  return major > 10 || (major === 10 && minor >= 22000)
}

function showWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/**
 * Bring the app forward and put the caret in the composer.
 *
 * The renderer owns the composer, so main only asks; `focus-composer` is the
 * signal and the renderer decides whether it can honour it (it cannot while a
 * non-chat view is on screen, which is why that view has its own back button).
 */
function showAndFocusComposer(): void {
  showWindow()
  mainWindow?.webContents.send("ocd:command", { kind: "focus-composer" })
}

function hideWindow(): void {
  mainWindow?.hide()
}

function refreshTrayVisibility(): void {
  if (!trayExists()) return
  updateTrayState({ visible: Boolean(mainWindow && mainWindow.isVisible()) })
}

function openSessionById(sessionId: string): void {
  showWindow()
  mainWindow?.webContents.send("ocd:command", { kind: "open-session", sessionId })
}

/** Tray callbacks live here so both the tray and the hotkey share them. */
const trayActions = {
  show: showWindow,
  hide: hideWindow,
  quickAsk: showAndFocusComposer,
  openSession: openSessionById,
  restartServer: () => void service.restart(),
  reconnect: () => {
    void service.connect(getSettings().serverUrlOverride || undefined).then((status) => {
      if (status.connected) service.startEventStream()
    })
  },
  setLanguage: (language: UiLanguage) => {
    setSettings({ uiLanguage: language })
    mainWindow?.webContents.send("ocd:command", { kind: "set-language", language })
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && win !== mainWindow) {
        win.webContents.send("ocd:command", { kind: "set-language", language })
      }
    }
  },
  quit: () => {
    quitting = true
    app.quit()
  },
}

/**
 * (Re)claim the global hotkey. Empty accelerator unregisters, which is how
 * switching the hotkey off works. A key already held by another program is
 * reported so the Settings screen can say so instead of pretending it worked.
 */
function applyGlobalHotkey(): { ok: boolean; error?: string } {
  return registerGlobalHotkey(getSettings().globalHotkey.trim(), showAndFocusComposer)
}

function createWindow(): BrowserWindow {
  const settings = getSettings()

  const useBackdrop = settings.blurBehind && supportsSystemBackdrop()

  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    transparent: useBackdrop,
    backgroundColor: "#00000000",
    // Acrylic on Win11, Mica where acrylic is unavailable, flat elsewhere.
    backgroundMaterial: useBackdrop ? "acrylic" : "none",
    icon: windowIcon(),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // The preview pane is the app's only <webview>; guests are confined to
      // PREVIEW_PARTITION and get no popups (no allowpopups anywhere).
      webviewTag: true,
    },
  })

  mainWindow = win

  // Some Windows 11 builds only honour the backdrop when it is set post-create.
  if (process.platform === "win32") {
    try {
      win.setBackgroundMaterial(useBackdrop ? "acrylic" : "none")
    } catch {
      /* older build: the constructor value stands */
    }
  }

  win.setAlwaysOnTop(settings.alwaysOnTop, "screen-saver")
  win.setVisibleOnAllWorkspaces(settings.alwaysOnTop, { visibleOnFullScreen: true })

  win.on("ready-to-show", () => {
    if (!getSettings().startMinimized) win.show()
  })

  win.on("close", (event) => {
    const s = getSettings()
    // Written either way. "It closed on its own" and "the X put it in the
    // tray" look identical from outside, and that ambiguity is why a report of
    // "it crashed" could be neither confirmed nor denied from anything.
    log.info(`window close requested (quitting=${quitting}, closeToTray=${s.closeToTray})`)
    if (!quitting && s.closeToTray) {
      event.preventDefault()
      win.hide()
      createTray()
      refreshTrayVisibility()
    }
  })

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null
    log.info("window closed")
    refreshTrayVisibility()
  })

  win.on("show", () => {
    log.info("window shown")
    refreshTrayVisibility()
  })
  win.on("hide", () => {
    log.info("window hidden (still running)")
    refreshTrayVisibility()
  })

  // External links open in the system browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: "deny" }
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (isDev && devUrl) {
    void win.loadURL(devUrl)
  } else {
    const hash = process.env.OCD_VIEW ? `#${process.env.OCD_VIEW}` : ""
    void win.loadFile(join(__dirname, "../renderer/index.html"), { hash: hash.slice(1) })
  }

  return win
}

/**
 * The ICO the taskbar entry should point at, or null when there is none.
 *
 * Order matters and the last candidate is not `app.getPath("exe")`. Windows
 * resolves an AppUserModelID once per shell session, so whatever a *previous*
 * run registered for this id is what the taskbar keeps showing. A dev run has no
 * `resources/icon.ico` next to the Electron runtime, and falling back to the
 * executable wrote `IconUri = electron.exe` under the very id the installed app
 * uses - after which the installed copy showed the Electron icon until the shell
 * was restarted. Registering nothing is better than registering a lie.
 */
export function taskbarIconPath(resourcesPath: string): string | null {
  const candidates = [
    join(resourcesPath, "icon.ico"),
    // Dev: the same files the repo ships, next to the built main bundle.
    join(__dirname, "../../resources/icon.ico"),
  ]
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

/**
 * Give Windows something to resolve the taskbar entry against.
 *
 * A window declares an AppUserModelID, and Windows then looks that id up to
 * decide the name and icon shown in the taskbar, in Alt-Tab and in the jump
 * list. Nothing registers it automatically: the installer does, for the copy it
 * installs - which is why running straight out of `release/win-unpacked` left
 * Windows with no answer and fell back to the Electron runtime's identity, so
 * the app appeared under an Electron icon.
 *
 * The entry is written per user, under HKCU, and points at the executable
 * actually running. Doing it here rather than only in the installer is what
 * makes the unpacked build show the same thing the installed one does.
 *
 * `IconUri` is the part that was missing. Registering the id with a
 * DisplayName and no icon makes the entry resolvable but iconless, and
 * Windows then has nothing to draw: the taskbar button came up blank or as
 * the Electron runtime's. The id has to name the ICO itself, which is why
 * electron-builder ships `icon.ico` as an extra resource - the icon embedded
 * in the executable is not addressable as a file.
 *
 * Windows resolves an AppUserModelID once per shell session and keeps the
 * answer, so a wrong entry survives until the shell restarts. That is why the
 * icon is never a guess: an entry naming the real ICO from either run, or no
 * entry at all.
 */
function registerTaskbarIdentity(aumid: string): void {
  if (process.platform !== "win32") return
  const key = `HKCU\\Software\\Classes\\AppUserModelId\\${aumid}`
  const exe = app.getPath("exe")
  const ico = taskbarIconPath(process.resourcesPath)
  // Without an icon there is nothing to point at, and pointing at the executable
  // is what put the Electron mark on the installed app's taskbar in the first
  // place. Leave the id to the installer in that case.
  if (!ico) {
    log.warn("no taskbar icon found; leaving the taskbar identity to the installer")
    return
  }
  // Arguments as an array, never a joined string: the install path routinely
  // contains spaces, and a shell-split argument list would truncate it.
  const writes: string[][] = [
    ["add", key, "/v", "DisplayName", "/t", "REG_SZ", "/d", "OCD", "/f"],
    ["add", key, "/v", "IconUri", "/t", "REG_SZ", "/d", ico, "/f"],
    ["add", `${key}\\shell\\open\\command`, "/ve", "/t", "REG_SZ", "/d", `"${exe}"`, "/f"],
  ]
  for (const args of writes) {
    try {
      execFileSync("reg.exe", args, { windowsHide: true, stdio: "ignore" })
    } catch (err) {
      log.warn(`could not register the taskbar identity: ${String(err)}`)
    }
  }
  log.info(`taskbar identity registered as ${aumid} with ${ico}`)
  // The entry is only half of it: Windows resolved this id once, when the
  // shell started, and keeps that answer until something says otherwise.
  refreshShellAssociations()
}

/**
 * Reloads are a last resort, not a retry policy: a window that dies twice in
 * ten seconds is not going to survive being reloaded twice in ten seconds.
 */
const RELOAD_GRACE_MS = 10_000
let lastRendererReload = 0

/**
 * Record what kills the app, and keep it running where that is still sane.
 *
 * Electron's default for a throw in main is a dialog and then death, and its
 * default for a dead renderer is a window that never comes back. Both lose the
 * one thing needed to work out what happened, so:
 *  - every exit path is written to the log before anything else happens;
 *  - a throw in main is logged and swallowed, because a failed IPC call or a
 *    failed render is no reason to take the whole app down;
 *  - a renderer that died is reloaded once, which is the right answer when a
 *    long chat exhausts the renderer's memory.
 */
function installCrashGuards(): void {
  initLog()

  process.on("uncaughtException", (err) => {
    log.error("uncaughtException in main", err)
  })

  process.on("unhandledRejection", (reason) => {
    log.error("unhandledRejection in main", reason)
  })

  app.on("render-process-gone", (_event, contents, details) => {
    log.error(`render-process-gone: ${details.reason}, exitCode ${details.exitCode}`)
    const win = BrowserWindow.fromWebContents(contents)
    if (!win || win.isDestroyed()) return

    const now = Date.now()
    if (now - lastRendererReload < RELOAD_GRACE_MS) {
      log.error("renderer died again right after a reload; leaving it alone")
      return
    }
    lastRendererReload = now
    log.info("reloading the window after its renderer died")
    win.reload()
  })

  app.on("child-process-gone", (_event, details) => {
    log.warn(
      `child-process-gone: ${details.type}, exitCode ${details.exitCode}, reason ${details.reason}`,
    )
  })
}

// Identity, fixed before anything reads it.
//
// `app.getName()` decides the window title, the Alt-Tab entry and the tray
// tooltip. Left to Electron it resolves from the runtime rather than from this
// app, which is how a window ends up labelled "Electron" instead of OCD.
app.setName("OCD")

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  installCrashGuards()
  app.on("second-instance", () => {
    // Launched again while already running: the new process exits immediately
    // and this one has to bring itself forward, or it looks like the launch did
    // nothing at all.
    log.info("second instance launched; bringing the window forward")
    showWindow()
  })

  void app.whenReady().then(() => {
    // Groups the taskbar entry and makes Windows toasts work. The id resolves
    // to a name and an icon only if something registers it, which the installer
    // does for its own copy — running from `release/win-unpacked` there is none,
    // and the panel fell back to the Electron icon. Registering it here makes
    // both copies behave the same.
    app.setAppUserModelId("dev.ocd.deck")
    registerTaskbarIdentity("dev.ocd.deck")

    installPreviewGuestPreload()
    setTrayActions(trayActions)
    registerIpc(() => mainWindow)
    broadcastServiceEvents(() => BrowserWindow.getAllWindows())
    startAutoSpeech()

    createWindow()
    if (getSettings().startMinimized) createTray()
    applyGlobalHotkey()

    // A single mark per installed version, asked for by every launch and given
    // once. It waits for nothing and is told about nothing: a machine that
    // cannot reach the backend loses one row and no more. See main/feedback.ts.
    void reportInstall()

    void service
      .connect(getSettings().serverUrlOverride || undefined)
      .then(async (status) => {
        if (status.connected) service.startEventStream()
        updateTrayState({ connected: status.connected })

        // Move a reply-language instruction that older builds wrote as plain
        // text into a real instruction file. Repaired here because the broken
        // state looks like the model ignoring the setting rather than like a
        // broken config, so nothing else would bring it to anyone's attention.
        const repaired = repairLegacyLanguageInstruction()
        if (repaired.ok && status.connected) {
          await service.post("/api/location/reload").catch(() => undefined)
        }
      })

    // One line per actual change of state. The status arrives more than once
    // per connection — once from the probe, once from the stream's own greeting
    // — and writing all of them made the log look like the app was flapping
    // when it had merely said the same thing twice.
    let lastLogged = ""
    service.on("status", (status) => {
      const line = `${status.connected ? "connected" : "disconnected"} ${status.url ?? status.error ?? ""}`
      if (line === lastLogged) return
      lastLogged = line
      // The connection is the first thing anyone asks about after a crash, and
      // it is the one thing main knows and the renderer only guesses at.
      log.info(`service ${line}`)
      updateTrayState({ connected: status.connected })
    })

    // Auto-update: opt-in, and only for installed builds (a portable exe or a
    // dev run has nowhere sensible to write the new version).
    if (getSettings().autoUpdate && app.isPackaged) {
      void import("./updater").then((m) => m.startAutoUpdate())
    }
  })

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else showWindow()
  })

  app.on("before-quit", () => {
    quitting = true
    service.stopEventStream()
    voice.dispose()
    unregisterHotkeys()
    destroyTray()
    closeAllSessionWindows()
  })

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      // Close-to-tray users keep the app alive; others fully exit.
      if (!getSettings().closeToTray) app.quit()
    }
  })
}


