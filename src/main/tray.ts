import { Menu, Tray } from "electron"
import { getSettings, setSettings } from "./settings"
import { windowIcon } from "./icon"
import { mainText, MAIN_LANGUAGES, type UiLanguage } from "./i18n"
import { hudVisible, toggleHud } from "./hud"

export interface TrayState {
  connected: boolean
  /** Newest sessions, already trimmed; shown as a submenu. */
  recent: Array<{ id: string; title: string }>
  language: UiLanguage
  /** True while the main window is on screen. */
  visible: boolean
}

export interface TrayActions {
  show(): void
  hide(): void
  quickAsk(): void
  openSession(sessionId: string): void
  restartServer(): void
  reconnect(): void
  setLanguage(language: UiLanguage): void
  quit(): void
}

let tray: Tray | null = null
let actions: TrayActions | null = null

let state: TrayState = {
  connected: false,
  recent: [],
  language: "ru",
  visible: false,
}

export function updateTrayState(next: Partial<TrayState>): void {
  state = { ...state, ...next }
  rebuild()
}

function rebuild(): void {
  if (!tray || tray.isDestroyed() || !actions) return
  const t = (key: Parameters<typeof mainText>[0]) => mainText(key, state.language)

  const recentItems = state.recent.length
    ? state.recent.map((session) => ({
        label: session.title || session.id,
        click: () => actions?.openSession(session.id),
      }))
    : [{ label: t("recentEmpty"), enabled: false }]

  const menu = Menu.buildFromTemplate([
    {
      label: state.visible ? t("hide") : t("show"),
      click: () => (state.visible ? actions?.hide() : actions?.show()),
    },
    { label: t("quickAsk"), click: () => actions?.quickAsk() },
    { type: "separator" },
    { label: t("recent"), submenu: recentItems },
    {
      label: hudVisible() ? t("hudHide") : t("hudShow"),
      click: () => toggleHud(),
    },
    { type: "separator" },
    {
      label: `${t("server")}: ${state.connected ? t("serverConnected") : t("serverDown")}`,
      enabled: false,
    },
    state.connected
      ? { label: t("restartServer"), click: () => actions?.restartServer() }
      : { label: t("reconnect"), click: () => actions?.reconnect() },
    {
      label: t("language"),
      submenu: MAIN_LANGUAGES.map((item) => ({
        label: item.label,
        type: "radio" as const,
        checked: item.code === state.language,
        click: () => {
          setSettings({ uiLanguage: item.code })
          updateTrayState({ language: item.code })
          actions?.setLanguage(item.code)
        },
      })),
    },
    { type: "separator" },
    { label: t("quit"), click: () => actions?.quit() },
  ])

  tray.setContextMenu(menu)
  tray.setToolTip(
    state.connected
      ? `OCD — ${mainText("serverConnected", state.language)}`
      : `OCD — ${mainText("serverDown", state.language)}`,
  )
}

/**
 * Hand the tray its callbacks.
 *
 * index.ts owns them because it also owns the window, and a module-level
 * registry avoids a tray -> index -> tray import cycle while still letting
 * ipc.ts create the tray on demand (close-to-tray) without knowing the
 * handlers.
 */
export function setTrayActions(handlers: TrayActions): void {
  actions = handlers
  rebuild()
}

export function createTray(): void {
  try {
    if (tray && !tray.isDestroyed()) {
      rebuild()
      return
    }
    state.language = currentLanguage()
    tray = new Tray(windowIcon())
    tray.on("click", () => actions?.show())
    tray.on("double-click", () => actions?.show())
    rebuild()
  } catch (err) {
    console.error("Tray unavailable:", err)
  }
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
  actions = null
}

export function trayExists(): boolean {
  return Boolean(tray && !tray.isDestroyed())
}

/** Read the language the app is currently running in. */
export function currentLanguage(): UiLanguage {
  const value = getSettings().uiLanguage
  return (MAIN_LANGUAGES.find((item) => item.code === value)?.code ?? "ru") as UiLanguage
}