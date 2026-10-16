import { BrowserWindow, app, dialog } from "electron"
import { autoUpdater } from "electron-updater"
import { EventEmitter } from "node:events"
import type { UpdateState } from "@shared/types"
import { mainText, MAIN_LANGUAGES, type UiLanguage } from "./i18n"
import { getSettings } from "./settings"
import { updateIcon, updateOverlayIcon, windowIcon } from "./icon"
import { setTrayIcon } from "./tray"
import { isNewer } from "./version"
import { log } from "./log"

/**
 * Fires whenever the state the header button shows changes.
 *
 * The renderer used to find out by polling, which left up to a minute between
 * an update turning up and the arrow turning with it — and a minute that is
 * invisible to whoever is waiting for it. Pushing the state costs one message
 * and makes the arrow appear in the same moment as the event that caused it.
 */
export const updateEvents = new EventEmitter()

/**
 * True once an update has been fetched and is sitting in the updater cache.
 *
 * The cache is the whole reason this flag exists: `quitAndInstall` has nothing
 * to install until something has been downloaded, and nothing else in the app
 * knows whether that has happened.
 */
let staged = false

/** Version reported by the last `update-available`, for the messages below. */
let foundVersion = ""

/**
 * Whether the updater events are already wired up.
 *
 * The listeners are needed by both entry points - the automatic check on
 * startup and the manual "check now" button - and registering them twice would
 * show every message twice and badge every window twice over.
 */
let listenersReady = false

/**
 * How many updater calls we started ourselves are still running.
 *
 * Every caller reports the outcome on its own: the renderer turns the reply of
 * a check or a download into a toast, and the automatic check on startup wants
 * nothing but the icon badge. The listeners below sit underneath all of them,
 * so without this counter they repeated what the caller had already said - and
 * the loudest case was a modal "you are up to date" dialog on every launch,
 * every single time, for a check that found nothing.
 */
let quiet = 0

/** Run an updater call with the dialog notifications muted. */
async function quietly<T>(action: () => Promise<T>): Promise<T> {
  quiet += 1
  try {
    return await action()
  } finally {
    quiet -= 1
  }
}

/**
 * Opt-in update checks.
 *
 * Three deliberate limits:
 *  - packaged builds only: a portable exe or `electron-vite dev` has no
 *    installation to replace, so asking GitHub for a newer version would be
 *    noise;
 *  - `autoDownload` is off — a 110 MB download has to be the user's decision;
 *  - `autoInstallOnAppQuit` is on, so once the file is staged the install
 *    happens on the next normal quit instead of interrupting a session.
 *
 * The check itself is silent: a version that turns up shows up as the arrow on
 * the window and tray icons and as the button in the header, and a check that
 * finds nothing has nothing to say.
 */

/** How often an app that is already running asks GitHub again. */
const RECHECK_MS = 60 * 60 * 1000

/** Set once the repeat timer is armed, whichever entry point armed it. */
let scheduled = false

export function startAutoUpdate(): void {
  if (!app.isPackaged) return

  configure()
  ensureListeners()
  runCheck()
  schedule()
}

/**
 * Ask the channel what it holds, and write down what came back.
 *
 * Every step goes to the log: an update that fails to announce itself looks
 * exactly like an update that does not exist, and the only place the two can be
 * told apart is here, because the updater's own errors go to a console nobody
 * is watching.
 */
function runCheck(): void {
  log.info(`update check started for ${app.getVersion()}`)
  void quietly(() => autoUpdater.checkForUpdates())
    .then((result) => {
      const found = result?.updateInfo?.version
      log.info(
        foundIsNewer(found)
          ? `update found: ${found}`
          : `no update: channel holds ${found ?? "nothing"}, running ${app.getVersion()}`,
      )
    })
    .catch((err) => {
      log.warn(`update check failed: ${err instanceof Error ? err.message : String(err)}`)
    })
}

/**
 * Keep checking for as long as the app is open.
 *
 * Without this the app asks exactly once, at launch, and that is what makes an
 * update look like it never arrived: OCD checked at 15:32, the release went out
 * at 15:41, and the app sat there — open, in the foreground, hours later — still
 * certain there was nothing new. An hour is cheap enough for GitHub and quick
 * enough that the arrow is there before anyone goes looking for it.
 */
