import { BrowserWindow, app, dialog } from "electron"
import { autoUpdater } from "electron-updater"
import { mainText, MAIN_LANGUAGES, type UiLanguage } from "./i18n"
import { getSettings } from "./settings"

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
    notify(`${t("updateFound")} ${info.version}`)
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


