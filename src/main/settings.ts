import { app } from "electron"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { AppSettings } from "@shared/types"

const DEFAULTS: AppSettings = {
  defaultDirectory: "",
  defaultProvider: "opencode",
  defaultModel: "minimax-m3.1-flash-free",
  defaultAgent: "build",
  // Win11 "Mica Alt" look: light, neutral, low saturation.
  theme: "light",
  acrylicOpacity: 0.82,
  acrylicTint: "#eef3fa",
  accentColor: "#0f6cbd",
  blurBehind: true,
  alwaysOnTop: false,
  startMinimized: false,
  closeToTray: true,
  // Empty means "no global hotkey": claiming a system-wide accelerator
  // without being asked is rude, so the user opts in from Settings.
  globalHotkey: "",
  autoUpdate: false,
  fontScale: 1,
  showThinking: true,
  notifyOnFinish: true,
  showUsage: true,
  showLimits: true,
  // Typing while the model is still answering usually means "wait, also this" —
  // which the server can fold into the running turn. Queueing is the rarer
  // intent, so it has to be asked for.
  busySendMode: "steer",
  sendOnEnter: true,
  autoUpdatePlugins: false,
  serverUrlOverride: "",
  replyLanguage: "ru",
  uiLanguage: "ru",

  // Busy animation: a Matrix-style rain by default.
  busyAnimation: {
    kind: "matrix",
    opacity: 0.22,
    speed: 1,
    hue: 145,
    density: 16,
  },

  // Mirrors the local oc-voice / oc-dictate plugin defaults.
  speakReplies: false,
  ttsEngine: "auto",
  ttsVoice: "ru-RU-SvetlanaNeural",
  ttsRate: "+8%",
  ttsVolume: "+0%",
  ttsPitch: "+0Hz",
  ttsMaxChars: 420,
  playbackVolume: 100,
  sttModel: "small",
  sttLanguage: "auto",
  micDevice: "",
  dictateDeliver: "insert",
}

function settingsFile(): string {
  return join(app.getPath("userData"), "ocd-settings.json")
}

let cached: AppSettings | null = null

function load(): AppSettings {
  const file = settingsFile()
  try {
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<AppSettings>
      cached = { ...DEFAULTS, ...parsed }
      return cached
    }
  } catch {
    /* fall through to defaults */
  }
  cached = { ...DEFAULTS }
  return cached
}

export function getSettings(): AppSettings {
  return cached ?? load()
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...patch }
  cached = next
  const file = settingsFile()
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(next, null, 2), "utf8")
  } catch (err) {
    console.error("Failed to persist settings:", err)
  }
  return next
}

export { DEFAULTS as SETTINGS_DEFAULTS }

/**
 * Write the settings to a file the user chooses.
 *
 * Settings live in the Windows profile, which is exactly why they are the
 * first thing missing on a new machine: nothing about the project folder
 * carries them over. This makes them a file that can be.
 */
export function exportSettings(target: string): string {
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, JSON.stringify(getSettings(), null, 2), "utf8")
  return target
}

/**
 * Adopt settings from a file, ignoring anything OCD does not know.
 *
 * The file may come from another machine or another version, so unknown keys
 * are dropped rather than merged: a field the app never reads would otherwise
 * be written back out and look like it had been configured.
 */
export function importSettings(source: string): AppSettings {
  const parsed = JSON.parse(readFileSync(source, "utf8")) as Partial<AppSettings>
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Not an OCD settings file")
  }
  const known = Object.fromEntries(
    Object.entries(parsed).filter(([key]) => key in DEFAULTS),
  ) as Partial<AppSettings>
  return setSettings(known)
}
