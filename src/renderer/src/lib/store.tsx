import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import type {
  AgentInfo,
  AppSettings,
  CommandInfo,
  FormAnswer,
  InboxItem,
  LimitWindow,
  McpServerInfo,
  PendingForm,
  PermissionDecision,
  PermissionRequest,
  ModelInfo,
  ProviderInfo,
  RequestLimits,
  ServerEvent,
  ServiceStatus,
  SessionInfo,
  SkillInfo,
  PromptFile,
} from "@shared/types"
import type { Toast } from "../components/ui"
import { setLanguage, translate } from "../i18n"
import { withTurnTime } from "./timing"
import { cleanText } from "./text"
import { nextActiveTab, pruneTabs, type OpenTab } from "./tabs"

/** One background command, as the server reports it. */
export interface ShellRun {
  id: string
  command: string
  /** True until the matching ended event arrives. */
  running: boolean
  /** Everything the command has printed so far. */
  output: string
  exit?: number
  startedAt: number
}

export interface LiveTool {
  callID: string
  name: string
  status: "running" | "completed" | "error"
  output?: string
}

/**
 * Merge an incoming request into the pending list.
 *
 * Keyed by id: the stream can repeat permission.asked on reconnect, and a
 * second modal for the same request would ask the user the same question.
 */
function mergePermission(
  current: PermissionRequest[],
  incoming: PermissionRequest,
): PermissionRequest[] {
  if (current.some((item) => item.id === incoming.id)) return current
  return [...current, incoming]
}

/**
 * Whether an event payload really is a permission request.
 *
 * The server's event payloads are untyped on the way in, and both fields here
 * are what the rest of the code keys on: `id` to deduplicate and `sessionID` to
 * route the answer back. A payload missing either would sit in the list
 * forever, waiting for an answer that can never arrive.
 */
function isPermissionRequest(data: unknown): data is PermissionRequest {
  if (!data || typeof data !== "object") return false
  const record = data as Record<string, unknown>
  return typeof record.id === "string" && typeof record.sessionID === "string"
}

export interface LiveTurn {
  messageId: string
  agent?: string
  text: string
  reasoning: string
  tools: LiveTool[]
  model?: { providerID: string; id: string }
  startedAt: number
}

export type { OpenTab }

export type DictationState = "idle" | "recording" | "transcribing"

/** After this long without a completion event we stop showing "busy". */
const BUSY_TIMEOUT_MS = 5 * 60_000

interface Store {
  status: ServiceStatus | null
  settings: AppSettings | null
  directory: string

  sessions: SessionInfo[]
  tabs: OpenTab[]
  activeTab: string | null
  busy: Record<string, boolean>
  /** When the running turn began, per conversation. */
  turnStart: Record<string, number>
  /** Durations of finished turns, per conversation. */
  turnLog: Record<string, number[]>
  /** Ticking clock; advances once a second while a turn runs. */
  now: number
  /** Live spend per session; empty until the server reports usage. */
  usage: Record<string, Usage>
  /** Request tallies per "<provider>/<id>", as of the last read. */
  limits: Record<string, RequestLimits>
  /** Re-read the ledger for one model (or all of them when given nothing). */
  refreshLimits(model?: string): Promise<void>
  /** Type in a limit for one window; null forgets it and falls back. */
  setModelLimit(model: string, window: LimitWindow, limit: number | null): Promise<void>
  /** Forget the tally for one model, or for every model. */
  resetLimits(model?: string): Promise<void>
  live: Record<string, LiveTurn>

  models: ModelInfo[]
  providers: ProviderInfo[]
  agents: AgentInfo[]
  skills: SkillInfo[]
  commands: CommandInfo[]
  mcp: McpServerInfo[]

  toasts: Toast[]

  dictation: DictationState
  /** Latest transcript, consumed once by the composer. */
  dictationText: string | null
  clearDictationText(): void
  startDictation(): Promise<void>
  stopDictation(): Promise<void>
  cancelDictation(): Promise<void>
  speak(text: string): Promise<void>
  stopSpeaking(): Promise<void>

  connect(serverUrl?: string): Promise<void>
  restartService(): Promise<void>
  setDirectory(dir: string): Promise<void>
  refreshSessions(): Promise<void>
  newSession(): Promise<string | null>
  openSession(sessionId: string): void
  closeTab(sessionId: string): void
  deleteSession(sessionId: string): Promise<void>
  renameSession(sessionId: string, title: string): Promise<void>
  refreshCatalog(): Promise<void>
  send(
    sessionId: string,
    text: string,
    agent?: string,
    files?: PromptFile[],
  ): Promise<void>
  /** Prompts the server is holding for the running turn, per conversation. */
  inbox: Record<string, InboxItem[]>
  /** Re-read what the server has waiting for this conversation. */
  refreshInbox(sessionId: string): Promise<void>
  /** Drop one waiting prompt. */
  cancelInbox(sessionId: string, inboxId: string): Promise<void>
  /** Drop everything waiting for this conversation. */
  clearInbox(sessionId: string): Promise<void>
  /** Pull a waiting prompt into the running turn instead of waiting. */
  steerInbox(sessionId: string, inboxId: string): Promise<void>
  /** Requests the server is blocked on, awaiting an answer. */
  pendingPermissions: PermissionRequest[]
  /** Re-read the waiting list from the server. */
  pollPermissions(): Promise<void>
  answerPermission(
    request: PermissionRequest,
    decision: PermissionDecision,
    message?: string,
  ): Promise<void>
  /** Questions the model is waiting on, per conversation. */
  forms: Record<string, PendingForm[]>
  /** Commands run in the background, newest first, per conversation. */
  shellRuns: Record<string, ShellRun[]>
  /** Re-read the waiting questions for a conversation. */
  pollForms(sessionId: string): Promise<void>
  /** Settle a question, which is what releases the blocked turn. */
  answerForm(sessionId: string, formId: string, answer: FormAnswer): Promise<void>
  /** Dismiss a question without answering it. */
  cancelForm(sessionId: string, formId: string): Promise<void>
  setModel(providerID: string, modelID: string, sessionId?: string | null): Promise<void>
  /** Rewinds the conversation to a message and resends it; false if refused. */
  editAndResend(sessionId: string, messageId: string, text: string): Promise<boolean>
  /** Stop the running turn; the server picks up anything waiting. */
  abort(sessionId: string): Promise<void>
  updateSettings(patch: Partial<AppSettings>): Promise<void>
  toast(text: string, kind?: "info" | "error"): void
  dismissToast(id: number): void
}

