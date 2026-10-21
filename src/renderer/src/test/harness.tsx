/* eslint-disable react-refresh/only-export-components -- a test helper, not a screen. */
import type { ReactNode } from "react"
import { render } from "@testing-library/react"
import { StoreProvider } from "../lib/store"

/**
 * A stand-in for the bridge the preload puts on `window`.
 *
 * The renderer never talks to the server itself: it asks the main process
 * through this object. A test that wants to know what the app asked for
 * needs the same object, and a test that wants to hand the app a server event
 * needs the other end of `events.onEvent`.
 */
export interface OcdMock {
  /** Everything the app called, by channel. */
  calls: Record<string, unknown[][]>
  /** The callback the store registered for server events. */
  fireEvent(event: Record<string, unknown>): void
  /** The callback the store registered for connection status. */
  fireStatus(status: Record<string, unknown>): void
  /** How many times a channel was called. */
  count(channel: string): number
}

/** What the app gets back when it asks for the settings. */
export const TEST_SETTINGS = {
  defaultDirectory: "",
  defaultProvider: "opencode",
  defaultModel: "test-model",
  defaultAgent: "build",
  theme: "light",
  backdrop: "micaAlt",
  acrylicOpacity: 0.45,
  acrylicTint: "#eef3fa",
  accentColor: "#0f6cbd",
  blurBehind: true,
  alwaysOnTop: false,
  startMinimized: false,
  closeToTray: true,
  globalHotkey: "",
  autoUpdate: false,
  autoUpdatePlugins: false,
  fontScale: 1,
  showThinking: true,
  notifyOnFinish: true,
  showUsage: true,
  showLimits: true,
  busySendMode: "steer",
  sendOnEnter: true,
  serverUrlOverride: "",
  replyLanguage: "ru",
  uiLanguage: "ru",
  busyAnimation: { kind: "matrix", opacity: 0.22, speed: 1, hue: 145, density: 16 },
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
} as const

/**
 * Put a bridge on `window` that answers everything and remembers everything.
 *
 * Only the calls a test cares about are answered with something meaningful;
 * the rest answer with an empty value, which is what the app sees when a
 * screen has nothing to show.
 */
