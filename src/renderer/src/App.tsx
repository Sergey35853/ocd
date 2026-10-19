import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { SearchHit } from "@shared/types"
import { StoreProvider, useStore } from "./lib/store"
import { cx, groupSessions, shortAge } from "./lib/format"
import { ToastStack } from "./components/ui"
import { PermissionPrompt } from "./components/PermissionPrompt"
import { CommandPalette, type Command } from "./components/CommandPalette"
import {
  IconChat,
  IconChip,
  IconClose,
  IconDownload,
  IconGear,
  IconInfo,
  IconLayers,
  IconMaximize,
  IconMenu,
  IconMinimize,
  IconPlus,
  IconPuzzle,
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
import { useT, type DictKey } from "./i18n"

type ViewId = "chat" | "capabilities" | "plugins" | "providers" | "settings" | "about"

const VIEWS: ViewId[] = ["chat", "capabilities", "plugins", "providers", "settings", "about"]

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
  { id: "capabilities", label: "nav.capabilities", icon: IconSpark },
  { id: "plugins", label: "nav.plugins", icon: IconPuzzle },
  { id: "providers", label: "nav.providers", icon: IconChip },
  { id: "settings", label: "nav.settings", icon: IconGear },
  { id: "about", label: "nav.about", icon: IconInfo },
]

function Shell() {
  const store = useStore()

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
  // Full-text results. Separate from `query`: titles filter instantly while
  // the body index is consulted in the background, so typing never waits.
  const [searchHits, setSearchHits] = useState<SearchHit[]>([])
  const [searchPending, setSearchPending] = useState(false)
  const [indexReady, setIndexReady] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
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
      store.openSession(sessionId)
      if (narrow) setSidebarOpen(false)
    },
    [narrow, store],
  )

  const filteredSessions = useMemo(() => {
    const needle = query.trim().toLowerCase()
    // Sessions already listed above as a body match are not repeated below.
    const shown = new Set(searchHits.map((hit) => hit.sessionId))
    const list = needle
      ? store.sessions.filter(
          (session) =>
            !shown.has(session.id) &&
            `${session.title ?? ""} ${session.id}`.toLowerCase().includes(needle),
        )
      : store.sessions.filter((session) => !shown.has(session.id))
    return groupSessions(list)
  }, [store.sessions, query, searchHits])

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
    const id = await store.newSession()
    if (id) setView("chat")
  }, [store])

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
      if (event.ctrlKey && event.key.toLowerCase() === "n") {
        event.preventDefault()
        void createAndOpen()
      }
      if (event.key === "Escape") {
        setQuery("")
        setNavOpen(false)
        // Escape walks out of a leaf view, which is what the menu hint promises.
        if (view !== "chat") goChat()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [createAndOpen, goChat, view])

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

  // A window opened for one conversation should show exactly that one.
  useEffect(() => {
    const wanted = sessionFromHash()
    if (!wanted) return
    if (store.activeTab === wanted) return
    void store.openSession(wanted)
  }, [store])

  // Tray entries and the tray language switch arrive as commands.
  useEffect(() => {
    return window.ocd.app.onCommand((command) => {
      if (command.kind === "open-session" && command.sessionId) {
        setView("chat")
        void store.openSession(command.sessionId)
        return
      }
      if (command.kind === "set-language" && command.language) {
        void store.updateSettings({ uiLanguage: command.language as never })
      }
    })
  }, [store])

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

  // Ctrl+K opens the palette. Taken here rather than in the chat so it works
  // from Settings and Providers too.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setPaletteOpen((value) => !value)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const commands = useMemo<Command[]>(
    () => [
      { id: "new", label: t("nav.newSession"), keywords: "создать новая сессия create", group: "nav", run: () => void createAndOpen() },
      { id: "view:chat", label: t("palette.backToChat"), keywords: "беседы чат chat", group: "nav", run: goChat },
      { id: "view:capabilities", label: t("nav.capabilities"), keywords: "возможности агенты", group: "nav", run: () => setView("capabilities") },
      { id: "view:plugins", label: t("nav.plugins"), keywords: "плагины расширения", group: "nav", run: () => setView("plugins") },
      { id: "view:providers", label: t("nav.providers"), keywords: "провайдеры модели", group: "nav", run: () => setView("providers") },
      { id: "view:settings", label: t("nav.settings"), keywords: "настройки опции", group: "nav", run: () => setView("settings") },
      { id: "view:about", label: t("nav.about"), keywords: "о программе версия обновление about version", group: "nav", run: () => setView("about") },
      { id: "hud", label: t("set.hudToggle"), keywords: "панель индикатор hud", group: "app", run: () => void window.ocd.hud.toggle() },
      { id: "restart", label: t("palette.restartServer"), keywords: "перезапустить сервер", group: "app", run: () => void store.restartService() },
      { id: "sidebar", label: t("chat.toggleSidebar"), keywords: "панель сессий sidebar", group: "app", run: () => setSidebarOpen((value) => !value) },
      { id: "focus", label: t("chat.expand"), keywords: "фокус во весь экран", group: "app", run: () => setExpanded((value) => !value) },
    ],
    [createAndOpen, goChat, store, t],
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
              placeholder={t("shell.searchSessions")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>

        <div className="side-scroll">
          {view !== "chat" ? null : (
            <>
              {searchHits.length > 0 ? (
                <>
                  <div className="group-label">{t("search.inMessages")}</div>
                  {searchHits.map((hit) => (
                    <button
                      key={hit.sessionId}
                      type="button"
                      className={cx("sess", "hit", hit.sessionId === store.activeTab && "active")}
                      onClick={() => pickSession(hit.sessionId)}
                      title={hit.snippet}
                    >
                      <span className="t">{hit.title || t("session.untitled")}</span>
                      <span className="snippet">{hit.snippet}</span>
                    </button>
                  ))}
                  <div className="navmenu-sep" />
                </>
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
                      className={cx("sess", session.id === store.activeTab && "active")}
                      onClick={() => pickSession(session.id)}
                      title={session.location?.directory ?? session.id}
                    >
                      <span className={cx("bullet", store.busy[session.id] && "live")} />
                      <span className="t">{session.title || t("session.untitled")}</span>
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
            session={activeSession}
            expanded={expanded}
            onToggleExpand={() => setExpanded((value) => !value)}
            onToggleSidebar={() => setSidebarOpen((value) => !value)}
          />
        ) : null}
        {view === "capabilities" ? <CapabilitiesView onBack={goChat} /> : null}
        {view === "plugins" ? <PluginsView onBack={goChat} /> : null}
        {view === "providers" ? <ProvidersView onBack={goChat} /> : null}
        {view === "settings" ? <SettingsView onBack={goChat} /> : null}
        {view === "about" ? <AboutView onBack={goChat} /> : null}
      </main>

      <PermissionPrompt />

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