const StoreContext = createContext<Store | null>(null)

export function useStore(): Store {
  const store = useContext(StoreContext)
  if (!store) throw new Error("useStore must be used inside <StoreProvider>")
  return store
}

/** "#1b1430" -> "27, 20, 48" so it can be used inside rgba(var(--tint), a). */
function hexToTriplet(hex: string): string {
  const clean = hex.replace("#", "").trim()
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((char) => char + char)
          .join("")
      : clean
  if (full.length !== 6 || /[^0-9a-f]/i.test(full)) return "27, 20, 48"
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return `${r}, ${g}, ${b}`
}

/** Relative luminance of the tint, 0..1. */
function luminance(hex: string): number {
  const clean = hex.replace("#", "").trim()
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((char) => char + char)
          .join("")
      : clean
  if (full.length !== 6 || /[^0-9a-f]/i.test(full)) return 0.1
  const channels = [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16) / 255)
  const linear = channels.map((value) =>
    value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4),
  )
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

let toastSeq = 1

/**
 * Open tabs live in React state, which means they evaporate on restart. The
 * user keeps a working set of conversations open, so the set is persisted
 * instead of being rebuilt empty on every launch.
 */
const TABS_KEY = "ocd.tabs.v1"

/**
 * Past turn durations, kept so the estimate survives a restart.
 *
 * Without this the first turn after reopening the app has nothing to learn from
 * and shows an elapsed clock with no forecast, which reads as "the estimate is
 * broken" rather than "there is no history yet".
 */
const TURN_LOG_KEY = "ocd.turnlog.v1"

function readTurnLog(): Record<string, number[]> {
  try {
    const raw = localStorage.getItem(TURN_LOG_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, number[]> = {}
    for (const [id, list] of Object.entries(parsed)) {
      if (!Array.isArray(list)) continue
      out[id] = list.filter((ms): ms is number => typeof ms === "number" && ms > 0).slice(-24)
    }
    return out
  } catch {
    return {}
  }
}

function writeTurnLog(log: Record<string, number[]>) {
  try {
    // Only conversations with something worth learning from are kept, so the
    // blob cannot grow without bound as sessions come and go.
    const useful: Record<string, number[]> = {}
    for (const [id, list] of Object.entries(log)) {
      if (list.length >= 2) useful[id] = list.slice(-24)
    }
    localStorage.setItem(TURN_LOG_KEY, JSON.stringify(useful))
  } catch {
    /* private mode or a full quota: the estimate just starts over */
  }
}

/**
 * Running spend per session, in the server's own units.
 *
 * `session.usage.updated` arrives while the answer streams, so this is what
 * makes the figure move instead of jumping once at the end. Kept separate from
 * the messages because the counters are cumulative for the session while the
 * message list is the persisted copy.
 */
interface Usage {
  cost: number
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  /** Epoch ms of the last update, for the "за N мин" hint. */
  at: number
}

/** Read whatever shape the server used for this update, without guessing twice. */
function readUsage(data: Record<string, unknown>): Usage {
  const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0)
  const tokens = (data.tokens ?? data.usage ?? {}) as Record<string, unknown>
  const cache = (tokens.cache ?? {}) as Record<string, unknown>
  return {
    cost: num(data.cost),
    input: num(tokens.input),
    output: num(tokens.output),
    reasoning: num(tokens.reasoning),
    cacheRead: num(cache.read),
    cacheWrite: num(cache.write),
    at: Date.now(),
  }
}

interface PersistedTabs {
  tabs: string[]
  active: string | null
}

function readPersistedTabs(): PersistedTabs {
  try {
    const raw = localStorage.getItem(TABS_KEY)
    if (!raw) return { tabs: [], active: null }
    const parsed = JSON.parse(raw) as Partial<PersistedTabs>
    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs.filter((id): id is string => typeof id === "string")
      : []
    const active = typeof parsed.active === "string" ? parsed.active : null
    return { tabs, active: active && tabs.includes(active) ? active : null }
  } catch {
    return { tabs: [], active: null }
  }
}

