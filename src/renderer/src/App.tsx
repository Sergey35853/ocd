import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { SearchHit } from "@shared/types"
import { StoreProvider, useStore } from "./lib/store"
import { addTag, readTags, useAllTags, useSessionTags } from "./lib/tags"
import { cx, groupSessions, shortAge } from "./lib/format"
import { actionFor } from "./lib/shortcuts"
import { askChat } from "./lib/commands"
import { ToastStack } from "./components/ui"
import { PermissionPrompt } from "./components/PermissionPrompt"
import { SessionCompare } from "./components/SessionCompare"
import { ArenaView } from "./components/ArenaView"
import { CommandPalette, type Command } from "./components/CommandPalette"
import { installClipboardBridge } from "./lib/messageMove"
import {
  IconChat,
  IconChip,
  IconCheck,
  IconClose,
  IconDownload,
  IconFolder,
  IconGear,
  IconInfo,
  IconFile,
  IconLayers,
  IconMaximize,
  IconMenu,
  IconMinimize,
  IconPlus,
  IconPuzzle,
  IconRefresh,
  IconSearch,
  IconSpark,
} from "./components/Icon"
import { TypingIndicator } from "./components/TypingIndicator"
import { ChatView } from "./views/ChatView"
import { BusyAnimation } from "./components/BusyAnimation"
import { TurnTimer } from "./components/TurnTimer"
import { PluginsView } from "./views/PluginsView"
import { ProvidersView } from "./views/ProvidersView"
import { CapabilitiesView } from "./views/CapabilitiesView"
import { SettingsView } from "./views/SettingsView"
import { AboutView } from "./views/AboutView"
import { FilesView } from "./views/FilesView"
import { LogView } from "./views/LogView"
import { useT, type DictKey } from "./i18n"

type ViewId =
  | "chat"
  | "files"
  | "capabilities"
  | "plugins"
  | "providers"
  | "settings"
  | "about"
  | "log"

const VIEWS: ViewId[] = [
  "chat",
  "files",
  "capabilities",
  "plugins",
  "providers",
  "settings",
  "about",
]

const VIEW_KEY = "ocd.view.v1"

/**
 * A session window is the same bundle pointed at `#session/<id>`, so the chat
 * is the only sensible view there regardless of what the last window was on.
 */
function sessionFromHash(): string | null {
  const hash = window.location.hash.replace("#", "").trim()
  const match = /^session\/(.+)$/.exec(hash)
  return match ? match[1] : null
}

/** #settings / #plugins lets a view be opened directly (also handy for debugging). */
function initialView(): ViewId {
  if (sessionFromHash()) return "chat"
  const hash = window.location.hash.replace("#", "").trim()
  if ((VIEWS as string[]).includes(hash)) return hash as ViewId
  try {
    const stored = localStorage.getItem(VIEW_KEY)
    if (stored && (VIEWS as string[]).includes(stored)) return stored as ViewId
  } catch {
    /* storage unavailable: fall back to the chat */
  }
  return "chat"
}

const NAV: Array<{ id: ViewId; label: DictKey; icon: typeof IconChat; kbd?: string }> = [
  { id: "chat", label: "nav.newSession", icon: IconPlus, kbd: "Ctrl+N" },
  { id: "files", label: "nav.files", icon: IconFolder },
  { id: "capabilities", label: "nav.capabilities", icon: IconSpark },
  { id: "plugins", label: "nav.plugins", icon: IconPuzzle },
  { id: "providers", label: "nav.providers", icon: IconChip },
  { id: "settings", label: "nav.settings", icon: IconGear },
  { id: "about", label: "nav.about", icon: IconInfo },
  { id: "log", label: "nav.log", icon: IconFile },
]

/** The tags of a conversation as small chips; nothing when it has none. */
function TagChips({ sessionId }: { sessionId: string }) {
  const tags = useSessionTags(sessionId)
  if (!tags.length) return null
  // Three is as many as fit on a row without pushing the age off the edge; the
  // rest are counted, because a chip that says "+2" is better than a hidden one.
  const shown = tags.slice(0, 3)
  return (
    <span className="sess-tags">
      {shown.map((tag) => (
        <span key={tag} className="sess-tag">
          {tag}
        </span>
      ))}
      {tags.length > shown.length ? (
        <span className="sess-tag more">+{tags.length - shown.length}</span>
      ) : null}
    </span>
  )
}

