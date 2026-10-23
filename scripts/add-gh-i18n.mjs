import { readFileSync, writeFileSync } from "node:fs"

const WORK = "Работай над #{n}: {title}\n{url}"
const WORK_EN = "Work on #{n}: {title}\n{url}"
const WORK_DE = "Arbeite an #{n}: {title}\n{url}"
const WORK_FR = "Travaille sur #{n} : {title}\n{url}"
const WORK_ZH = "处理 #{n}：{title}\n{url}"

const ADD = {
  ru: {
    "gh.title": "GitHub",
    "gh.notRepo": "Эта папка не из GitHub-репозитория.",
    "gh.needToken": "Добавьте токен GitHub в настройках, чтобы увидеть задачи.",
    "gh.issues": "Задачи",
    "gh.pulls": "Pull request'ы",
    "gh.open": "Открыть",
    "gh.workOnBtn": "В беседу",
    "gh.workOn": WORK,
    "gh.close": "Закрыть",
    "gh.loading": "Загружаем…",
    "gh.empty": "Открытых нет.",
    "gh.failed": "GitHub ответил: {error}",
    "session.github": "GitHub (задачи, PR)",
    "set.githubToken": "Токен GitHub",
    "set.githubTokenHint": "Personal access token для списка задач и PR. Хранится в файле настроек.",
  },
  en: {
    "gh.title": "GitHub",
    "gh.notRepo": "This folder is not a GitHub repository.",
    "gh.needToken": "Add a GitHub token in settings to see issues.",
    "gh.issues": "Issues",
    "gh.pulls": "Pull requests",
    "gh.open": "Open",
    "gh.workOnBtn": "Start",
    "gh.workOn": WORK_EN,
    "gh.close": "Close",
    "gh.loading": "Loading…",
    "gh.empty": "Nothing open.",
    "gh.failed": "GitHub said: {error}",
    "session.github": "GitHub (issues, PR)",
    "set.githubToken": "GitHub token",
    "set.githubTokenHint": "Personal access token for the issues/PR list. Stored in the settings file.",
  },
  de: {
    "gh.title": "GitHub",
    "gh.notRepo": "Dieser Ordner ist kein GitHub-Repository.",
    "gh.needToken": "Fügen Sie in den Einstellungen ein GitHub-Token hinzu, um Issues zu sehen.",
    "gh.issues": "Issues",
    "gh.pulls": "Pull Requests",
    "gh.open": "Öffnen",
    "gh.workOnBtn": "Starten",
    "gh.workOn": WORK_DE,
    "gh.close": "Schließen",
    "gh.loading": "Lade…",
    "gh.empty": "Nichts offen.",
    "gh.failed": "GitHub antwortete: {error}",
    "session.github": "GitHub (Issues, PR)",
    "set.githubToken": "GitHub-Token",
    "set.githubTokenHint": "Personal-Access-Token für die Issue-/PR-Liste. Liegt in der Einstellungsdatei.",
  },
  fr: {
    "gh.title": "GitHub",
    "gh.notRepo": "Ce dossier n’est pas un dépôt GitHub.",
    "gh.needToken": "Ajoutez un jeton GitHub dans les paramètres pour voir les tickets.",
    "gh.issues": "Tickets",
    "gh.pulls": "Pull requests",
    "gh.open": "Ouvrir",
    "gh.workOnBtn": "Lancer",
    "gh.workOn": WORK_FR,
    "gh.close": "Fermer",
    "gh.loading": "Chargement…",
    "gh.empty": "Rien d’ouvert.",
    "gh.failed": "GitHub a répondu : {error}",
    "session.github": "GitHub (tickets, PR)",
    "set.githubToken": "Jeton GitHub",
    "set.githubTokenHint": "Jeton d’accès personnel pour la liste des tickets/PR. Stocké dans le fichier de paramètres.",
  },
  zh: {
    "gh.title": "GitHub",
    "gh.notRepo": "此文件夹不是 GitHub 仓库。",
    "gh.needToken": "在设置中添加 GitHub 令牌以查看议题。",
    "gh.issues": "议题",
    "gh.pulls": "拉取请求",
    "gh.open": "打开",
    "gh.workOnBtn": "开始",
    "gh.workOn": WORK_ZH,
    "gh.close": "关闭",
    "gh.loading": "加载中…",
    "gh.empty": "没有未解决的。",
    "gh.failed": "GitHub回复：{error}",
    "session.github": "GitHub（议题、PR）",
    "set.githubToken": "GitHub 令牌",
    "set.githubTokenHint": "用于议题/PR 列表的个人访问令牌。存储在设置文件中。",
  },
}

for (const [code, entries] of Object.entries(ADD)) {
  const file = `src/renderer/src/i18n/${code}.ts`
  let text = readFileSync(file, "utf8")
  const lines = []
  let added = 0
  for (const [key, value] of Object.entries(entries)) {
    if (text.includes(`"${key}"`)) continue
    lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)},`)
    added += 1
  }
  if (added === 0) {
    console.log(`${file}: nothing to add`)
    continue
  }
  let at = text.lastIndexOf("} as const")
  let suffix = ""
  if (at < 0) {
    at = text.lastIndexOf("\n}")
    suffix = "\n"
  }
  if (at < 0) throw new Error(`no closing marker in ${file}`)
  const block = `${lines.join("\n")}\n`
  text = `${text.slice(0, at)}${suffix}${block}${text.slice(at + suffix.length)}`
  writeFileSync(file, text, "utf8")
  console.log(`${file}: ${added} added`)
}