function writePersistedTabs(tabs: string[], active: string | null): void {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, active }))
  } catch {
    /* private mode or a full quota: tabs simply do not survive the restart */
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ServiceStatus | null>(null)
  const [settings, setSettingsState] = useState<AppSettings | null>(null)
  const [directory, setDirectoryState] = useState("")
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [tabs, setTabs] = useState<OpenTab[]>(() =>
    readPersistedTabs().tabs.map((sessionId) => ({ sessionId, openedAt: 0 })),
  )
  const [activeTab, setActiveTab] = useState<string | null>(() => readPersistedTabs().active)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  /** When the running turn began, per conversation. */
  const [turnStart, setTurnStart] = useState<Record<string, number>>({})
  /** Durations of finished turns, per conversation, oldest first. */
  const [turnLog, setTurnLog] = useState<Record<string, number[]>>(() => readTurnLog())
  /**
   * A clock that ticks once a second while anything is running.
   *
   * One timer for the whole app rather than one per counter: with several
   * conversations working at once, a timer per bubble would redraw the tree
   * several times a second for nothing.
   */
  const [now, setNow] = useState(() => Date.now())
  const [inbox, setInbox] = useState<Record<string, InboxItem[]>>({})
  const [pendingPermissions, setPendingPermissions] = useState<PermissionRequest[]>([])
  /** Questions the model is waiting on, per conversation. */
  const [forms, setForms] = useState<Record<string, PendingForm[]>>({})
  /**
   * Commands run in the background, newest first, per conversation.
   *
   * The server streams these as their own lifecycle events rather than through
   * the message stream, so they survive a reload of the conversation and can be
   * watched while they run.
   */
  const [shellRuns, setShellRuns] = useState<Record<string, ShellRun[]>>({})
  const [usage, setUsage] = useState<Record<string, Usage>>({})
  const [limits, setLimits] = useState<Record<string, RequestLimits>>({})
  const [live, setLive] = useState<Record<string, LiveTurn>>({})
  const [models, setModels] = useState<ModelInfo[]>([])
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [commands, setCommands] = useState<CommandInfo[]>([])
  const [mcp, setMcp] = useState<McpServerInfo[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [dictation, setDictation] = useState<DictationState>("idle")
  const [dictationText, setDictationText] = useState<string | null>(null)

  // Kept in refs so event handlers never close over stale state.
  const directoryRef = useRef("")
  const activeTabRef = useRef<string | null>(null)
  /**
   * A rising id for every session list the server has handed over.
   *
   * Exists so that "is this session still there?" can be asked against a list
   * that arrived *after* the question was raised. Without it, a tab opened a
   * moment ago gets judged by the list that predates it, fails, and is closed
   * again — which is exactly what the "+" button was doing.
   */
  const sessionsFetchRef = useRef(0)
  /**
   * Address of the service the window last heard from.
   *
   * A server that restarts comes back on another port, and the moment it does
   * is the one moment the lists on screen are worth refetching — by then every
   * request made against the old address has failed.
   */
  const serviceUrlRef = useRef<string | null>(null)
  const busyRef = useRef<Record<string, boolean>>({})
  /** Start of the running turn; read by the completion handler, not rendered. */
  const turnStartRef = useRef<Record<string, number>>({})
  /** Prompts waiting for the running turn to end; mirrored in queue for the UI. */
  /** Mirrors `inbox` so callbacks can read it without re-binding. */
  const inboxRef = useRef<Record<string, InboxItem[]>>({})
  const sentAtRef = useRef<Record<string, number>>({})

  const toast = useCallback((text: string, kind: "info" | "error" = "info") => {
    const id = toastSeq++
    setToasts((current) => [...current.slice(-3), { id, text, kind }])
    setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 5200)
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id))
  }, [])

  const refreshSessions = useCallback(async () => {
    try {
      const list = await window.ocd.api.sessions(directoryRef.current || undefined)
      setSessions(list)
      // Only a list that really arrived makes older tabs judgeable.
      sessionsFetchRef.current += 1
    } catch (err) {
      // The old list stays. Writing an empty one here is what makes a dead
      // connection look like deleted history: same screen, no way to tell, and
      // no word about why. The main process recovers the connection on its own,
      // so saying what failed is enough.
      toast(
        translate("toast.sessionsFailed", {
          error: err instanceof Error ? err.message : String(err),
        }),
        "error",
      )
    }
  }, [toast])

  const refreshCatalog = useCallback(async () => {
    const dir = directoryRef.current || undefined
    const [modelList, providerList, agentList, skillList, commandList, mcpList] = await Promise.all([
      window.ocd.api.models(dir).catch(() => [] as ModelInfo[]),
      window.ocd.api.providers(dir).catch(() => [] as ProviderInfo[]),
      window.ocd.api.agents().catch(() => [] as AgentInfo[]),
      window.ocd.api.skills().catch(() => [] as SkillInfo[]),
      window.ocd.api.commands().catch(() => [] as CommandInfo[]),
      window.ocd.api.mcp().catch(() => [] as McpServerInfo[]),
    ])
    setModels(modelList)
    setProviders(providerList)
    setAgents(agentList)
    setSkills(skillList)
    setCommands(commandList)
    setMcp(mcpList)
  }, [])

  const connect = useCallback(
    async (serverUrl?: string) => {
      try {
        const next = await window.ocd.service.connect(serverUrl)
        setStatus(next)
        if (next.connected) {
          await refreshCatalog()
          await refreshSessions()
        } else {
          toast(
            translate("toast.serverDown", {
              error: next.error ?? translate("toast.noResponse"),
            }),
            "error",
          )
        }
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "error")
      }
    },
    [refreshCatalog, refreshSessions, toast],
  )

  const restartService = useCallback(async () => {
    toast(translate("toast.restarting"))
    const next = await window.ocd.service.restart()
    setStatus(next)
    if (next.connected) {
      await refreshCatalog()
      await refreshSessions()
      toast(translate("toast.restarted"))
    } else {
      toast(translate("toast.restartFailed"), "error")
    }
  }, [refreshCatalog, refreshSessions, toast])

  const setDirectory = useCallback(
    async (dir: string) => {
      setDirectoryState(dir)
      directoryRef.current = dir
      await window.ocd.app.setSettings({ defaultDirectory: dir })
      setSettingsState(await window.ocd.app.getSettings())
      await refreshSessions()
      await refreshCatalog()
    },
    [refreshCatalog, refreshSessions],
  )

  const openSession = useCallback((sessionId: string) => {
    setTabs((current) =>
      current.some((tab) => tab.sessionId === sessionId)
        ? current
        : [...current, { sessionId, openedAt: sessionsFetchRef.current }],
    )
    setActiveTab(sessionId)
    activeTabRef.current = sessionId
  }, [])

  const closeTab = useCallback((sessionId: string) => {
    setTabs((current) => {
      const next = current.filter((tab) => tab.sessionId !== sessionId)
      if (activeTabRef.current === sessionId) {
        const fallback = next[next.length - 1]?.sessionId ?? null
        setActiveTab(fallback)
        activeTabRef.current = fallback
      }
      return next
    })
  }, [])

  const newSession = useCallback(async (): Promise<string | null> => {
    try {
      const settings = await window.ocd.app.getSettings()
      const created = await window.ocd.api.createSession({
        directory: directoryRef.current || undefined,
        // Pin the model: the server default can be region-locked.
        model: { providerID: settings.defaultProvider, id: settings.defaultModel },
      })
      openSession(created.id)
      await refreshSessions()
      return created.id
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error")
      return null
    }
  }, [openSession, refreshSessions, toast])

  const deleteSession = useCallback(
    async (sessionId: string) => {
      try {
        await window.ocd.api.deleteSession(sessionId)
        closeTab(sessionId)
        await refreshSessions()
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "error")
      }
    },
    [closeTab, refreshSessions, toast],
  )

  const renameSession = useCallback(
    async (sessionId: string, title: string) => {
      try {
        await window.ocd.api.renameSession(sessionId, title)
        await refreshSessions()
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "error")
      }
    },
    [refreshSessions, toast],
  )

  /**
   * What the server is holding for one conversation.
   *
   * Read at the moments it can change rather than on a timer: a conversation
   * is opened, a prompt is sent while another is running, a turn ends and the
   * server delivers what it had. Anything more frequent is a request per
   * second to redraw a list that has not moved.
   */
  const refreshInbox = useCallback(async (sessionId: string) => {
    try {
      const items = await window.ocd.inbox.list(sessionId)
      inboxRef.current = { ...inboxRef.current, [sessionId]: items }
      setInbox((current) => ({ ...current, [sessionId]: items }))
    } catch {
      /* a conversation with no reachable inbox simply shows no queue */
    }
  }, [])

  const send = useCallback(
    async (
      sessionId: string,
      text: string,
      agent?: string,
      files?: PromptFile[],
    ) => {
      const body = text.trim()
      const attachments = files ?? []
      if (!body && attachments.length === 0) return

      // A turn is already running. The server can take this message two ways:
      // fold it into the answer being written (steer), or hold it until that
      // answer ends (queue). Which one is meant is a question about intent, so
      // it is a setting rather than a guess — see `busySendMode`.
      if (busyRef.current[sessionId]) {
        // Neither branch falls through to the new-turn path below: that would
        // clear the live turn's text and restart its clock, replacing the very
        // answer this message is about to join. What differs is only where the
        // prompt waits, and that is the server's inbox either way.
        try {
          const delivery = settings?.busySendMode === "queue" ? "queue" : "steer"
          await window.ocd.api.prompt(sessionId, {
            text: body,
            agent: agent || undefined,
            files: attachments.length ? attachments : undefined,
            delivery,
          })
          if (delivery === "queue") {
            await refreshInbox(sessionId)
            toast(translate("queue.added", { n: (inboxRef.current[sessionId]?.length ?? 0) }), "info")
          } else {
            toast(translate("chat.steerNotice"), "info")
          }
        } catch (err) {
          toast(err instanceof Error ? err.message : String(err), "error")
        }
        return
      }
      setBusy((current) => ({ ...current, [sessionId]: true }))
      busyRef.current[sessionId] = true
      turnStartRef.current[sessionId] = Date.now()
      setTurnStart((current) => ({ ...current, [sessionId]: turnStartRef.current[sessionId] }))
      setLive((current) => ({
        ...current,
        [sessionId]: {
          messageId: "",
          text: "",
          reasoning: "",
          tools: [],
          startedAt: Date.now(),
        },
      }))
      try {
        await window.ocd.api.prompt(sessionId, {
          text: body,
          agent: agent || undefined,
          files: attachments.length ? attachments : undefined,
        })
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "error")
        setBusy((current) => ({ ...current, [sessionId]: false }))
        setLive((current) => {
          const next = { ...current }
          delete next[sessionId]
          return next
        })
      }
    },
    [settings?.busySendMode, refreshInbox, toast],
  )

  /**
   * Poll for permission requests the stream did not deliver.
   *
   * A modal that only reacts to permission.asked misses requests that were
   * raised before the window opened or while it was reconnecting, and a missed
   * request is indistinguishable from a hung turn. Cheap: the list is empty
   * almost always.
   */
  const pollPermissions = useCallback(async () => {
    try {
      const waiting = await window.ocd.permission.list()
      if (waiting.length) {
        setPendingPermissions((current) =>
          waiting.reduce(mergePermission, current),
        )
      }
    } catch {
      /* the server may not be connected yet */
    }
  }, [])

  const answerPermission = useCallback(
    async (request: PermissionRequest, decision: PermissionDecision, message?: string) => {
      setPendingPermissions((current) => current.filter((item) => item.id !== request.id))
      try {
        await window.ocd.permission.reply(request.sessionID, request.id, decision, message)
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "error")
        void pollPermissions()
      }
    },
    [toast, pollPermissions],
  )

  /**
   * Refresh the questions waiting on one session.
   *
   * The list replaces rather than merges: a form that was answered or dropped
   * is gone from the server, and keeping it on screen would leave a dead
   * question the user can click forever.
   */
  const pollForms = useCallback(async (sessionId: string) => {
    if (!sessionId) return
    try {
      const waiting = await window.ocd.form.list(sessionId)
      setForms((current) =>
        waiting.length ? { ...current, [sessionId]: waiting } : { ...current, [sessionId]: [] },
      )
    } catch {
      /* the server may not be connected yet */
    }
  }, [])

  /**
   * Answer a question the model asked.
   *
   * This is the only thing that releases the blocked turn — a plain prompt does
   * not settle the form, which is what made the app look stuck.
   */
  const answerForm = useCallback(
    async (sessionId: string, formId: string, answer: FormAnswer) => {
      setForms((current) => ({
        ...current,
        [sessionId]: (current[sessionId] ?? []).filter((item) => item.id !== formId),
      }))
      try {
        await window.ocd.form.reply(sessionId, formId, answer)
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "error")
        void pollForms(sessionId)
      }
    },
    [pollForms, toast],
  )

  /** Dismiss a question without answering, so the turn is not stuck on it. */
  const cancelForm = useCallback(
    async (sessionId: string, formId: string) => {
      setForms((current) => ({
        ...current,
        [sessionId]: (current[sessionId] ?? []).filter((item) => item.id !== formId),
      }))
      try {
        await window.ocd.form.cancel(sessionId, formId)
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "error")
        void pollForms(sessionId)
      }
    },
    [pollForms, toast],
  )

  /**
   * Drop one waiting prompt, then re-read what is left.
   *
   * The list is re-read rather than patched locally: the server owns the
   * order and may have delivered an item in the time the request took, and a
   * bar that disagreed with the queue it is describing is worse than a brief
   * round trip.
   */
  const cancelInbox = useCallback(
    async (sessionId: string, inboxId: string) => {
      try {
        await window.ocd.inbox.cancel(sessionId, inboxId)
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "error")
      }
      await refreshInbox(sessionId)
    },
    [refreshInbox, toast],
  )

  const clearInbox = useCallback(
    async (sessionId: string) => {
      const items = inboxRef.current[sessionId] ?? []
      // One at a time on purpose: the endpoint cancels a single item, and a
      // burst of parallel deletes would race each other's re-reads.
      for (const item of items) {
        try {
          await window.ocd.inbox.cancel(sessionId, item.id)
        } catch (err) {
          toast(err instanceof Error ? err.message : String(err), "error")
          break
        }
      }
      await refreshInbox(sessionId)
    },
    [refreshInbox, toast],
  )

  /**
   * Pull a waiting prompt into the turn that is already running.
   *
   * The server wakes its own loop for a steered item, so this is one request
   * rather than something that has to be timed from here.
   */
  const steerInbox = useCallback(
    async (sessionId: string, inboxId: string) => {
      try {
        await window.ocd.inbox.setDelivery(sessionId, inboxId, "steer")
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "error")
      }
      await refreshInbox(sessionId)
    },
    [refreshInbox, toast],
  )

  /**
   * Stop the running turn.
   *
   * `resume` is passed when there is something queued: the server then hands
   * the turn to the next prompt instead of leaving the session idle.
   *
   * The server answers `interrupted: false` when nothing was running. That is
   * also the only reliable signal that the local busy flag has gone stale —
   * a prompt the provider refused never produces the stream event that would
   * normally clear it, and without this the spinner runs forever.
   */
  const recordTurnTime = useCallback((sessionId: string) => {
    const started = turnStartRef.current[sessionId]
    // A turn stopped by hand is not a sample: its length says how long the
    // user waited before giving up, not how long the work takes.
    if (!started) return
    const ms = Date.now() - started
    if (ms < 1000) return
    delete turnStartRef.current[sessionId]
    setTurnStart((current) => {
      const next = { ...current }
      delete next[sessionId]
      return next
    })
    setTurnLog((current) => ({ ...current, [sessionId]: withTurnTime(current[sessionId], ms) }))
  }, [])

  const abort = useCallback(
    async (sessionId: string) => {
      // Resume only when something is actually waiting: it is what tells the
      // server to hand the turn straight on instead of parking the session.
      const resume = (inboxRef.current[sessionId]?.length ?? 0) > 0
      try {
        const result = await window.ocd.api.interrupt(sessionId, resume)
        if (!result?.interrupted) {
          setBusy((current) => (current[sessionId] ? { ...current, [sessionId]: false } : current))
          delete turnStartRef.current[sessionId]
          setTurnStart((current) => {
            const next = { ...current }
            delete next[sessionId]
            return next
          })
        }
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "error")
      }
    },
    [toast],
  )

  /**
   * Rewind the conversation and resend one of its prompts.
   *
   * The boundary is the message being edited: it and everything the model said
   * after it are dropped, so the new wording is answered against a history that
   * does not already contain the old answer.
   *
   * Refuses while the session is working. The server answers 409 in that case,
   * and stopping the turn to force it through would throw away work the user
   * did not ask to lose.
   */
  const editAndResend = useCallback(
    async (sessionId: string, messageId: string, text: string) => {
      if (busyRef.current[sessionId]) {
        toast(translate("edit.busyRefusal"), "error")
        return false
      }
      const body = text.trim()
      if (!body) return false
      try {
        await window.ocd.api.revert(sessionId, messageId)
      } catch (err) {
        // The server answers a working session with its own error envelope.
        // Passing that JSON to the user helps nobody, and the local flag is
        // only a guess — this is the authoritative check.
        const raw = err instanceof Error ? err.message : String(err)
        toast(/SessionBusyError|Session is busy/.test(raw) ? translate("edit.busyRefusal") : raw, "error")
        return false
      }
      // The history the user was looking at is gone; drop what is on screen so
      // the resent prompt does not land under messages that no longer exist.
      setLive((current) => {
        const next = { ...current }
        delete next[sessionId]
        return next
      })
      await send(sessionId, body, settings?.defaultAgent)
      return true
    },
    [send, settings, toast],
  )

  const updateSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      const next = await window.ocd.app.setSettings(patch as Record<string, unknown>)
      setSettingsState(next)
      // Apply immediately so the picker's change is visible without a restart.
      if (patch.uiLanguage !== undefined) setLanguage(next.uiLanguage)
      if (patch.alwaysOnTop !== undefined) {
        void window.ocd.app.setAlwaysOnTop(patch.alwaysOnTop)
      }
      if (patch.serverUrlOverride !== undefined) {
        void connect(patch.serverUrlOverride || undefined)
      }
    },
    [connect],
  )

  /** Switch the model of the open session and remember it as the default. */
  const setModel = useCallback(
    async (providerID: string, modelID: string, sessionId?: string | null) => {
      await updateSettings({ defaultProvider: providerID, defaultModel: modelID })
      void window.ocd.api.setDefaultModel({ providerID, id: modelID }).catch(() => {})
      if (!sessionId) return
      try {
        await window.ocd.api.setSessionModel(sessionId, { providerID, id: modelID })
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "error")
      }
    },
    [toast, updateSettings],
  )

  const clearDictationText = useCallback(() => setDictationText(null), [])

  /**
   * Safety net: a dropped execution event would otherwise leave the composer
   * stuck in the busy state with no way out.
   */
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now()
      const stale = Object.entries(sentAtRef.current).filter(
        ([sessionId, at]) => busyRef.current[sessionId] && now - at > BUSY_TIMEOUT_MS,
      )
      if (!stale.length) return
      for (const [sessionId] of stale) {
        busyRef.current[sessionId] = false
        delete sentAtRef.current[sessionId]
        setBusy((current) => ({ ...current, [sessionId]: false }))
        setLive((current) => {
          if (!current[sessionId]) return current
          const next = { ...current }
          delete next[sessionId]
          return next
        })
      }
      toast(translate("toast.turnStuck"), "error")
    }, 20_000)
    return () => clearInterval(timer)
  }, [toast])

  /**
   * Windows toast when a turn ends while the window is out of sight.
   *
   * Announced from the renderer rather than main because main cannot see which
   * conversation finished without asking every window, and the message has to
   * carry the session title anyway.
   */
  const notifyOutcome = useCallback(
    async (sessionId: string, failed: boolean) => {
      try {
        if (!settings?.notifyOnFinish) return

        const title =
          sessions.find((session) => session.id === sessionId)?.title ??
          translate("session.untitled")

        // Whether the window has the focus is not a reason to stay silent any
        // more, only a reason not to raise a toast. The corner card is small,
        // sits out of the way and takes nine seconds to disappear, so it is
        // worth showing even to the person reading the answer.
        await window.ocd.notify.finish({
          title,
          body: failed ? translate("notify.failed") : translate("notify.done"),
          failed,
          sessionId,
          focused: document.hasFocus() && !document.hidden,
        })
      } catch {
        // A refused notification must never surface as a chat error.
      }
    },
    [settings, sessions],
  )

  const startDictation = useCallback(async () => {
    try {
      const result = await window.ocd.voice.startDictation()
      if (!result.ok) toast(result.error ?? translate("toast.dictateFailed"), "error")
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error")
    }
  }, [toast])

  const stopDictation = useCallback(async () => {
    await window.ocd.voice.stopDictation().catch(() => undefined)
  }, [])

  const cancelDictation = useCallback(async () => {
    await window.ocd.voice.cancelDictation().catch(() => undefined)
  }, [])

  const speak = useCallback(
    async (text: string) => {
      if (!text.trim()) return
      try {
        const result = await window.ocd.voice.speak(text)
        if (!result.ok) toast(result.error ?? translate("toast.speakFailed"), "error")
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "error")
      }
    },
    [toast],
  )

  const stopSpeaking = useCallback(async () => {
    await window.ocd.voice.stopSpeaking().catch(() => undefined)
  }, [])

  // ---------- request limits ----------

  /**
   * Read the ledger for one model.
   *
   * The ledger lives in main and only changes when a request goes out or the
   * user edits a limit, so this is called at those moments and nowhere else —
   * a timer would mean a disk read per second to redraw a number that has not
   * moved.
   */
  const refreshLimits = useCallback(async (model: string) => {
    try {
      const snapshot = await window.ocd.limits.snapshot(model)
      setLimits((current) => ({ ...current, [model]: snapshot }))
    } catch {
      /* the meter is decoration; a failed read must not disturb the chat */
    }
  }, [])

  const setModelLimit = useCallback(
    async (model: string, win: LimitWindow, limit: number | null) => {
      try {
        const snapshot = await window.ocd.limits.set(model, win, limit)
        setLimits((current) => ({ ...current, [model]: snapshot }))
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "error")
      }
    },
    [toast],
  )

  const resetLimits = useCallback(
    async (model?: string) => {
      try {
        await window.ocd.limits.clear(model)
        if (model) {
          setLimits((current) => {
            const next = { ...current }
            delete next[model]
            return next
          })
        } else {
          setLimits({})
        }
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "error")
      }
    },
    [toast],
  )

  // ---------- server events ----------

  useEffect(() => {
    const offStatus = window.ocd.events.onStatus((payload) => {
      const next = payload as unknown as ServiceStatus
      setStatus(next)
      const url = next.url ?? null
      const moved = url !== serviceUrlRef.current
      serviceUrlRef.current = url
      if (next.connected && moved) {
        void refreshCatalog()
        void refreshSessions()
      }
    })

    const offEvent = window.ocd.events.onEvent((event: ServerEvent) => {
      const data = event.data ?? {}
      const sessionID = (data.sessionID as string | undefined) ?? undefined

      /** Patch the in-flight turn, creating it if the step event was missed. */
      const patchLive = (patch: (turn: LiveTurn) => LiveTurn) => {
        if (!sessionID) return
        setLive((current) => {
          const turn: LiveTurn = current[sessionID] ?? {
            messageId: String(data.assistantMessageID ?? ""),
            text: "",
            reasoning: "",
            tools: [],
            startedAt: Date.now(),
          }
          return { ...current, [sessionID]: patch(turn) }
        })
      }

      switch (event.type) {
        case "session.created":
        case "session.updated":
        case "session.deleted":
          void refreshSessions()
          break

        // Live spend. Confirmed against the real SSE stream: the counters are
        // cumulative for the session, so each update replaces rather than adds.
        case "session.usage.updated": {
          const info = data as { sessionID?: string }
          if (!sessionID && !info.sessionID) break
          const next = readUsage(data)
          setUsage((current) => ({ ...current, [sessionID ?? info.sessionID!]: next }))
          break
        }

        // The server stops and waits for an answer here. Without a prompt the turn
          // looks like it is still working, forever.
        case "permission.asked":
          if (isPermissionRequest(data)) {
            setPendingPermissions((current) => mergePermission(current, data))
          }
          break

        case "session.execution.started":
          if (sessionID) {
            busyRef.current[sessionID] = true
            setBusy((current) => ({ ...current, [sessionID]: true }))
            // A turn begun in another window, or after a reconnect, has no
            // local send to time from — this event is when the clock starts.
            if (!turnStartRef.current[sessionID]) {
              turnStartRef.current[sessionID] = Date.now()
              setTurnStart((current) => ({ ...current, [sessionID]: turnStartRef.current[sessionID] }))
            }
          }
          break

        case "session.step.started":
          // A new assistant message begins: start from a clean buffer.
          if (sessionID) {
            setLive((current) => ({
              ...current,
              [sessionID]: {
                messageId: String(data.assistantMessageID ?? ""),
                agent: data.agent as string | undefined,
                model: data.model as { providerID: string; id: string } | undefined,
                text: "",
                reasoning: "",
                tools: [],
                startedAt: Date.now(),
              },
            }))
          }
          // The step is one request, already counted in main: pull the tally.
          {
            const model = data.model as { providerID?: string; id?: string } | undefined
            if (model?.providerID && model.id) void refreshLimits(`${model.providerID}/${model.id}`)
          }
          break

        case "session.text.delta":
          // Cleaned on the way in, not on the way out: a NUL would otherwise
          // sit in the buffer, be re-appended on every redraw, and reach the
          // screen as a replacement glyph.
          patchLive((turn) => ({ ...turn, text: turn.text + cleanText(String(data.delta ?? "")) }))
          break

        case "session.text.ended":
          patchLive((turn) => {
            const full = typeof data.text === "string" ? data.text : ""
            // Deltas already carry the text; only adopt when they are missing.
            if (!full || full.length <= turn.text.length) return turn
            return { ...turn, text: full }
          })
          break

        case "session.reasoning.delta":
          patchLive((turn) => ({ ...turn, reasoning: turn.reasoning + String(data.delta ?? "") }))
          break

        case "session.reasoning.ended":
          patchLive((turn) => {
            const full = typeof data.text === "string" ? data.text : ""
            return full.length > turn.reasoning.length ? { ...turn, reasoning: full } : turn
          })
          break

        case "session.tool.input.started":
          patchLive((turn) => ({
            ...turn,
            tools: [
              ...turn.tools,
              {
                callID: String(data.id ?? ""),
                name: String(data.name ?? "tool"),
                status: "running",
              },
            ],
          }))
          break

        case "session.tool.called":
          patchLive((turn) => {
            const callID = String(data.id ?? "")
            if (turn.tools.some((tool) => tool.callID === callID)) return turn
            return {
              ...turn,
              tools: [
                ...turn.tools,
                { callID, name: String(data.name ?? "tool"), status: "running" },
              ],
            }
          })
          break

        case "session.tool.success":
        case "session.tool.error":
          patchLive((turn) => {
            const callID = String(data.id ?? "")
            const status: LiveTool["status"] =
              event.type === "session.tool.error" ? "error" : "completed"
            const output = Array.isArray(data.content)
              ? data.content
                  .map((part: { text?: string }) => part?.text ?? "")
                  .filter(Boolean)
                  .join("\n")
              : typeof data.error === "string"
                ? data.error
                : undefined
            return {
              ...turn,
              tools: turn.tools.map((tool) =>
                tool.callID === callID ? { ...tool, status, output } : tool,
              ),
            }
          })
          break

        case "session.execution.succeeded":
        case "session.execution.failed":
          if (sessionID) {
            busyRef.current[sessionID] = false
            setBusy((current) => ({ ...current, [sessionID]: false }))
            recordTurnTime(sessionID)
            // Drop the buffer so the persisted history becomes the only copy.
            setLive((current) => {
              if (!current[sessionID]) return current
              const next = { ...current }
              delete next[sessionID]
              return next
            })
            void refreshSessions()
            void notifyOutcome(sessionID, event.type === "session.execution.failed")

            // The server delivers anything it was holding as the turn ends, so
            // there is nothing to send from here — only to look at what is
            // still waiting, which is one round trip after the turn is over.
            void refreshInbox(sessionID)
          }
          break

        case "session.error":
          if (sessionID) {
            busyRef.current[sessionID] = false
            setBusy((current) => ({ ...current, [sessionID]: false }))
            setLive((current) => {
              const next = { ...current }
              delete next[sessionID]
              return next
            })
          }
          // A refusal may have started a cooldown for the model that refused.
          {
            const model = data.model as { providerID?: string; id?: string } | undefined
            if (model?.providerID && model.id) void refreshLimits(`${model.providerID}/${model.id}`)
          }
          break

        case "session.shell.started": {
          const shell = data.shell as { id?: string; command?: string } | undefined
          const id = shell?.id
          if (sessionID && id) {
            setShellRuns((current) => ({
              ...current,
              [sessionID]: [
                {
                  id,
                  command: shell?.command ?? "",
                  running: true,
                  output: "",
                  startedAt: Date.now(),
                },
                ...(current[sessionID] ?? []).slice(0, 19),
              ],
            }))
          }
          break
        }

        case "session.shell.ended": {
          const shell = data.shell as { id?: string; exit?: number } | undefined
          // The two events nest their payloads differently, so both spots are
          // read rather than trusting one shape.
          const result = (data.output ?? {}) as { output?: string }
          const text = typeof result.output === "string" ? result.output : ""
          if (sessionID && shell?.id) {
            setShellRuns((current) => {
              const runs = current[sessionID] ?? []
              const index = runs.findIndex((run) => run.id === shell.id)
              if (index < 0) return current
              const next = runs.slice()
              const existing = next[index]
              // Live text wins: an ended event can carry less than what already
              // streamed, and truncating the output would be worse than keeping it.
              const merged = text.length > existing.output.length ? text : existing.output
              next[index] = { ...existing, running: false, output: merged, exit: shell.exit }
              return { ...current, [sessionID]: next }
            })
          }
          break
        }

        case "model.updated":
        case "provider.updated":
          void refreshCatalog()
          break

        default:
          break
      }
    })

    return () => {
      offStatus()
      offEvent()
    }
    // `notifyOutcome` is deliberately absent. It closes over `settings` and
    // `sessions`, so listing it would tear down and rebuild the event stream
    // every time the session list changed — mid-turn, and while events are in
    // flight. It reads both through refs instead, which is why an older copy
    // stays correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordTurnTime, refreshCatalog, refreshSessions, refreshLimits, refreshInbox])

  // ---------- boot ----------

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const loaded = await window.ocd.app.getSettings()
      if (cancelled) return
      setSettingsState(loaded)
      setLanguage(loaded.uiLanguage)

      // Keep the managed reply-language instruction in step with the setting,
      // but only write when it actually drifted (avoids touching the file
      // on every launch).
      const wantedLang = loaded.replyLanguage ?? "ru"
      const langInConfig = await window.ocd.configFile.replyLanguage().catch(() => "auto" as const)
      // Two ways to be out of date: the wrong language, and the right language
      // in wording OCD no longer ships. Checking the language alone meant an
      // instruction reworded in a new build stayed on disk forever.
      const contentCurrent = await window.ocd.configFile
        .languageCurrent(wantedLang)
        .catch(() => false)
      if (langInConfig !== wantedLang || !contentCurrent) {
        const applied = await window.ocd.configFile.setReplyLanguage(wantedLang).catch(() => null)
        if (applied && !applied.ok) toast(applied.error ?? translate("toast.configFailed"), "error")
      }

      const initialDirectory = loaded.defaultDirectory || ""
      setDirectoryState(initialDirectory)
      directoryRef.current = initialDirectory

      const current = await window.ocd.service.status()
      if (cancelled) return
      setStatus(current)

      if (current.connected) {
        await refreshCatalog()
        await refreshSessions()
      } else {
        await connect(loaded.serverUrlOverride || undefined)
      }
    })()
    return () => {
      cancelled = true
    }
    // `toast` has no dependencies of its own, so listing it changes nothing
    // about when this runs.
  }, [connect, refreshCatalog, refreshSessions, toast])

  // Persist the working set of tabs on every change.
  useEffect(() => {
    writePersistedTabs(
      tabs.map((tab) => tab.sessionId),
      activeTab,
    )
  }, [tabs, activeTab])

  // The inbox belongs to the server, so there is nothing to persist here: what
  // a restart has to show is read back from the conversation itself.
  useEffect(() => {
    if (activeTab) void refreshInbox(activeTab)
  }, [activeTab, refreshInbox])

  /**
   * Drop tabs whose session no longer exists. Until the list arrives the stored
   * set is left alone — pruning early would empty it for every user whose
   * first load has not reached the server yet.
   *
   * A tab is judged only by a list fetched after it was opened. The "+" button
   * creates a session, opens a tab for it and *then* asks for the session list;
   * between those two steps the list in hand is one that cannot mention the new
   * session, and pruning against it deleted the tab the moment it appeared.
   */
  useEffect(() => {
    if (sessions.length === 0) return
    const alive = new Set(sessions.map((session) => session.id))
    const kept = pruneTabs(tabs, alive, sessionsFetchRef.current)
    if (kept.length === tabs.length) return
    // Computed from the ref rather than a state updater: an updater must stay
    // pure, and the ref already tracks every move between tabs.
    const nextActive = nextActiveTab(kept, activeTabRef.current)
    activeTabRef.current = nextActive
    setTabs(kept)
    setActiveTab(nextActive)
  }, [sessions, tabs])

  /**
 * Safety net for permission requests.
 *
 * Two jobs: catch anything raised before this window existed, and notice when
 * a turn has been "working" far longer than any of these models plausibly
 * needs — which, given what the server does while it waits for an answer, is
 * the visible symptom of a missed prompt.
 */
  /**
   * The second hand for every timer in the app.
   *
   * Only runs while something is working: an idle window should not wake up
   * once a second to redraw a counter nobody is looking at.
   */
  useEffect(() => {
    if (!Object.values(busy).some(Boolean)) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [busy])

  // Persisting from an effect rather than from the state updater: an updater
  // must stay pure, and React is free to call it more than once.
  useEffect(() => {
    writeTurnLog(turnLog)
  }, [turnLog])

useEffect(() => {
  void pollPermissions()
  const timer = setInterval(() => void pollPermissions(), 4000)
  return () => clearInterval(timer)
}, [pollPermissions, status?.connected])

  /**
   * Questions the model asked, polled per open conversation.
   *
   * The stream has no event for a form being created or settled, so without
   * this a question asked while the window was closed is invisible — the turn
   * simply never finishes. Polling only the open tabs keeps it to a handful of
   * cheap requests.
   */
  useEffect(() => {
    const open = tabs.map((tab) => tab.sessionId).filter((id): id is string => Boolean(id))
    if (!open.length) return
    for (const sessionId of open) void pollForms(sessionId)
    const timer = setInterval(() => {
      for (const sessionId of open) void pollForms(sessionId)
    }, 4000)
    return () => clearInterval(timer)
  }, [pollForms, tabs, status?.connected])

// ---------- voice ----------

  useEffect(() => {
    const offState = window.ocd.voice.onState((state) => {
      if (state.error) toast(state.error, "error")
      setDictation(state.dictation)
    })
    const offResult = window.ocd.voice.onResult((result) => {
      if (!result.ok) {
        if (result.error && result.error !== "cancelled") toast(result.error, "error")
        return
      }
      const text = (result.text ?? "").trim()
      if (text) setDictationText(text)
    })
    return () => {
      offState()
      offResult()
    }
  }, [toast])

  // Theme + font scale are applied to the document root.
  useEffect(() => {
    if (!settings) return
    const root = document.documentElement
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
    const theme =
      settings.theme === "auto" ? (prefersDark ? "dark" : "light") : settings.theme
    root.dataset.theme = theme
    root.style.setProperty("--font-scale", String(settings.fontScale))
    root.style.setProperty("--accent", settings.accentColor)
    root.style.setProperty("--acrylic", String(settings.acrylicOpacity))
    root.style.setProperty("--tint", hexToTriplet(settings.acrylicTint))
    // Contrast follows the tint itself, so any tint/theme combination stays readable.
    const dark = luminance(settings.acrylicTint) < 0.45
    root.style.setProperty("--text", dark ? "#f3f3f3" : "#1a1a1a")
    root.style.setProperty("--text-dim", dark ? "#c8c8c8" : "#43474e")
    root.style.setProperty("--text-faint", dark ? "#9a9a9a" : "#6e7480")
    root.style.setProperty(
      "--line",
      dark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)",
    )
    root.style.setProperty(
      "--line-strong",
      dark ? "rgba(255,255,255,0.20)" : "rgba(0,0,0,0.16)",
    )
    document.body.classList.toggle("no-blur", !settings.blurBehind)
  }, [settings])

  const value = useMemo<Store>(
    () => ({
      status,
      settings,
      directory,
      sessions,
      tabs,
      activeTab,
      busy,
      turnStart,
      turnLog,
      now,
      usage,
      limits,
      refreshLimits,
      setModelLimit,
      resetLimits,
      inbox,
      refreshInbox,
      cancelInbox,
      clearInbox,
      steerInbox,
      pendingPermissions,
      pollPermissions,
      answerPermission,
      forms,
      shellRuns,
      pollForms,
      answerForm,
      cancelForm,
      live,
      models,
      providers,
      agents,
      skills,
      commands,
      mcp,
      toasts,
      dictation,
      dictationText,
      clearDictationText,
      startDictation,
      stopDictation,
      cancelDictation,
      speak,
      stopSpeaking,
      connect,
      restartService,
      setDirectory,
      refreshSessions,
      newSession,
      openSession,
      closeTab,
      deleteSession,
      renameSession,
      refreshCatalog,
      send,
      setModel,
      editAndResend,
      abort,
      updateSettings,
      toast,
      dismissToast,
    }),
    [
      status,
      settings,
      directory,
      sessions,
      turnStart,
      turnLog,
      now,
      tabs,
      activeTab,
      busy,
      usage,
      limits,
      refreshLimits,
      setModelLimit,
      resetLimits,
      shellRuns,
      forms,
      live,
      models,
      providers,
      agents,
      skills,
      commands,
      mcp,
      toasts,
      dictation,
      dictationText,
      clearDictationText,
      startDictation,
      stopDictation,
      cancelDictation,
      speak,
      stopSpeaking,
      connect,
      restartService,
      setDirectory,
      refreshSessions,
      newSession,
      openSession,
      closeTab,
      deleteSession,
      renameSession,
      refreshCatalog,
      send,
      setModel,
      editAndResend,
      abort,
      updateSettings,
      toast,
      dismissToast,
      // These are read out of the context by name, so leaving them out of the
      // dependency list does not merely skip a recompute — it pins the value.
      // `inbox` was the sharp one: a prompt waiting during a long tool call
      // changes nothing else on this list, so the memo returned the previous
      // object and the queue bar did not appear until the next stream tick.
      inbox,
      refreshInbox,
      answerForm,
      answerPermission,
      cancelForm,
      clearInbox,
      cancelInbox,
      steerInbox,
      pendingPermissions,
      pollForms,
      pollPermissions,
    ],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}