function schedule(): void {
  if (scheduled) return
  scheduled = true
  const timer = setInterval(() => {
    if (!getSettings().autoUpdate) return
    runCheck()
  }, RECHECK_MS)
  // Never the reason the app refuses to exit.
  timer.unref?.()
}

/** Shared updater settings; both entry points need the same three values. */
function configure(): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  // The default provider (Squirrel.Windows) does not work for NSIS installers
  // produced by electron-builder; without this the first check throws instead
  // of simply finding nothing.
  autoUpdater.logger = null
}

/**
 * Wire the updater events once.
 *
 * Registered here rather than only inside `startAutoUpdate` so that a manual
 * check badges the icon even when the automatic one is switched off — the
 * finding is the same either way, and the badge should not depend on how the
 * user asked.
 */
function ensureListeners(): void {
  if (listenersReady) return
  listenersReady = true

  const t = (key: Parameters<typeof mainText>[0]) => mainText(key, language())

  const notify = (message: string) => {
    // Muted while one of our own calls is in flight: the caller says the same
    // thing in a place where it belongs, and the startup check has no caller
    // to say it for it. What is left here is the case nobody asked for -
    // electron-updater deciding on its own to fetch something.
    if (quiet > 0) return
    const parent = BrowserWindow.getAllWindows()[0]
    if (parent) {
      void dialog.showMessageBox(parent, { message, buttons: [t("ok") as string] }).catch(() => undefined)
    }
  }

  autoUpdater.on("update-available", (info) => {
    staged = false
    foundVersion = info.version
    log.info(`update available: ${info.version}`)
    badgeUpdatePending()
    publish()
    notify(`${t("updateFound")} ${info.version}`)
  })

  autoUpdater.on("update-downloaded", (info) => {
    staged = true
    log.info(`update downloaded: ${info.version}`)
    publish()
    notify(`${t("updateReady")} ${info.version}`)
  })

  autoUpdater.on("update-not-available", () => {
    // Clears the badge: a check that finds nothing after an earlier hit means
    // the badge is now lying about the state. Silence is the reply to the
    // caller - it shows what the check found.
    clearUpdateBadge()
    publish()
    notify(t("updateNone"))
  })

  autoUpdater.on("error", (err) => {
    log.warn(`update error: ${err.message}`)
  })
}

/**
 * Whether `found` is a version worth installing.
 *
 * `checkForUpdates()` answers with what the release channel holds, not with
 * whether that is newer than the copy being run: on a machine already at the
 * latest it comes back with the same version, and the screen then says a new
 * version is available while announcing that version as the running one.
 */
function foundIsNewer(found: string | undefined): boolean {
  return isNewer(found, app.getVersion())
}

/** Manual "check now" from About; resolves to a human-readable outcome. */
export async function checkForUpdates(): Promise<{ ok: boolean; message: string }> {
  const t = (key: Parameters<typeof mainText>[0]) => mainText(key, language())
  if (!app.isPackaged) return { ok: false, message: t("updateDevOnly") }
  try {
    configure()
    ensureListeners()
    // The dialog underneath is muted: the button that asked turns this reply
    // into a toast, and a modal on top of it said everything twice.
    const result = await quietly(() => autoUpdater.checkForUpdates())
    const found = result?.updateInfo?.version
    return { ok: true, message: foundIsNewer(found) ? `${t("updateFound")} ${found}` : t("updateNone") }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Badge every window and the tray with the arrow icon.
 *
 * The badge goes on as soon as a version is *found*, not when it is installed:
 * the point of an icon is that the app looks untouched from the taskbar, and a
 * change you can only discover by opening Settings is a change most people
 * never find. Installing restarts the process, so the plain icon comes back on
 * its own and nothing has to un-set this.
 *
 * The taskbar is the one place the arrow cannot simply replace the icon, and it
 * is worth knowing why rather than rediscovering it: a window that declares an
 * AppUserModelID gets its taskbar button drawn from the id's registry entry,
 * resolved once when the button is created. Both ways around it were tried and
 * measured on a running window - `BrowserWindow.setIcon` (WM_SETICON) and
 * rewriting `IconUri` followed by `SHChangeNotify(SHCNE_ASSOCCHANGED)` - and
 * neither moved the button. The registry change does land, but only for windows
 * created afterwards, which means it is also worse than useless: it leaves the
 * entry claiming an update that the next launch overwrites anyway.
 *
 * So the taskbar gets an overlay instead, which is the interface Windows keeps
 * live for exactly this: a small mark on the corner of the button rather than a
 * different icon for it.
 */
function badgeUpdatePending(): void {
  setIconEverywhere(updateIcon())
  const overlay = updateOverlayIcon()
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    try {
      win.setOverlayIcon(overlay, updateOverlayDescription())
    } catch {
      /* a window that refuses the overlay is not worth failing a check over */
    }
  }
}

/** Put the plain icon back, for when a later check finds nothing. */
function clearUpdateBadge(): void {
  setIconEverywhere(windowIcon())
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    try {
      win.setOverlayIcon(null, "")
    } catch {
      /* same as above */
    }
  }
}