export function installOcdMock(overrides: Record<string, unknown> = {}): OcdMock {
  const calls: Record<string, unknown[][]> = {}
  let onEvent: ((event: Record<string, unknown>) => void) | null = null
  let onStatus: ((status: Record<string, unknown>) => void) | null = null

  const record = (channel: string, args: unknown[]) => {
    calls[channel] = calls[channel] ?? []
    calls[channel].push(args)
  }

  const answer = (channel: string, fallback: unknown): unknown => {
    if (channel in overrides) return overrides[channel]
    return fallback
  }

  const api = {
    app: {
      getSettings: async () => answer("app:getSettings", TEST_SETTINGS),
      setSettings: async (patch: Record<string, unknown>) => ({
        ...TEST_SETTINGS,
        ...patch,
      }),
      version: async () => ({ app: "0.0.0-test", electron: "44", node: "22", chrome: "140" }),
      setAlwaysOnTop: async () => undefined,
      setGlobalHotkey: async () => ({ ok: true }),
      setAutoUpdate: async () => true,
      checkForUpdates: async () => ({ ok: true, message: "" }),
      downloadUpdate: async () => ({ ok: true, message: "" }),
      installUpdate: async () => ({ ok: true, message: "" }),
      updateState: async () => ({ available: false, version: "", staged: false }),
      openExternal: async () => undefined,
      openPath: async () => "",
      pickDirectory: async () => null,
      trayState: async () => undefined,
      showWindow: async () => true,
      hideWindow: async () => undefined,
      focusComposer: async () => undefined,
      openSessionWindow: async () => true,
      exportSessionFile: async () => "",
      importSessionFile: async () => "",
      printConversation: async () => ({ ok: true }),
      exportConversation: async () => ({ ok: true }),
      exportProjectSessions: async () => ({ ok: true }),
      saveText: async () => ({ ok: true }),
      onCommand: () => () => undefined,
    },
    service: {
      status: async () => ({ connected: true, url: "http://127.0.0.1:1", error: null }),
      connect: async () => ({ connected: true, url: "http://127.0.0.1:1", error: null }),
      restart: async () => ({ connected: true, url: "http://127.0.0.1:1", error: null }),
    },
    api: {
      sessions: async () => [],
      models: async () => [],
      providers: async () => [],
      agents: async () => [],
      skills: async () => [],
      commands: async () => [],
      mcp: async () => [],
      activeSessions: async () => ({}),
      messagePage: async () => ({ items: [] }),
      session: async () => ({}),
      context: async () => ({}),
      sessionContext: async () => ({ context: "" }),
      prompt: async () => ({}),
      interrupt: async () => ({ interrupted: true }),
      setSessionModel: async () => ({}),
      setSessionAgent: async () => ({}),
      vcsBranch: async () => null,
      gitBranch: async () => null,
      gitStatus: async () => null,
      worktrees: async () => [],
      permissionRules: async () => [],
      findFiles: async () => [],
      credentials: async () => [],
      mcpResources: async () => ({ resources: [], templates: [] }),
      sessionLog: async () => [],
      serverDefaultModel: async () => null,
    },
    configFile: {
      read: async () => ({ path: "", text: "{}", exists: true }),
      write: async () => ({ ok: true }),
      reload: async () => ({}),
      replyLanguage: async () => "auto",
      languageCurrent: async () => true,
      providers: async () => [],
      path: async () => "",
      setProvider: async () => ({}),
      removeProvider: async () => ({}),
      setReplyLanguage: async () => ({}),
    },
    events: {
      subscribe: async () => ({ ok: true }),
      onEvent: (cb: (event: Record<string, unknown>) => void) => {
        onEvent = cb
        return () => {
          onEvent = null
        }
      },
      onStatus: (cb: (status: Record<string, unknown>) => void) => {
        onStatus = cb
        return () => {
          onStatus = null
        }
      },
      onUpdate: () => () => undefined,
    },
    limits: {
      snapshot: async (model: string) => ({
        model,
        windows: [],
        source: "none",
        cooldownUntil: null,
        updatedAt: 0,
      }),
      set: async (model: string) => ({
        model,
        windows: [],
        source: "none",
        cooldownUntil: null,
        updatedAt: 0,
      }),
      clear: async () => true,
    },
    notify: {
      finish: async (notice: Record<string, unknown>) => {
        record("notify:finish", [notice])
        return true
      },
    },
    permission: { list: async () => [], reply: async () => undefined },
    form: { list: async () => [], reply: async () => undefined, cancel: async () => undefined },
    inbox: { list: async () => [], cancel: async () => true, setDelivery: async () => true },
    search: { build: async () => ({ sessions: 0 }), query: async () => [], clear: async () => undefined },
    diag: { report: async () => true, tail: async () => [], folder: async () => null },
    feedback: { configured: async () => false, send: async () => true },
    settings: { export: async () => "", import: async () => TEST_SETTINGS },
    plugins: { list: async () => [], search: async () => [], install: async () => ({ ok: true }), uninstall: async () => ({ ok: true }), revealLocal: async () => undefined },
    model: { engines: async () => [], list: async () => [], pull: async () => "", pullCancel: async () => true, delete: async () => true, onProgress: () => () => undefined },
    local: { hardware: async () => null, searchRepos: async () => [], repoFiles: async () => [] },
    preview: { writeTemp: async () => "", open: async () => ({ url: "", kind: "native", route: "native" }), openExternal: async () => true },
    attachments: { pick: async () => ({ attachments: [], errors: [], notes: [] }), fromClipboard: async () => ({ attachments: [], errors: [], notes: [] }), fromPaths: async () => ({ attachments: [], errors: [], notes: [] }), fromDataUrl: async () => ({ attachments: [], errors: [], notes: [] }) },
    contextMenu: { show: async () => undefined, onRevertRequest: () => () => undefined, onAttach: () => () => undefined },
    voice: { defaults: async () => ({}), devices: async () => [], voices: async () => [], speak: async () => undefined, stopSpeaking: async () => undefined, startDictation: async () => ({ ok: true }), stopDictation: async () => undefined, cancelDictation: async () => undefined, onState: () => () => undefined, onResult: () => () => undefined },
    hud: { onState: () => () => undefined, request: async () => undefined, toggle: async () => false, close: async () => undefined },
    notice: { onShow: () => () => undefined, dismiss: async () => true },
    pty: { open: async () => ({}), input: async () => undefined, close: async () => undefined, onOutput: () => () => undefined },
    remote: { connect: async () => ({ url: "", port: 0 }), disconnect: async () => undefined, status: async () => ({ active: false, url: null }) },
    shell: { openTerminal: async () => ({ launcher: "cmd", opened: true }) },
    integration: { list: async () => [], connectKey: async () => ({}), oauthBegin: async () => ({}), oauthStatus: async () => ({}), oauthComplete: async () => ({}), oauthCancel: async () => ({}), probe: async () => ({ online: false }) },
  }

  ;(globalThis as unknown as { window: { ocd: unknown } }).window.ocd = api

  /**
   * Remember every call.
   *
   * The bridge is a tree of functions, and the channel a call went down is the
   * path to it — "app.getSettings", "notify.finish". Wrapping the whole tree
   * is what makes every call countable, not only the ones a test thought of.
   */
  const instrument = (node: unknown, path: string[] = []): unknown => {
    if (typeof node === "function") {
      return (...args: unknown[]) => {
        record(path.join("."), args)
        return (node as (...a: unknown[]) => unknown)(...args)
      }
    }
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        out[key] = instrument(value, [...path, key])
      }
      return out
    }
    return node
  }

  ;(globalThis as unknown as { window: { ocd: unknown } }).window.ocd = instrument(api)

  return {
    calls,
    fireEvent: (event) => onEvent?.(event),
    fireStatus: (status) => onStatus?.(status),
    count: (channel) => calls[channel]?.length ?? 0,
  }
}

/** Render something inside the store, the way the app does. */
export function renderWithStore(ui: ReactNode) {
  return render(<StoreProvider>{ui}</StoreProvider>)
}
