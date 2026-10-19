import { beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * The settings screen is nine topics behind a list, not one column.
 *
 * Both halves are worth a test, and they fail in opposite ways. A topic missing
 * from the list is gone from the screen entirely, and a topic that renders its
 * neighbours' fields puts twelve unrelated toggles back under one heading -
 * which is what the page looked like before, and why nobody found the sending
 * option the first time they went looking for it.
 */
const settings = {
  theme: "auto",
  blurBehind: true,
  acrylicOpacity: 0.8,
  acrylicTint: "#202020",
  accentColor: "#0f6cbd",
  fontScale: 1,
  alwaysOnTop: false,
  closeToTray: true,
  startMinimized: false,
  globalHotkey: "",
  showUsage: true,
  showLimits: true,
  showThinking: true,
  sendOnEnter: true,
  busySendMode: "steer",
  notifyOnFinish: false,
  speakReplies: false,
  ttsEngine: "auto",
  ttsVoice: "ru-RU-SvetlanaNeural",
  ttsRate: "0%",
  ttsPitch: "0Hz",
  playbackVolume: 100,
  ttsMaxChars: 600,
  sttModel: "small",
  sttLanguage: "auto",
  micDevice: "",
  dictateDeliver: "insert",
  defaultProvider: "anthropic",
  defaultModel: "claude-sonnet-4",
  defaultAgent: "build",
  serverUrlOverride: "",
  uiLanguage: "ru",
  replyLanguage: "ru",
}

const state = {
  settings,
  directory: "C:\\Users\\link_\\Documents\\Проект по умолчанию",
  agents: [{ id: "build", name: "build" }],
  updateSettings: vi.fn(async () => undefined),
  toast: vi.fn(),
  refreshCatalog: vi.fn(async () => undefined),
  refreshSessions: vi.fn(async () => undefined),
  restartService: vi.fn(async () => undefined),
  setDirectory: vi.fn(async () => undefined),
}

vi.mock("../lib/store", () => ({
  useStore: () => state,
}))

beforeEach(() => {
  ;(globalThis as unknown as Record<string, unknown>).window = {
    ocd: {
      app: {
        pickDirectory: async () => null,
        setGlobalHotkey: async () => ({ ok: true }),
      },
      configFile: { path: async () => "C:\\Users\\link_\\.config\\opencode\\opencode.jsonc" },
      hud: { toggle: async () => ({ ok: true }) },
      remote: { status: async () => ({ active: false, url: null }) },
      settings: { export: async () => null, import: async () => undefined },
      voice: { devices: async () => ({ devices: [] }) },
    },
  }
})

async function render() {
  const { SettingsView } = await import("./SettingsView")
  const markup = renderToStaticMarkup(<SettingsView onBack={() => undefined} />)
  await new Promise((resolve) => setTimeout(resolve, 0))
  return markup
}

describe("SettingsView sections", () => {
  it("lists every topic, so none is reachable only by scrolling", async () => {
    const markup = await render()
    for (const label of [
      "Внешний вид",
      "Окно",
      "Общение",
      "Голос и диктовка",
      "Анимация при обработке запроса",
      "OpenCode",
      "Языковые настройки",
      "Удалённый сервер (SSH)",
      "Данные",
    ]) {
      expect(markup).toContain(`>${label}</button>`)
    }
  })

  it("says what each topic is for", async () => {
    // A list of toggles says what can be changed, not which of them you wanted.
    const markup = await render()
    expect(markup).toContain("Тема, прозрачность и цвета окна.")
  })

  it("opens on the first topic and shows only its fields", async () => {
    const markup = await render()
    expect(markup).toContain("Акриловое размытие")
    expect(markup).not.toContain("Поверх всех окон")
    expect(markup).not.toContain("Отправлять по Enter")
  })

  // Which topic is showing needs a click, and a static render runs no events.
  // That the list holds all nine is what keeps a split from becoming a loss, so
  // it is the part worth the test.

  it("no longer gathers window, sending and backup under one heading", async () => {
    // "Поведение" held twelve unrelated toggles: tray, hotkey, HUD, usage
    // meters, sending, export/import, notifications. Its removal is the whole
    // point, so it is asserted rather than assumed.
    const markup = await render()
    expect(markup).not.toContain("Поведение")
  })
})

/**
 * The default model is picked from a list, not typed out.
 *
 * The field used to be two text inputs - provider on one side, model id on the
 * other - while the list of what the server actually offers lived on another
 * screen. A typo there fails quietly: the next session opens and cannot answer,
 * with nothing on screen saying why. The names have to come from the server
 * because models are added and retired there, and the list therefore has to be
 * re-fetchable.
 *
 * Comments are stripped before matching: several name the very constructs being
 * asserted on, and a match inside a comment would make this pass vacuously.
 */
describe("the default model field", () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const source = readFileSync(join(here, "SettingsView.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")

  it("offers the server's catalog instead of hand-typed names", () => {
    expect(source).toContain("for (const entry of store.models)")
    // store.setModel is the single place that writes the default locally and
    // tells the server about it; a second path here would be the one to drift.
    expect(source).toContain("store.setModel(")
  })

  it("can ask for the list again after the server gains or loses models", () => {
    expect(source).toContain("store.refreshCatalog()")
  })

  it("no longer asks for a provider and a model as free text", () => {
    expect(source).not.toContain("defaultProvider: event.target.value")
    expect(source).not.toContain("defaultModel: event.target.value")
  })
})