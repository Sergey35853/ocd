/** Strings the main process needs: tray menu, notifications, export dialogs.
 *
 * Kept apart from the renderer dictionary on purpose — main has no React and
 * no DOM, and pulling that module in would drag the i18n runtime with it. The
 * keys are a subset, mirrored by hand. */

export type UiLanguage = "ru" | "en" | "de" | "fr" | "zh"

export const MAIN_LANGUAGES: ReadonlyArray<{ code: UiLanguage; label: string }> = [
  { code: "ru", label: "Русский" },
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "zh", label: "中文" },
]

const STRINGS = {
  show: { ru: "Показать OCD", en: "Show OCD", de: "OCD anzeigen", fr: "Afficher OCD", zh: "显示 OCD" },
  hide: { ru: "Скрыть OCD", en: "Hide OCD", de: "OCD ausblenden", fr: "Masquer OCD", zh: "隐藏 OCD" },
  quickAsk: {
    ru: "Быстрый запрос",
    en: "Quick ask",
    de: "Schnellfrage",
    fr: "Question rapide",
    zh: "快速提问",
  },
  quickAskHint: {
    ru: "Перейти к вводу в активной беседе",
    en: "Jump to the composer of the active chat",
    de: "Zum Eingabefeld des aktiven Chats springen",
    fr: "Aller au champ de saisie du chat actif",
    zh: "跳到当前对话的输入框",
  },
  recent: { ru: "Недавние сессии", en: "Recent sessions", de: "Zuletzt verwendet", fr: "Sessions récentes", zh: "最近会话" },
  recentEmpty: { ru: "Пока пусто", en: "Nothing yet", de: "Noch nichts", fr: "Rien pour l’instant", zh: "暂无" },
  server: { ru: "Сервер", en: "Server", de: "Server", fr: "Serveur", zh: "服务器" },
  serverConnected: { ru: "Подключён", en: "Connected", de: "Verbunden", fr: "Connecté", zh: "已连接" },
  serverDown: { ru: "Недоступен", en: "Unavailable", de: "Nicht erreichbar", fr: "Indisponible", zh: "不可用" },
  restartServer: {
    ru: "Перезапустить сервер",
    en: "Restart server",
    de: "Server neu starten",
    fr: "Redémarrer le serveur",
    zh: "重启服务器",
  },
  reconnect: { ru: "Подключиться", en: "Connect", de: "Verbinden", fr: "Se connecter", zh: "连接" },
  language: { ru: "Язык интерфейса", en: "Interface language", de: "Oberflächensprache", fr: "Langue de l’interface", zh: "界面语言" },
  openSessionWindow: {
    ru: "Открыть в отдельном окне",
    en: "Open in its own window",
    de: "In eigenem Fenster öffnen",
    fr: "Ouvrir dans sa propre fenêtre",
    zh: "在独立窗口中打开",
  },
  alwaysOnTop: { ru: "Поверх всех окон", en: "Always on top", de: "Immer im Vordergrund", fr: "Toujours au premier plan", zh: "总在最前" },
  quit: { ru: "Выход", en: "Quit", de: "Beenden", fr: "Quitter", zh: "退出" },

  // session windows
  sessionWindowTitle: {
    ru: "OCD — сессия",
    en: "OCD — session",
    de: "OCD — Sitzung",
    fr: "OCD — session",
    zh: "OCD — 会话",
  },

  // export
  exportTitle: {
    ru: "Экспорт беседы",
    en: "Export conversation",
    de: "Unterhaltung exportieren",
    fr: "Exporter la conversation",
    zh: "导出对话",
  },
  exportMarkdown: { ru: "Markdown", en: "Markdown", de: "Markdown", fr: "Markdown", zh: "Markdown" },
  exportHtml: { ru: "HTML", en: "HTML", de: "HTML", fr: "HTML", zh: "HTML" },
  exportPdf: { ru: "PDF", en: "PDF", de: "PDF", fr: "PDF", zh: "PDF" },
  exportDone: { ru: "Экспорт готов", en: "Export ready", de: "Export bereit", fr: "Export prêt", zh: "导出完成" },
  exportFailed: { ru: "Не удалось экспортировать", en: "Export failed", de: "Export fehlgeschlagen", fr: "Échec de l’export", zh: "导出失败" },

  // hotkey
  hotkeyRegistered: { ru: "Горячая клавиша включена", en: "Hotkey enabled", de: "Hotkey aktiviert", fr: "Raccourci activé", zh: "快捷键已启用" },
  hotkeyFailed: {
    ru: "Не удалось занять клавишу — она уже занята другой программой",
    en: "Could not claim the key — another program already holds it",
    de: "Taste konnte nicht belegt werden — sie ist bereits vergeben",
    fr: "Impossible de réserver la touche — elle est déjà prise",
    zh: "无法占用该按键 — 已被其他程序占用",
  },

  // heads-up display
  hudShow: {
    ru: "Показать панель HUD",
    en: "Show the HUD strip",
    de: "HUD-Leiste anzeigen",
    fr: "Afficher le bandeau HUD",
    zh: "显示 HUD 状态条",
  },
  hudHide: {
    ru: "Скрыть панель HUD",
    en: "Hide the HUD strip",
    de: "HUD-Leiste ausblenden",
    fr: "Masquer le bandeau HUD",
    zh: "隐藏 HUD 状态条",
  },

  notifyFailedShort: {
    ru: "ошибка",
    en: "failed",
    de: "Fehler",
    fr: "échec",
    zh: "失败",
  },

  // updater
  ok: { ru: "ОК", en: "OK", de: "OK", fr: "OK", zh: "确定" },
  updateFound: {
    ru: "Доступна новая версия:",
    en: "A new version is available:",
    de: "Eine neue Version ist verfügbar:",
    fr: "Une nouvelle version est disponible :",
    zh: "有新版本可用：",
  },
  updateNone: {
    ru: "Установленная версия — последняя",
    en: "You are up to date",
    de: "Die installierte Version ist aktuell",
    fr: "Votre version est à jour",
    zh: "已是最新版本",
  },
  updateDevOnly: {
    ru: "Проверка обновлений работает только в установленной сборке",
    en: "Update checks only work in an installed build",
    de: "Update-Prüfung funktioniert nur in einer installierten Version",
    fr: "La vérification des mises à jour ne fonctionne que sur une version installée",
    zh: "仅已安装的版本支持检查更新",
  },
} as const

export type MainStringKey = keyof typeof STRINGS

export function mainText(key: MainStringKey, language: UiLanguage): string {
  return STRINGS[key][language] ?? STRINGS[key].en
}
