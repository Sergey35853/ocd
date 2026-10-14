import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * The About screen is a list of facts and an update block, and the two ways it
 * can go wrong are both quiet: the update controls left in the settings, where
 * nobody looks for them, and the screen opening without saying whether the app
 * actually looked for a new build.
 *
 * The versions themselves are not asserted here: they arrive from the main
 * process after the first render, which a static render never waits for. What
 * is asserted is that the facts the store already holds are on the screen.
 */
const state = {
  settings: { autoUpdate: true, uiLanguage: "ru" },
  status: {
    connected: true,
    url: "http://127.0.0.1:49374",
    version: "2.0.29",
    registrationFile: "C:\\Users\\link_\\.local\\state\\opencode\\service.json",
  },
  toast: vi.fn(),
  connect: vi.fn(async () => undefined),
  updateSettings: vi.fn(async () => undefined),
}

vi.mock("../lib/store", () => ({
  // Only the handful of fields this screen reads; a fake typed as the real
  // Store would have to be kept in step with every field the store grows.
  useStore: () => state,
}))

let checked = 0

beforeEach(() => {
  checked = 0
  // The test environment is node, so there is no window to hang the stub off.
  ;(globalThis as unknown as Record<string, unknown>).window = {
    ocd: {
      app: {
        version: async () => ({ app: "0.1.8", electron: "44.5.1", node: "22.23.2", chrome: "152.0" }),
        checkForUpdates: async () => {
          checked += 1
          return { ok: true, message: "Установленная версия — последняя" }
        },
        downloadUpdate: async () => ({ ok: true, message: "Обновление скачано" }),
        installUpdate: async () => ({ ok: true, message: "Установка" }),
        setAutoUpdate: async () => true,
      },
      configFile: { path: async () => "C:\\Users\\link_\\.config\\opencode\\opencode.jsonc" },
    },
  }
})

async function render() {
  const { AboutView } = await import("./AboutView")
  const markup = renderToStaticMarkup(<AboutView onBack={() => undefined} />)
  // Let the promises the screen starts on mount drain, so a late rejection
  // fails the test it belongs to instead of the next one.
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(checked).toBeLessThanOrEqual(1)
  return markup
}

describe("AboutView", () => {
  it("is its own screen, not a card at the bottom of the settings", async () => {
    const markup = await render()
    expect(markup).toContain("<h1>О программе</h1>")
    expect(markup).toContain("Обновления")
  })

  it("names the runtime and the paths a bug report is asked for", async () => {
    const markup = await render()
    expect(markup).toContain("Electron")
    expect(markup).toContain("2.0.29")
    expect(markup).toContain("http://127.0.0.1:49374")
    expect(markup).toContain("service.json")
  })

  it("carries the update steps that used to sit in the settings", async () => {
    const markup = await render()
    expect(markup).toContain("Проверить сейчас")
    expect(markup).toContain("Скачать обновление")
    expect(markup).toContain("Проверять обновления")
  })

  // The check on open is an effect, and a server render runs no effects. It is
  // one line of code above the fold rather than behaviour worth a jsdom install.
})