/** What the overlay's tooltip says; empty when there is no overlay. */
function updateOverlayDescription(): string {
  const t = (key: Parameters<typeof mainText>[0]) => mainText(key, language())
  return `${t("updateFound")} ${foundVersion}`.trim()
}

function setIconEverywhere(image: Electron.NativeImage): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    try {
      win.setIcon(image)
    } catch {
      /* a window that refuses the icon is not worth failing a check over */
    }
  }
  setTrayIcon(image)
}

/**
 * Current update state for the renderer.
 *
 * Polled rather than pushed: the only thing the header does with it is decide
 * whether to show a button, so a second too late costs nothing and no event
 * channel has to survive a window that was closed when the update arrived.
 */
export function updateState(): UpdateState {
  return { available: Boolean(foundVersion), version: foundVersion, staged }
}

/** Hand the current state to every window listening for it. */
function publish(): void {
  updateEvents.emit("state", updateState())
}

/**
 * Fetch an update that `checkForUpdates` already found.
 *
 * This is the only thing in the app that starts a download, and the renderer
 * calls it from an explicit button — which is what makes the `autoDownload =
 * false` above a promise rather than a dead end. Without it the app could
 * report a new version forever and never install one.
 */
export async function downloadUpdate(): Promise<{ ok: boolean; message: string }> {
  const t = (key: Parameters<typeof mainText>[0]) => mainText(key, language())
  if (!app.isPackaged) return { ok: false, message: t("updateDevOnly") }
  try {
    staged = false
    // downloadUpdate resolves with the cached file paths, not the metadata, so
    // the version to report comes from the update-available event above.
    await quietly(() => autoUpdater.downloadUpdate())
    staged = true
    return { ok: true, message: foundVersion ? `${t("updateReady")} ${foundVersion}` : t("updateReady") }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Install the staged update and restart.
 *
 * `quitAndInstall` hands off to the NSIS installer, which replaces the files
 * and relaunches; it does not return, so the call is deferred to a fresh tick
 * to let the reply to the renderer go out first.
 */
export function installUpdate(): { ok: boolean; message: string } {
  const t = (key: Parameters<typeof mainText>[0]) => mainText(key, language())
  if (!app.isPackaged) return { ok: false, message: t("updateDevOnly") }
  if (!staged) return { ok: false, message: t("updateNoPending") }
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
  return { ok: true, message: t("updateInstalling") }
}

/** Settings toggle: turn checking on or off without restarting. */
export function setAutoUpdate(enabled: boolean): void {
  if (enabled) startAutoUpdate()
  else autoUpdater.autoDownload = false
}

/** Language the main process shows its own strings in. */
function language(): UiLanguage {
  const value = getSettings().uiLanguage
  return (MAIN_LANGUAGES.find((item) => item.code === value)?.code ?? "ru") as UiLanguage
}

export function isAutoUpdateOn(): boolean {
  return getSettings().autoUpdate
}