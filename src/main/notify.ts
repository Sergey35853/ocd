import { BrowserWindow, Notification } from "electron"
import { mainText } from "./i18n"
import { getSettings } from "./settings"
import type { FinishNotice } from "@shared/types"

/**
 * Windows toasts for finished turns.
 *
 * The renderer decides *whether* to notify (it knows whether the window has
 * focus); main owns the actual toast because only it can create a Notification
 * that outlives a window being closed and re-opened.
 *
 * The window is passed in rather than looked up: "the window the user came
 * from" is not necessarily the first one in getAllWindows() now that session
 * windows exist.
 */

export type { FinishNotice }

export function notifyFinish(notice: FinishNotice, owner: BrowserWindow | null): boolean {
  if (!getSettings().notifyOnFinish) return false
  if (!Notification.isSupported()) return false

  try {
    const notification = new Notification({
      title: notice.failed
        ? `${notice.title} — ${mainText("notifyFailedShort", getSettings().uiLanguage)}`
        : notice.title,
      body: notice.body,
      silent: false,
      timeoutType: "default",
    })

    // No buttons on purpose: the only useful action is "show me that
    // conversation", which is exactly what a click does by default.
    notification.on("click", () => {
      if (!owner || owner.isDestroyed()) return
      if (owner.isMinimized()) owner.restore()
      owner.show()
      owner.focus()
    })

    notification.show()
    return true
  } catch (err) {
    // Notifications can be refused by policy; never let that break the turn.
    console.error("Notification failed:", err)
    return false
  }
}

/** Make the taskbar entry pulse when the window is in the background. */
export function flashTaskbar(owner: BrowserWindow | null, failed: boolean): void {
  if (!owner || owner.isDestroyed() || owner.isFocused()) return
  try {
    owner.flashFrame(failed)
  } catch {
    /* not supported everywhere */
  }
}