function Shell() {
  const store = useStore()

  /**
   * The store, in a ref.
   *
   * The store is a new object on every tick of a running turn, so an effect
   * that depends on it starts over — and asks the server for everything
   * again — once a second, for as long as the model writes. The ref holds the
   * same store without making that a reason to start over.
   */
  const storeRef = useRef(store)
  storeRef.current = store

  /**
   * The header's update button.
   *
   * Polled rather than pushed: this only decides whether a button is on screen,
   * so a check that lands a moment after the window opens costs nothing. The
   * focus refresh is what makes it appear promptly while the app has been
   * sitting open in the background.
   */
  const [update, setUpdate] = useState<{
    available: boolean
    version: string
    staged: boolean
  } | null>(null)
  const [updating, setUpdating] = useState(false)

  const refreshUpdate = useCallback(() => {
    void window.ocd.app
      .updateState()
      .then(setUpdate)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    refreshUpdate()
    const timer = window.setInterval(refreshUpdate, 60_000)
    window.addEventListener("focus", refreshUpdate)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("focus", refreshUpdate)
    }
  }, [refreshUpdate])

  // Pushed by main the moment the state changes, so the arrow does not wait out
  // the poll above. The poll stays as the floor under a window that was open
  // when an update arrived and closed before the next one did.
  useEffect(() => window.ocd.events.onUpdate(setUpdate), [])

  /**
   * One line in the log per version, the first time the arrow shows.
   *
   * Whether the header actually shows it is the one part of updating that
   * cannot be checked from outside the app, and "the arrow never appeared" was
   * unanswerable from the log alone.
   */
  const announcedUpdate = useRef("")
  useEffect(() => {
    if (!update?.available || announcedUpdate.current === update.version) return
    announcedUpdate.current = update.version
    void window.ocd.diag.report({
      kind: "update",
      message: `update arrow shown: ${update.version}`,
    })
  }, [update])

  /** One click does the whole job: fetch, then install and restart. */
  const startUpdate = async () => {
    setUpdating(true)
    try {
      if (!update?.staged) {
        const fetched = await window.ocd.app.downloadUpdate()
        if (!fetched.ok) {
          store.toast(fetched.message, "error")
          refreshUpdate()
          return
        }
      }
      const installed = await window.ocd.app.installUpdate()
      if (!installed.ok) store.toast(installed.message, "error")
    } finally {
      setUpdating(false)
    }
  }
  const t = useT()
  const [view, setView] = useState<ViewId>(initialView)
  const [query, setQuery] = useState("")
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [navOpen, setNavOpen] = useState(false)
  /** The sessions search box, so a key can put the caret into it. */
  const searchRef = useRef<HTMLInputElement>(null)
  // Full-text results. Separate from `query`: titles filter instantly while
  // the body index is consulted in the background, so typing never waits.
  const [searchHits, setSearchHits] = useState<SearchHit[]>([])
  const [searchPending, setSearchPending] = useState(false)
  /**
   * What the reader is narrowing the results by.
   *
   * The index holds every conversation on the machine, so a search for a
   * common word answers with dozens of hits. The filters are the difference
   * between "here are forty conversations" and "here are the three of last
   * Tuesday that ran on that model".
   */
  const [modelFilter, setModelFilter] = useState("")
  const [projectFilter, setProjectFilter] = useState("")
  const [dateFilter, setDateFilter] = useState("")
  /** Narrow the list to conversations carrying this tag; "" means any. */
  const [tagFilter, setTagFilter] = useState("")
  /** Selection mode for acting on many conversations at once. */
  const [bulkMode, setBulkMode] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  /** Every tag in use, kept in step with the tag store. */
  const knownTags = useAllTags()
  const [indexReady, setIndexReady] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  /** The comparison of two conversations, when it is open. */
  const [compareOpen, setCompareOpen] = useState(false)
  const [arenaOpen, setArenaOpen] = useState(false)
  // Focus mode hides both the sidebar and the tab strip so the chat owns the window.
  const [expanded, setExpanded] = useState(false)

  /**
   * The busy effect, sized for a tab.
   *
   * A tab is a fraction of the chat pane, so the glyph pitch is halved and the
   * opacity pulled back: the title has to stay the thing you read.
   */
  const tabAnim = useMemo(() => {
    const base = store.settings?.busyAnimation ?? {
      kind: "matrix" as const,
      opacity: 0.22,
      speed: 1,
      hue: 145,
      density: 16,
    }
    return {
      ...base,
      density: Math.max(8, Math.round(base.density / 2)),
      opacity: Math.min(base.opacity, 0.3),
    }
  }, [store.settings?.busyAnimation])

  /** Leave a leaf view and go back to the conversation list. */
  const goChat = useCallback(() => setView("chat"), [])

  const activeSession = useMemo(
    () => store.sessions.find((session) => session.id === store.activeTab) ?? null,
    [store.sessions, store.activeTab],
  )

  // Remember the view so closing on Providers reopens there, not on the chat.
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view)
    } catch {
      /* storage unavailable: the view simply resets on launch */
    }
  }, [view])

  /**
   * The sessions list is a drawer in a narrow window, not a column beside the
   * chat.
   *
   * Two things follow from that and neither is a styling detail. It must start
   * closed, or the app opens onto the list and hides the conversation it was
   * opened for; and it must close itself once a conversation is picked, or the
   * user has to find the hamburger again to read what they just tapped.
   *
   * Asked of `matchMedia` rather than of the window width so the answer follows
   * a resize instead of being frozen at the first render.
   */
  const narrow = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 820px)").matches,
    [],
  )

  useEffect(() => {
    if (narrow) setSidebarOpen(false)
  }, [narrow])

  const pickSession = useCallback(
    (sessionId: string) => {
      storeRef.current.openSession(sessionId)
      if (narrow) setSidebarOpen(false)
    },
    [narrow],
  )

  /**
   * Open the conversation and bring the matched message into view.
   *
   * Opening the conversation is not enough: the reader asked where something
   * is, and the end of a long conversation is not where it is. The message
   * itself is what the search found, so that is what the window scrolls to.
   */
  const openHit = useCallback((hit: SearchHit) => {
    storeRef.current.openSession(hit.sessionId)
    if (hit.messageId) storeRef.current.jumpToMessage(hit.sessionId, hit.messageId)
    if (narrow) setSidebarOpen(false)
  }, [narrow])

  /**
   * Build the index again from scratch.
   *
   * The index is a cache of what the server said; when a conversation changed
   * while the app was closed, the cache is behind. Rebuilding it by hand is
   * the way out of a search that does not know about a conversation.
   */
  const reindex = useCallback(() => {
    setIndexReady(false)
    setSearchPending(true)
    void window.ocd.search
      .build(true)
      .then(() => setIndexReady(true))
      .catch(() => undefined)
      .finally(() => setSearchPending(false))
  }, [])

  /**
   * What there is to narrow by.
   *
   * The models and the projects come from the sessions themselves: the server
   * knows which model a conversation ran on and which folder it ran in, and
   * the list of things to filter by is exactly the list of things that have
   * been used.
   */
  const filterOptions = useMemo(() => {
    const models = new Set<string>()
    const projects = new Set<string>()
    for (const session of store.sessions) {
      if (session.model?.id) models.add(`${session.model.providerID ?? ""}/${session.model.id}`)
      const project = session.location?.directory ?? session.projectID ?? ""
      if (project) projects.add(project)
    }
    return { models: [...models].sort(), projects: [...projects].sort() }
  }, [store.sessions])

  /**
   * The hits that survive the filters.
   *
   * The filters are read off the session, not off the hit: the index holds
   * the words of a conversation, and which model and which project it belongs
   * to is the session's own business.
   */
  const visibleHits = useMemo(() => {
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    return searchHits.filter((hit) => {
      if (dateFilter) {
        const age = now - (hit.updated || 0)
        if (dateFilter === "today" && age > day) return false
        if (dateFilter === "week" && age > 7 * day) return false
        if (dateFilter === "month" && age > 30 * day) return false
      }
      if (!modelFilter && !projectFilter && !tagFilter) return true
      const session = store.sessions.find((item) => item.id === hit.sessionId)
      if (!session) return false
      if (tagFilter) {
        const tags = readTags(session.id)
        if (!tags.includes(tagFilter)) return false
      }
      if (modelFilter) {
        const model = session.model?.id
          ? `${session.model.providerID ?? ""}/${session.model.id}`
          : ""
        if (model !== modelFilter) return false
      }
      if (projectFilter) {
        const project = session.location?.directory ?? session.projectID ?? ""
        if (project !== projectFilter) return false
      }
      return true
    })
  }, [searchHits, store.sessions, modelFilter, projectFilter, dateFilter, tagFilter])

  const filteredSessions = useMemo(() => {
    const needle = query.trim().toLowerCase()
    // Sessions already listed above as a body match are not repeated below.
    const shown = new Set(visibleHits.map((hit) => hit.sessionId))
    const byTag = (session: { id: string }) => !tagFilter || readTags(session.id).includes(tagFilter)
    const list = store.sessions.filter(
      (session) =>
        !shown.has(session.id) &&
        byTag(session) &&
        (!needle || `${session.title ?? ""} ${session.id}`.toLowerCase().includes(needle)),
    )
    return groupSessions(list)
  }, [store.sessions, query, visibleHits, tagFilter])

  // Build the body index once the session list is on screen, then keep it
  // fresh in the background. Failures are silent: search simply falls back to
  // matching titles, which is what the box did before.
  useEffect(() => {
    if (indexReady || store.sessions.length === 0) return
    let cancelled = false
    setSearchPending(true)
    void window.ocd.search
      .build()
      .then(() => {
        if (!cancelled) setIndexReady(true)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setSearchPending(false)
      })
    return () => {
      cancelled = true
    }
  }, [indexReady, store.sessions.length])

  // Debounced so a fast typist triggers one query, not one per keystroke.
  useEffect(() => {
    const needle = query.trim()
    if (!indexReady || needle.length < 2) {
      setSearchHits([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void window.ocd.search
        .query(needle, store.sessions)
        .then((hits) => {
          if (!cancelled) setSearchHits(hits)
        })
        .catch(() => {
          if (!cancelled) setSearchHits([])
        })
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, indexReady, store.sessions])

  // Every entry point must land on the chat, otherwise creating a session
  // looks like nothing happened when another view was open.
  const createAndOpen = useCallback(async () => {
    const id = await storeRef.current.newSession()
    if (id) setView("chat")
  }, [])

  // ---- acting on many conversations at once ----
  /** Second click on Delete, so a bulk remove is never one stray press. */
  const [bulkConfirm, setBulkConfirm] = useState(false)
  const [bulkTagDraft, setBulkTagDraft] = useState("")

  const toggleSelect = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const exitBulk = useCallback(() => {
    setBulkMode(false)
    setSelected(new Set())
    setBulkConfirm(false)
    setBulkTagDraft("")
  }, [])

  /** Everything currently on screen, for "select all". */
  const selectAllVisible = useCallback(() => {
    const ids = new Set<string>()
    for (const group of filteredSessions) for (const item of group.items) ids.add(item.id)
    for (const hit of visibleHits) ids.add(hit.sessionId)
    setSelected(ids)
  }, [filteredSessions, visibleHits])

  const bulkDelete = useCallback(async () => {
    const ids = [...selected]
    if (!ids.length) return
    if (!bulkConfirm) {
      setBulkConfirm(true)
      return
    }
    for (const id of ids) await storeRef.current.deleteSession(id)
    storeRef.current.toast(t("bulk.deleted", { n: ids.length }), "info")
    exitBulk()
  }, [selected, bulkConfirm, exitBulk, t])

  const bulkMove = useCallback(async () => {
    const ids = [...selected]
    if (!ids.length) return
    const directory = await window.ocd.app.pickDirectory()
    if (!directory) return
    for (const id of ids) await storeRef.current.moveSession(id, directory)
    exitBulk()
  }, [selected, exitBulk])

  const applyBulkTag = useCallback(() => {
    const tag = bulkTagDraft.trim()
    const ids = [...selected]
    if (!tag || !ids.length) return
    for (const id of ids) addTag(id, tag)
    setBulkTagDraft("")
  }, [selected, bulkTagDraft])

  const stripRef = useRef<HTMLDivElement>(null)

  /**
   * Keep the working tab in sight, and say how many tabs there are.
   *
   * The strip scrolls rather than clips now, which means a tab opened past the
   * edge is reachable — but only if it is scrolled to. The count goes to the log
   * because "the + did nothing" and "the + worked and the tab was off-screen"
   * look identical from the outside, and guessing between them wastes a build.
   */
  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    strip.querySelector<HTMLElement>(".tab.active")?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    })
    void window.ocd.diag.report({
      kind: "tabs",
      message: `${store.tabs.length} tab(s), active ${store.activeTab ?? "none"}`,
    })
  }, [store.tabs, store.activeTab])

  // Ctrl+N creates a session and jumps to the chat.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setQuery("")
        setNavOpen(false)
        // Escape walks out of a leaf view, which is what the menu hint promises.
        if (view !== "chat") goChat()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [goChat, view])

  // Publish what this window is doing for the HUD. Main reads it with
  // executeJavaScript, so it has to sit on `window` in the page's own world —
  // nothing behind the context bridge is reachable from there.
  useEffect(() => {
    const busy = Object.keys(store.busy)
      .filter((id) => Boolean(store.busy[id]))
      .map((id) => {
        const session = store.sessions.find((item) => item.id === id)
        return { id, title: session?.title ?? id }
      })

    ;(window as unknown as { __ocdHud?: unknown }).__ocdHud = { busy }
  }, [store.busy, store.sessions])

  // Push a fresh snapshot whenever the HUD might be watching.
  useEffect(() => {
    const timer = setInterval(() => void window.ocd.hud.request(), 1500)
    return () => clearInterval(timer)
  }, [])

  /**
   * The bridge between the "copy to another conversation" button and the
   * composer of that conversation.
   *
   * Put in place here, where the window is assembled: the button lives in the
   * chat and the composer lives in another one, and neither of them is on
   * screen while the other is.
   */
  useEffect(() => {
    installClipboardBridge()
  }, [])

  /**
   * The conversation this window was opened for.
   *
   * Read from the hash and kept: the hash of a session window does not
   * change, and the effect that opens it must not run again because the
   * store did.
   */
  const [hashSession, setHashSession] = useState(sessionFromHash)
  useEffect(() => {
    const onHash = () => setHashSession(sessionFromHash())
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])

  // A window opened for one conversation should show exactly that one.
  //
  // Only the conversation of the hash is a dependency: the effect used to
  // depend on the whole store, so it ran again on every tick of a running
  // turn and opened the wanted conversation over the one the user had just
  // picked.
  useEffect(() => {
    if (!hashSession) return
    if (storeRef.current.activeTab === hashSession) return
    void storeRef.current.openSession(hashSession)
  }, [hashSession])

  // Tray entries and the tray language switch arrive as commands.
  useEffect(() => {
    return window.ocd.app.onCommand((command) => {
      if (command.kind === "open-session" && command.sessionId) {
        setView("chat")
        void storeRef.current.openSession(command.sessionId)
        return
      }
      if (command.kind === "set-language" && command.language) {
        void storeRef.current.updateSettings({ uiLanguage: command.language as never })
      }
    })
  }, [])

  // Keep the tray menu in step with what the app is doing. Pushed rather than
  // pulled: main has no session list of its own and should not ask for one.
  useEffect(() => {
    void window.ocd.app.trayState({
      recent: store.sessions.slice(0, 10).map((session) => ({
        id: session.id,
        title: session.title ?? "",
      })),
      connected: Boolean(store.status?.connected),
      language: store.settings?.uiLanguage,
    })
  }, [store.sessions, store.status?.connected, store.settings?.uiLanguage])

  // Dismiss the nav popup on any outside interaction.
  useEffect(() => {
    if (!navOpen) return
    const close = (event: PointerEvent) => {
      // Ignore presses inside the popup, including the toggle itself.
      const target = event.target as HTMLElement | null
      if (target?.closest(".navwrap")) return
      setNavOpen(false)
    }
    window.addEventListener("pointerdown", close)
    return () => window.removeEventListener("pointerdown", close)
  }, [navOpen])

  const isConnected = Boolean(store.status?.connected)

  /**
   * The keys the app answers to.
   *
   * One handler for all of them, and the combinations belong to the user: the
   * settings screen can hand any action another key. The handler is here
   * rather than in the chat, so a key works from every screen.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      // A field that is being typed into keeps its own keys: Ctrl+F in a
      // search box should not be taken away from the browser's own meaning.
      const typing =
        target instanceof HTMLElement
          ? target.closest("input, textarea, [contenteditable]")
          : null
      const action = actionFor(event, storeRef.current.settings?.shortcuts)
      if (!action) return
      if (typing && action !== "palette" && action !== "search") return
      event.preventDefault()
      switch (action) {
        case "palette":
          setPaletteOpen((value) => !value)
          break
        case "newSession":
          void createAndOpen()
          break
        case "search":
          setSidebarOpen(true)
          searchRef.current?.focus()
          break
        case "closeTab":
          if (storeRef.current.activeTab) void storeRef.current.closeTab(storeRef.current.activeTab)
          break
        case "nextTab":
        case "prevTab": {
          const tabs = storeRef.current.tabs
          if (!tabs.length) break
          const index = tabs.findIndex((tab) => tab.sessionId === storeRef.current.activeTab)
          const step = action === "nextTab" ? 1 : -1
          const next = tabs[(index + step + tabs.length) % tabs.length]
          if (next) storeRef.current.openSession(next.sessionId)
          break
        }
        case "settings":
          setView("settings")
          break
        case "sidebar":
          setSidebarOpen((value) => !value)
          break
        case "log":
          setView("log")
          break
        default:
          // The rest belong to the chat and are handled there.
          break
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [createAndOpen])

  const commands = useMemo<Command[]>(
    () => [
      { id: "new", label: t("nav.newSession"), keywords: "создать новая сессия create", group: "nav", run: () => void createAndOpen() },
      { id: "view:chat", label: t("palette.backToChat"), keywords: "беседы чат chat", group: "nav", run: goChat },
      { id: "view:files", label: t("nav.files"), keywords: "файлы дерево проекта files tree project", group: "nav", run: () => setView("files") },
      { id: "view:capabilities", label: t("nav.capabilities"), keywords: "возможности агенты", group: "nav", run: () => setView("capabilities") },
      { id: "view:plugins", label: t("nav.plugins"), keywords: "плагины расширения", group: "nav", run: () => setView("plugins") },
      { id: "view:providers", label: t("nav.providers"), keywords: "провайдеры модели", group: "nav", run: () => setView("providers") },
      { id: "view:settings", label: t("nav.settings"), keywords: "настройки опции", group: "nav", run: () => setView("settings") },
      { id: "view:about", label: t("nav.about"), keywords: "о программе версия обновление about version", group: "nav", run: () => setView("about") },
      { id: "view:log", label: t("nav.log"), keywords: "журнал лог ошибки log errors", group: "app", run: () => setView("log") },
      { id: "cmp", label: t("cmp.title"), keywords: "сравнить беседы разница compare diff", group: "app", run: () => setCompareOpen(true) },
      { id: "arena", label: t("arena.title"), keywords: "арена модель модель сравнить ответы arena models", group: "app", run: () => setArenaOpen(true) },
      { id: "hud", label: t("set.hudToggle"), keywords: "панель индикатор hud", group: "app", run: () => void window.ocd.hud.toggle() },
      { id: "chat:compact", label: t("session.compact"), keywords: "сжать контекст compact context", group: "app", run: () => askChat("compact") },
      { id: "chat:terminal", label: t("terminal.open"), keywords: "терминал консоль terminal console", group: "app", run: () => askChat("terminal") },
      { id: "chat:file", label: t("files.title"), keywords: "найти файл file search", group: "app", run: () => askChat("fileSearch") },
      { id: "chat:move", label: t("session.move"), keywords: "перенести проект move project", group: "app", run: () => askChat("move") },      { id: "restart", label: t("palette.restartServer"), keywords: "перезапустить сервер", group: "app", run: () => void storeRef.current.restartService() },
      { id: "sidebar", label: t("chat.toggleSidebar"), keywords: "панель сессий sidebar", group: "app", run: () => setSidebarOpen((value) => !value) },
      { id: "focus", label: t("chat.expand"), keywords: "фокус во весь экран", group: "app", run: () => setExpanded((value) => !value) },
    ],
    [createAndOpen, goChat, t],
  )

  return (
    <div className={cx("shell", !sidebarOpen && "no-sidebar", expanded && "expanded")}>
      <div className="titlebar">
        <div className="navwrap">
          <button
            type="button"
            className={cx("iconbtn", navOpen && "active")}
            title={t("nav.sections")}
            onClick={() => setNavOpen((value) => !value)}
          >
            <IconMenu size={16} />
          </button>
          {navOpen ? (
            <div className="navmenu" role="menu">
              {view !== "chat" ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="navmenu-item"
                    onClick={() => {
                      setNavOpen(false)
                      goChat()
                    }}
                  >
                    <IconChat size={15} />
                    <span>{t("nav.backToChat")}</span>
                    <span className="kbd">Esc</span>
                  </button>
                  <div className="navmenu-sep" />
                </>
              ) : null}
              {NAV.map((item) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    className={cx("navmenu-item", view === item.id && "active")}
                    onClick={() => {
                      setNavOpen(false)
                      if (item.id === "chat") {
                        if (!store.activeTab) void createAndOpen()
                        setView("chat")
                        return
                      }
                      setView(item.id)
                    }}
                  >
                    <Icon size={15} />
                    <span>{t(item.label)}</span>
                    {item.kbd ? <span className="kbd">{item.kbd}</span> : null}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>

        <div className="tabstrip" ref={stripRef}>
          {store.tabs.map((tab) => {
            const session = store.sessions.find((item) => item.id === tab.sessionId)
            const busy = Boolean(store.busy[tab.sessionId])
            return (
              <div
                key={tab.sessionId}
                className={cx("tab", tab.sessionId === store.activeTab && "active")}
                onClick={() => store.openSession(tab.sessionId)}
              >
                {/* A background tab gets the effect; the tab being read gets the
                    person at the keyboard instead. The chat behind it is already
                    carrying the animation, and putting all three on one tab would
                    say the same thing three times. */}
                {busy && tab.sessionId !== store.activeTab && tabAnim.kind !== "off" ? (
                  <BusyAnimation settings={tabAnim} />
                ) : null}
                {busy && tab.sessionId === store.activeTab ? (
                  <span className="typing" title={t("session.typing")}>
                    <TypingIndicator size={14} />
                  </span>
                ) : null}
                <span className={cx("dot", busy ? "busy" : store.activeTab === tab.sessionId && "live")} />
                {busy && tab.sessionId === store.activeTab && store.turnStart[tab.sessionId] ? (
                  <TurnTimer
                    startedAt={store.turnStart[tab.sessionId]}
                    samples={store.turnLog[tab.sessionId] ?? []}
                    now={store.now}
                    compact
                  />
                ) : null}
                <span className="label">{session?.title || t("session.untitled")}</span>
                <button
                  type="button"
                  className="close"
                  title={t("nav.closeTab")}
                  onClick={(event) => {
                    event.stopPropagation()
                    store.closeTab(tab.sessionId)
                  }}
                >
                  <IconClose size={12} />
                </button>
              </div>
            )
          })}
          <button
            type="button"
            className="iconbtn"
            title={t("nav.newSessionTitle")}
            onClick={() => void createAndOpen()}
          >
            <IconPlus size={15} />
          </button>
        </div>

        {/* Update arrow: only when there is something to install, and it does
            the whole job in one click so it never leaves the user halfway. */}
        {update?.available ? (
          <button
            type="button"
            className={cx("updatebtn", updating && "busy")}
            title={
              update.staged
                ? t("set.installUpdate")
                : `${t("set.downloadUpdate")} ${update.version}`
            }
            aria-label={t("set.downloadUpdate")}
            disabled={updating}
            onClick={() => void startUpdate()}
          >
            <IconDownload size={15} />
            {/* Shown on hover only, and only because the arrow is not the whole
                meaning: a circle with a down arrow says "something arrived",
                the words say what it is. */}
            <span className="updatebtn-label">
              {update.staged ? t("set.installUpdate") : t("set.downloadUpdate")}
            </span>
          </button>
        ) : null}

        <div className="winctl">
          <button type="button" title={t("win.minimize")} onClick={() => void window.ocd.app.minimize()}>
            <IconMinimize size={15} />
          </button>
          <button
            type="button"
            title={t("win.maximize")}
            onClick={() => void window.ocd.app.toggleMaximize()}
          >
            <IconMaximize size={14} />
          </button>
          <button type="button" className="close" title={t("win.close")} onClick={() => void window.ocd.app.close()}>
            <IconClose size={15} />
          </button>
        </div>
      </div>

      <aside className="sidebar">
        <div className="side-top">
          <div className="search">
            <IconSearch size={14} className="mag" />
            <input
              ref={searchRef}
              placeholder={t("shell.searchSessions")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {/* The filters only matter once there is something to narrow: the
              index holds every conversation on the machine, and a search for a
              common word answers with dozens of hits. */}
          {store.sessions.length > 0 ? (
            <div className="search-filters">
              <select
                className="input"
                value={modelFilter}
                title={t("search.filterModel")}
                onChange={(event) => setModelFilter(event.target.value)}
              >
                <option value="">{t("search.filterModel")}</option>
                {filterOptions.models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
              <select
                className="input"
                value={projectFilter}
                title={t("search.filterProject")}
                onChange={(event) => setProjectFilter(event.target.value)}
              >
                <option value="">{t("search.filterProject")}</option>
                {filterOptions.projects.map((project) => (
                  <option key={project} value={project}>
                    {project.split(/[\\/]/).pop() || project}
                  </option>
                ))}
              </select>
              <select
                className="input"
                value={dateFilter}
                title={t("search.filterDate")}
                onChange={(event) => setDateFilter(event.target.value)}
              >
                <option value="">{t("search.filterDate")}</option>
                <option value="today">{t("session.today")}</option>
                <option value="week">{t("session.week")}</option>
                <option value="month">{t("session.month")}</option>
              </select>
              {knownTags.length ? (
                <select
                  className="input"
                  value={tagFilter}
                  title={t("search.filterTag")}
                  onChange={(event) => setTagFilter(event.target.value)}
                >
                  <option value="">{t("search.filterTag")}</option>
                  {knownTags.map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
              ) : null}
              <button
                type="button"
                className={cx("iconbtn", bulkMode && "on")}
                title={bulkMode ? t("bulk.exit") : t("bulk.enter")}
                onClick={() => (bulkMode ? exitBulk() : setBulkMode(true))}
              >
                <IconCheck size={14} />
              </button>
              <button
                type="button"
                className="iconbtn"
                title={searchPending ? t("search.reindexing") : t("search.reindex")}
                disabled={searchPending}
                onClick={reindex}
              >
                <IconRefresh size={14} />
              </button>
            </div>
          ) : null}
        </div>

        <div className="side-scroll">
          {bulkMode ? (
            <div className="bulk-bar">
              <span className="bulk-count">{t("bulk.selected", { n: selected.size })}</span>
              <div className="bulk-actions">
                <button type="button" className="bulk-btn" onClick={selectAllVisible}>
                  {t("bulk.selectAll")}
                </button>
                <button
                  type="button"
                  className={cx("bulk-btn", bulkConfirm && "danger")}
                  disabled={selected.size === 0}
                  onClick={() => void bulkDelete()}
                >
                  {bulkConfirm ? t("bulk.confirmDelete") : t("bulk.delete")}
                </button>
                <button
                  type="button"
                  className="bulk-btn"
                  disabled={selected.size === 0}
                  onClick={() => void bulkMove()}
                >
                  {t("bulk.move")}
                </button>
              </div>
              <div className="bulk-tag">
                <input
                  className="input"
                  value={bulkTagDraft}
                  placeholder={t("bulk.tagPlaceholder")}
                  onChange={(event) => setBulkTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") applyBulkTag()
                  }}
                />
                <button
                  type="button"
                  className="bulk-btn"
                  disabled={selected.size === 0 || !bulkTagDraft.trim()}
                  onClick={applyBulkTag}
                >
                  {t("bulk.tag")}
                </button>
              </div>
              <button type="button" className="bulk-btn ghost" onClick={exitBulk}>
                {t("bulk.exit")}
              </button>
            </div>
          ) : null}
          {view !== "chat" ? null : (
            <>
              {visibleHits.length > 0 ? (
                <>
                  <div className="group-label">{t("search.inMessages")}</div>
                  {visibleHits.map((hit) => (
                    <button
                      key={hit.sessionId}
                      type="button"
                      className={cx("sess", "hit", hit.sessionId === store.activeTab && "active")}
                      onClick={() => openHit(hit)}
                      title={hit.snippet}
                    >
                      <span className="t">{hit.title || t("session.untitled")}</span>
                      <span className="snippet">{hit.snippet}</span>
                    </button>
                  ))}
                  <div className="navmenu-sep" />
                </>
              ) : null}

              {searchHits.length > 0 && visibleHits.length === 0 ? (
                <div className="search-state">{t("search.noFilterMatch")}</div>
              ) : null}

              {searchPending ? (
                <div className="search-state">{t("search.indexing")}</div>
              ) : null}

              {filteredSessions.length === 0 ? (
                <div style={{ padding: "12px 10px", color: "var(--text-faint)", fontSize: 12 }}>
                  {t("shell.noSessions")}
                </div>
              ) : null}

              {filteredSessions.map((group) => (
                <div key={group.label}>
                  <div className="group-label">{group.label}</div>
                  {group.items.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      className={cx(
                        "sess",
                        session.id === store.activeTab && "active",
                        bulkMode && selected.has(session.id) && "picking",
                      )}
                      onClick={() => (bulkMode ? toggleSelect(session.id) : pickSession(session.id))}
                      title={session.location?.directory ?? session.id}
                    >
                      {bulkMode ? (
                        <span className={cx("tick", selected.has(session.id) && "on")}>
                          {selected.has(session.id) ? <IconCheck size={11} /> : null}
                        </span>
                      ) : (
                        <span
                          className={cx(
                            "bullet",
                            (store.busy[session.id] || store.activeSessions[session.id]) && "live",
                          )}
                          title={
                            store.activeSessions[session.id]
                              ? t("session.runningElsewhere")
                              : undefined
                          }
                        />
                      )}
                      <span className="t">{session.title || t("session.untitled")}</span>
                      <TagChips sessionId={session.id} />
                      <span className="when">{shortAge(session.time?.updated ?? session.time?.created)}</span>
                    </button>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>

        <div className="side-foot">
          <span className={cx("dot", isConnected && "on")} />
          <span className="grow">
            {isConnected
              ? t("shell.openCodeVersion", { version: store.status?.version ?? "" })
              : t("shell.serverDown")}
          </span>
          <button
            type="button"
            className="iconbtn"
            title={isConnected ? t("shell.restartServer") : t("shell.connect")}
            onClick={() => (isConnected ? void store.restartService() : void store.connect())}
          >
            <IconLayers size={14} />
          </button>
        </div>
      </aside>

      <main className="main">
        {view === "chat" ? (
          <ChatView
            // One tab, one chat: the key makes the window keep a separate
            // transcript, request and preview per conversation, instead of
            // handing the next tab what the previous one left on screen.
            key={activeSession?.id ?? "empty"}
            session={activeSession}
            expanded={expanded}
            onToggleExpand={() => setExpanded((value) => !value)}
            onToggleSidebar={() => setSidebarOpen((value) => !value)}
          />
        ) : null}
        {view === "files" ? <FilesView onBack={goChat} /> : null}
        {view === "capabilities" ? <CapabilitiesView onBack={goChat} /> : null}
        {view === "plugins" ? <PluginsView onBack={goChat} /> : null}
        {view === "providers" ? <ProvidersView onBack={goChat} /> : null}
        {view === "settings" ? <SettingsView onBack={goChat} /> : null}
        {view === "about" ? <AboutView onBack={goChat} /> : null}
      {view === "log" ? <LogView onBack={goChat} /> : null}
      </main>

      <PermissionPrompt />

      {compareOpen ? (
        <SessionCompare sessions={store.sessions} onClose={() => setCompareOpen(false)} />
      ) : null}
      {arenaOpen ? <ArenaView onClose={() => setArenaOpen(false)} /> : null}

      <ToastStack toasts={store.toasts} onDismiss={store.dismissToast} />

      <CommandPalette
        open={paletteOpen}
        commands={commands}
        sessions={store.sessions}
        onClose={() => setPaletteOpen(false)}
        onOpenSession={(id) => {
          setView("chat")
          pickSession(id)
        }}
      />
    </div>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}

