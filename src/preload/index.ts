import { contextBridge, ipcRenderer } from "electron"
import type {
  AppSettings,
  AttemptStatus,
  FeedbackKind,
  FinishNotice,
  ConfigProviderSummary,
  IntegrationAttempt,
  IntegrationInfo,
  LocalRuntimeStatus,
  FileGroup,
  HardwareFacts,
  PullProgress,
  RepoHit,
  PickedFiles,
  ProviderInstall,
  FormAnswer,
  PendingForm,
  ReplyLanguage,
  PermissionDecision,
  PermissionRequest,
  SearchHit,
  PromptFile,
  SessionInfo,
  LimitWindow,
  InboxItem,
  PromptDelivery,
  RequestLimits,
  MessagePageQuery,
} from "@shared/types"

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string }

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as Envelope<T>
  if (!res || typeof res !== "object" || !("ok" in res)) {
    throw new Error(`Malformed IPC response on ${channel}`)
  }
  if (!res.ok) throw new Error(res.error)
  return res.data
}

const api = {
  service: {
    status: () => call("service:status"),
    connect: (serverUrl?: string) => call("service:connect", serverUrl),
    restart: () => call("service:restart"),
  },
  api: {
    info: () => call("api:info"),
    config: () => call("api:config"),
    projects: () => call("api:projects"),
    currentLocation: () => call("api:currentLocation"),
    locations: () => call("api:locations"),
    providers: (directory?: string) => call("api:providers", directory),
    models: (directory?: string) => call("api:models", directory),
    agents: () => call("api:agents"),
    plugins: () => call("api:plugins"),
    updatePlugins: () => call("api:updatePlugins"),
    mcp: () => call("api:mcp"),
    skills: () => call("api:skills"),
    commands: () => call("api:commands"),
    sessions: (directory?: string) => call("api:sessions", directory),
    createSession: (input: {
      title?: string
      directory?: string
      agent?: string
      model?: { providerID: string; id: string }
    }) => call("api:createSession", input),
    session: (id: string) => call("api:session", id),
    deleteSession: (id: string) => call("api:deleteSession", id),
    renameSession: (id: string, title: string) => call("api:renameSession", id, title),
    messages: (sessionId: string) => call("api:messages", sessionId),
    messagePage: (sessionId: string, page?: MessagePageQuery) =>
      call("api:messagePage", sessionId, page),
    prompt: (
      sessionId: string,
      input: {
        text: string
        agent?: string
        files?: PromptFile[]
        delivery?: PromptDelivery
      },
    ) => call("api:prompt", sessionId, input),
    /**
     * Stop the running turn.
     *
     * The route is `/interrupt`, not `/abort` — the latter does not exist on
     * the server and answers 404. `resume` picks the turn back up on the next
     * queued prompt instead of leaving it parked.
     */
    interrupt: (sessionId: string, resume?: boolean) =>
      call<{ interrupted: boolean }>("api:interrupt", sessionId, resume === true),
    setSessionModel: (sessionId: string, model: { providerID: string; id: string; variant?: string }) =>
      call("api:setSessionModel", sessionId, model),
    setSessionAgent: (sessionId: string, agent: string) =>
      call("api:setSessionAgent", sessionId, agent),
    compactSession: (sessionId: string) => call("api:compactSession", sessionId),
    forkSession: (sessionId: string, before?: string) =>
      call("api:forkSession", sessionId, before),
    moveSession: (sessionId: string, directory: string) =>
      call("api:moveSession", sessionId, directory),
    runSessionCommand: (sessionId: string, command: { name: string; text: string }) =>
      call("api:runSessionCommand", sessionId, command),
    permissionRules: (projectID?: string) => call("api:permissionRules", projectID),
    savePermissionRule: (
      sessionId: string,
      rule: { action: string; resources: string[]; save?: string[] },
    ) => call("api:savePermissionRule", sessionId, rule),
    deletePermissionRule: (id: string) => call("api:deletePermissionRule", id),
    exportSessionFile: (sessionId: string, title: string) =>
      call("app:exportSessionFile", sessionId, title),
    importSessionFile: () => call("app:importSessionFile"),
    findFiles: (query: string, directory?: string) => call("api:findFiles", query, directory),
    vcsBranch: (directory?: string) => call("api:vcsBranch", directory),
    vcsStatus: (directory?: string) => call("api:vcsStatus", directory),
    worktrees: () => call("api:worktrees"),
    credentials: () => call("api:credentials"),
    activateCredential: (id: string) => call("api:activateCredential", id),
    deleteCredential: (id: string) => call("api:deleteCredential", id),
    /**
     * Rewinds the conversation to before a message. Everything from it on is
     * dropped, which is what "edit and resend" needs.
     */
    revert: (sessionId: string, messageId: string) =>
      call<{ messageID: string }>("api:revert", sessionId, messageId),
    revertCancel: (sessionId: string) => call("api:revertCancel", sessionId),
    serverDefaultModel: () => call("api:serverDefaultModel"),
  },
  plugins: {
    list: () => call("plugins:list"),
    search: (query: string) => call("plugins:search", query),
    install: (pkg: string) => call("plugins:install", pkg),
    uninstall: (id: string) => call("plugins:uninstall", id),
    addLocal: (dir: string) => call("plugins:addLocal", dir),
    revealLocal: (dir: string) => call("plugins:revealLocal", dir),
  },
  configFile: {
    read: () => call("configFile:read"),
    write: (text: string) => call("configFile:write", text),
    reload: () => call("configFile:reload"),
    setModel: (providerID: string, modelID: string) => call("configFile:setModel", providerID, modelID),
    setAgent: (agent: string) => call("configFile:setAgent", agent),
    setReplyLanguage: (lang: ReplyLanguage) => call("configFile:setReplyLanguage", lang),
    replyLanguage: () => call<ReplyLanguage>("configFile:replyLanguage"),
    languageCurrent: (lang: ReplyLanguage) => call<boolean>("configFile:languageCurrent", lang),
    setProvider: (providerID: string, patch: ProviderInstall) =>
      call("configFile:setProvider", providerID, patch),
    removeProvider: (providerID: string) => call("configFile:removeProvider", providerID),
    providers: () => call<ConfigProviderSummary[]>("configFile:providers"),
    path: () => call<string>("configFile:path"),
  },
  /**
   * The server's catalog of connectable services, and the ways to connect.
   *
   * Connecting stores the credential on the server, which is why it goes
   * through the integration routes rather than the config file.
   */
  integration: {
    list: () => call<IntegrationInfo[]>("integration:list"),
    connectKey: (integrationId: string, key: string, answer?: Record<string, string>, label?: string) =>
      call("integration:connectKey", integrationId, key, answer, label),
    oauthBegin: (integrationId: string, methodId: string, answer?: Record<string, string>, label?: string) =>
      call<IntegrationAttempt>("integration:oauthBegin", integrationId, methodId, answer, label),
    oauthStatus: (integrationId: string, attemptId: string) =>
      call<AttemptStatus>("integration:oauthStatus", integrationId, attemptId),
    oauthComplete: (integrationId: string, attemptId: string, code?: string) =>
      call("integration:oauthComplete", integrationId, attemptId, code),
    oauthCancel: (integrationId: string, attemptId: string) =>
      call("integration:oauthCancel", integrationId, attemptId),
    /** Asks a local runtime what it has; offline is a normal answer. */
    probe: (baseURL: string) => call<LocalRuntimeStatus>("integration:probe", baseURL),
    providers: () => call<ConfigProviderSummary[]>("configFile:providers"),
    path: () => call<string>("configFile:path"),
  },
  model: {
    engines: () => call<Array<{ id: string; label: string; baseURL: string }>>("model:engines"),
    list: (engineId: string) =>
      call<Array<{ name: string; size?: number; modified?: string }>>("model:list", engineId),
    /**
     * Downloads a model. This is the only route that fetches anything, and it
     * runs because the user asked for that model by name.
     */
    pull: (engineId: string, model: string) => call<string>("model:pull", engineId, model),
    pullCancel: (jobId: string) => call<boolean>("model:pullCancel", jobId),
    delete: (engineId: string, model: string) => call("model:delete", engineId, model),
    onProgress: (cb: (progress: PullProgress) => void) => {
      const listener = (_event: unknown, progress: PullProgress) => cb(progress)
      ipcRenderer.on("ocd:pull", listener)
      return () => ipcRenderer.off("ocd:pull", listener)
    },
  },
  local: {
    /** Read once: every fit verdict in the catalog is judged against this. */
    hardware: () => call<HardwareFacts>("local:hardware"),
    searchRepos: (query: string, limit?: number) =>
      call<RepoHit[]>("local:searchRepos", query, limit),
    repoFiles: (repo: string) => call<FileGroup[]>("local:repoFiles", repo),
  },
  preview: {
    writeTemp: (html: string) => call("preview:writeTemp", html),
    open: (path: string) => call("preview:open", path),
    openExternal: (url: string) => call<boolean>("preview:openExternal", url),
  },
  app: {
    getSettings: () => call("app:getSettings"),
    setSettings: (patch: Record<string, unknown>) => call("app:setSettings", patch),
    version: () => call("app:version"),
    minimize: () => call("app:minimize"),
    toggleMaximize: () => call("app:toggleMaximize"),
    close: () => call("app:close"),
    minimizeToTray: () => call("app:minimizeToTray"),
    setAlwaysOnTop: (value: boolean) => call("app:setAlwaysOnTop", value),
    openExternal: (url: string) => call("app:openExternal", url),
    openPath: (target: string) => call("app:openPath", target),
    pickDirectory: () => call<string | null>("app:pickDirectory"),

    // ---- tray, global hotkey, session windows ----
    trayState: (next: {
      recent?: Array<{ id: string; title: string }>
      connected?: boolean
      visible?: boolean
      language?: string
    }) => call("app:trayState", next),
    showWindow: () => call<boolean>("app:showWindow"),
    hideWindow: () => call("app:hideWindow"),
    focusComposer: () => call("app:focusComposer"),
    openSessionWindow: (sessionId: string, title?: string | null) =>
      call<boolean>("app:openSessionWindow", sessionId, title ?? null),
    setGlobalHotkey: (accelerator: string) =>
      call<{ ok: boolean; error?: string }>("app:setGlobalHotkey", accelerator),
    setAutoUpdate: (enabled: boolean) => call<boolean>("app:setAutoUpdate", enabled),
    checkForUpdates: () => call<{ ok: boolean; message: string }>("app:checkForUpdates"),
    downloadUpdate: () => call<{ ok: boolean; message: string }>("app:downloadUpdate"),
    installUpdate: () => call<{ ok: boolean; message: string }>("app:installUpdate"),
    updateState: () =>
      call<{ available: boolean; version: string; staged: boolean }>("app:updateState"),
    printConversation: (payload: {
      sessionId: string
      title: string
      markdown: string
      messages: number
    }) => call<{ ok: boolean; canceled?: boolean; error?: string }>("print:conversation", payload),
    exportConversation: (payload: {
      sessionId: string
      title: string
      markdown: string
      format: "markdown" | "html" | "pdf"
      messages: number
    }) => call<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>(
      "app:exportConversation",
      payload,
    ),
    /** Write app-produced text (a patch) exactly as given, wherever the user says. */
    saveText: (payload: { name: string; content: string; ext: string }) =>
      call<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>(
        "app:saveText",
        payload,
      ),
    /** Commands pushed from main: tray items, hotkey, tray language switch. */
    onCommand: (cb: (command: { kind: string; sessionId?: string; language?: string }) => void) => {
      const listener = (
        _event: unknown,
        payload: { kind: string; sessionId?: string; language?: string },
      ) => cb(payload)
      ipcRenderer.on("ocd:command", listener)
      return () => ipcRenderer.off("ocd:command", listener)
    },
  },
  search: {
    /** Build (or refresh) the conversation index; resolves with its size. */
    build: (force?: boolean) => call<{ sessions: number }>("search:build", force === true),
    query: (text: string, sessions: Array<{ id: string; title?: string; time?: { updated?: number } }>) =>
      call<SearchHit[]>("search:query", text, sessions as SessionInfo[]),
    clear: () => call("search:clear"),
  },
  permission: {
    /** Requests the server is blocked on, waiting for an answer. */
    list: (directory?: string) => call<PermissionRequest[]>("permission:list", directory),
    reply: (
      sessionId: string,
      requestId: string,
      decision: PermissionDecision,
      message?: string,
    ) => call("permission:reply", sessionId, requestId, decision, message),
  },
  form: {
    /** Questions the model is waiting on, keyed by session. */
    list: (sessionId: string) => call<PendingForm[]>("form:list", sessionId),
    /** Settle a question. This is what releases the blocked turn. */
    reply: (sessionId: string, formId: string, answer: FormAnswer) =>
      call("form:reply", sessionId, formId, answer),
    /** Dismiss a question without answering it. */
    cancel: (sessionId: string, formId: string) => call("form:cancel", sessionId, formId),
  },
  notify: {
    /** Toast when a turn ends while this window is in the background. */
    finish: (notice: FinishNotice) =>
      call<boolean>("notify:finish", notice),
  },
  shell: {
    /**
     * Re-runs one of the agent's commands in the machine's own terminal.
     * Reports which launcher was used so the toast can be specific.
     */
    openTerminal: (command: string, cwd?: string) =>
      call<{ launcher: string; opened: boolean }>("shell:openTerminal", { command, cwd }),
  },
  remote: {
    /** Open an SSH tunnel and adopt the remote OpenCode as the endpoint. */
    connect: (target: { host: string; remotePort: number; localPort?: number; remember?: boolean }) =>
      call<{ url: string; port: number }>("remote:connect", target),
    disconnect: () => call("remote:disconnect"),
    status: () => call<{ active: boolean; url: string | null }>("remote:status"),
  },
  hud: {
    /** Push the current state from main; main owns it, the HUD only renders. */
    onState: (cb: (state: { connected: boolean; busy: Array<{ id: string; title: string }>; status: string }) => void) => {
      const listener = (_event: unknown, payload: { connected: boolean; busy: Array<{ id: string; title: string }>; status: string }) =>
        cb(payload)
      ipcRenderer.on("ocd:hud", listener)
      return () => ipcRenderer.off("ocd:hud", listener)
    },
    /** Ask main to send the state now (the window may have mounted late). */
    request: () => call("hud:request"),
    toggle: () => call<boolean>("hud:toggle"),
    close: () => call("hud:close"),
  },
  notice: {
    /** Main pushes a finished reply into the card. */
    onShow: (cb: (payload: FinishNotice) => void) => {
      const listener = (_event: unknown, payload: FinishNotice) => cb(payload)
      ipcRenderer.on("ocd:notice", listener)
      return () => ipcRenderer.off("ocd:notice", listener)
    },
    /** The card was clicked: open that conversation and put the card away. */
    dismiss: (sessionId: string) => call<boolean>("notice:dismiss", sessionId),
  },
  attachments: {
    pick: (kind: "image" | "file") => call("attachments:pick", kind),
    fromClipboard: () => call("attachments:fromClipboard"),
    fromPaths: (paths: string[]) => call("attachments:fromPaths", paths),
    // The name has to cross: without it every dropped file arrives called
    // `pasted.png`, and three of them in a row are indistinguishable.
    fromDataUrl: (dataUrl: string, nameHint?: string) =>
      call("attachments:fromDataUrl", dataUrl, nameHint),
  },
  contextMenu: {
    show: (target: "input" | "stream") => call("menu:contextMenu", target),
    onAttach: (cb: (picked: PickedFiles) => void) => {
      const listener = (_event: unknown, payload: PickedFiles) => cb(payload)
      ipcRenderer.on("ocd:attach", listener)
      return () => ipcRenderer.off("ocd:attach", listener)
    },
  },
  pty: {
    /** Run a command in the server's terminal and attach to it. */
    open: (input: { command: string; args?: string[]; cwd?: string; title?: string }) =>
      call("pty:open", input),
    /** What the user typed. */
    input: (id: string, data: string) => call("pty:input", id, data),
    /** Stop the command. */
    close: (id: string) => call("pty:close", id),
    /** What the terminal wrote. */
    onOutput: (cb: (payload: { id: string; data: string }) => void) => {
      const listener = (_event: unknown, payload: { id: string; data: string }) => cb(payload)
      ipcRenderer.on("ocd:pty", listener)
      return () => ipcRenderer.off("ocd:pty", listener)
    },
  },
  voice: {
    defaults: () => call("voice:defaults"),
    devices: () => call("voice:devices"),
    voices: () => call("voice:voices"),
    speak: (text: string) => call("voice:speak", text),
    stopSpeaking: () => call("voice:stopSpeaking"),
    startDictation: () => call("voice:startDictation"),
    stopDictation: () => call("voice:stopDictation"),
    cancelDictation: () => call("voice:cancelDictation"),
    onState: (cb: (state: { dictation: string; error?: string }) => void) => {
      const listener = (_event: unknown, payload: { dictation: string; error?: string }) =>
        cb(payload)
      ipcRenderer.on("ocd:voice-state", listener)
      return () => ipcRenderer.off("ocd:voice-state", listener)
    },
    onResult: (cb: (result: { ok: boolean; text?: string; lang?: string; error?: string }) => void) => {
      const listener = (_event: unknown, payload: { ok: boolean; text?: string }) => cb(payload)
      ipcRenderer.on("ocd:dictation", listener)
      return () => ipcRenderer.off("ocd:dictation", listener)
    },
  },
  /**
   * How many requests each model has been sent and what ceiling they count
   * against. Counted by OCD, not read from the provider — see main/limits.ts.
   */
  limits: {
    snapshot: (model: string) => call<RequestLimits>("limits:snapshot", model),
    set: (model: string, window: LimitWindow, limit: number | null) =>
      call<RequestLimits>("limits:set", model, window, limit),
    clear: (model?: string) => call<boolean>("limits:clear", model),
  },
  diag: {
    report: (payload: { message: string; stack?: string; kind?: string }) =>
      call<boolean>("diag:report", payload),
  },
  /**
   * The way back to whoever ships this.
   *
   * Two calls, both from the About screen: whether this build has anywhere to
   * send to, and the note itself. A rejection carries a sentence meant to be
   * shown rather than a code to translate.
   */
  feedback: {
    configured: () => call<boolean>("feedback:configured"),
    send: (input: {
      kind: FeedbackKind
      message: string
      contact?: string
      tech?: boolean
      log?: string
    }) => call<boolean>("feedback:send", input),
  },
  settings: {
    export: () => call<string>("settings:export"),
    import: () => call<AppSettings>("settings:import"),
  },
  inbox: {
    list: (sessionId: string) => call<InboxItem[]>("inbox:list", sessionId),
    cancel: (sessionId: string, inboxId: string) =>
      call<boolean>("inbox:cancel", sessionId, inboxId),
    setDelivery: (sessionId: string, inboxId: string, delivery: PromptDelivery) =>
      call<boolean>("inbox:delivery", sessionId, inboxId, delivery),
  },
  events: {
    subscribe: () => call<{ ok: boolean }>("events:subscribe"),
    onEvent: (cb: (event: Record<string, unknown>) => void) => {
      const listener = (_event: unknown, payload: Record<string, unknown>) => cb(payload)
      ipcRenderer.on("ocd:event", listener)
      return () => ipcRenderer.off("ocd:event", listener)
    },
    onStatus: (cb: (status: Record<string, unknown>) => void) => {
      const listener = (_event: unknown, payload: Record<string, unknown>) => cb(payload)
      ipcRenderer.on("ocd:status", listener)
      return () => ipcRenderer.off("ocd:status", listener)
    },
    onUpdate: (cb: (state: { available: boolean; version: string; staged: boolean }) => void) => {
      const listener = (
        _event: unknown,
        state: { available: boolean; version: string; staged: boolean },
      ) => cb(state)
      ipcRenderer.on("ocd:update", listener)
      return () => ipcRenderer.off("ocd:update", listener)
    },
  },
}

contextBridge.exposeInMainWorld("ocd", api)

export type PreloadApi = typeof api




