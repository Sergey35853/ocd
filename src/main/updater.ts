import { BrowserWindow, app, dialog } from "electron"
import { autoUpdater } from "electron-updater"
import { mainText, MAIN_LANGUAGES, type UiLanguage } from "./i18n"
import { getSettings } from "./settings"

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
 * Opt-in update checks.
 *
 * Three deliberate limits:
 *  - packaged builds only: a portable exe or `electron-vite dev` has no
 *    installation to replace, so asking GitHub for a newer version would be
 *    noise;
 *  - `autoDownload` is off — a 110 MB download has to be the user's decision;
 *  - `autoInstallOnAppQuit` is on, so once the file is staged the install
 *    happens on the next normal quit instead of interrupting a session.
 */
export function startAutoUpdate(): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  // The default provider (Squirrel.Windows) does not work for NSIS installers
  // produced by electron-builder; without this the first check throws instead
  // of simply finding nothing.
  autoUpdater.logger = null

  const t = (key: Parameters<typeof mainText>[0]) => mainText(key, language())

  const notify = (message: string) => {
    const parent = BrowserWindow.getAllWindows()[0]
    if (parent) {
      void dialog.showMessageBox(parent, { message, buttons: [t("ok") as string] }).catch(() => undefined)
    }
  }

  autoUpdater.on("update-available", (info) => {
    staged = false
    foundVersion = info.version
    notify(`${t("updateFound")} ${info.version}`)
  })

  autoUpdater.on("update-downloaded", (info) => {
    staged = true
    notify(`${t("updateReady")} ${info.version}`)
  })

  autoUpdater.on("update-not-available", () => {
    notify(t("updateNone"))
  })

  autoUpdater.on("error", (err) => {
    console.error("Update check failed:", err.message)
  })

  void autoUpdater.checkForUpdates().catch((err) => {
    console.error("Update check failed:", err)
  })
}

/** Manual "check now" from Settings; resolves to a human-readable outcome. */
export async function checkForUpdates(): Promise<{ ok: boolean; message: string }> {
  const t = (key: Parameters<typeof mainText>[0]) => mainText(key, language())
  if (!app.isPackaged) return { ok: false, message: t("updateDevOnly") }
  try {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    const result = await autoUpdater.checkForUpdates()
    const version = result?.updateInfo?.version
    return { ok: true, message: version ? `${t("updateFound")} ${version}` : t("updateNone") }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
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
    await autoUpdater.downloadUpdate()
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


