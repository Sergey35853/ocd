import { BrowserWindow, app, dialog, ipcMain, shell } from "electron"
import { readFile } from "node:fs/promises"
import { readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { service } from "./service"
import { getSettings, setSettings, exportSettings, importSettings } from "./settings"
import { openPty, writePty, closePty } from "./pty"
import {
  readConfig,
  writeConfig,
  setReplyLanguage,
  configReplyLanguage,
  configLanguageCurrent,
  repairLegacyLanguageInstruction,
  setConfigProvider,
  removeConfigProvider,
  configProvidersSummary,
  configPath,
} from "./configFile"
import {
  installPlugin,
  listPlugins,
  uninstallPlugin,
} from "./plugins"
import { searchPlugins } from "./npm"
import { voice, type VoiceDefaults } from "./voice"
import {
  attachmentFromClipboard,
  attachmentFromDataUrl,
  attachmentsFromPaths,
  pickAttachments,
} from "./attachments"
import { showContextMenu, type ContextTarget } from "./contextMenu"
import { openPreviewExternal, preparePreview, writePreviewFile } from "./preview"
import { updateTrayState, currentLanguage } from "./tray"
import { openSessionWindow, registerGlobalHotkey } from "./windows"
import { refreshBackdrop } from "./backdrop"
import { conversationHtml, exportConversation, saveText, type ExportPayload } from "./export"
import { printConversation } from "./print"
import {
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  setAutoUpdate,
  updateEvents,
  updateState,
} from "./updater"
import { ensureIndex, indexSize, pruneIndex, search, type SearchHit } from "./searchIndex"
import {
  deleteCheckpoint,
  listCheckpoints,
  restoreCheckpoint,
  saveCheckpoint,
  type Checkpoint,
} from "./checkpoints"
import { clear as clearRequestLedger, countRequest, markRateLimited, setLimit, snapshot } from "./limits"
import { log, readLogTail, logFolder } from "./log"
import { setHudData, toggleHud } from "./hud"
import { sshTunnel } from "./sshTunnel"
import { flashTaskbar, notifyFinish, notifyRule, type FinishNotice } from "./notify"
import { dismissNotice, showFinishNotice } from "./notice"
import { openInTerminal, runCommand, type RunResult } from "./terminal"
import { probeRuntime } from "./runtimeProbe"
import {
  ENGINES,
  cancelJob,
  deleteModel,
  engineById,
  engineModels,
  pullModel,
  type PullProgress,
} from "./modelPull"
import { probeHardware, type HardwareFacts } from "./hardware"
import { backendConfigured, sendFeedback, type FeedbackInput } from "./feedback"
import { repoFiles, searchRepos, type FileGroup, type RepoHit } from "./hfBrowse"
import type {
  AgentInfo,
  AgentDetails,
  FileDiffInfo,
  AppSettings,
  AttemptStatus,
  CommandInfo,
  IntegrationAttempt,
  IntegrationInfo,
  LimitWindow,
  LocalRuntimeStatus,
  McpServerInfo,
  ModelInfo,
  ModelRef,
  FormAnswer,
  PendingForm,
  ProviderInfo,
  ProviderInstall,
  ReplyLanguage,
  RequestLimits,
  ServiceStatus,
  SessionInfo,
  SkillInfo,
  PromptFile,
  PromptDelivery,
  InboxItem,
  PermissionDecision,
  PermissionRequest,
  PermissionRule,
  FileEntry,
  InstructionEntry,
  SessionStats,
  WebSearchProvider,
  VcsBranch,
  VcsFileStatus,
  WorktreeInfo,
  StoredCredential,
  MessageInfo,
  MessagePage,
  MessagePageQuery,
  UpdateState,
} from "@shared/types"

/**
 * The branch a folder is on.
 *
 * The server lists the branches of a repository but does not say which one is
 * checked out, and the question the header answers is exactly that. The
 * repository says it itself, in its own HEAD — one small file, read here
 * because the renderer has no business touching the disk.
 */
function currentBranch(directory: string): string | null {
  try {
    const dotGit = join(directory, ".git")
    let headPath = join(dotGit, "HEAD")
    if (statSync(dotGit).isFile()) {
      // A worktree: .git is a file that points at the real directory.
      const text = readFileSync(dotGit, "utf8")
      const match = text.match(/^gitdir:\s*(.+)$/m)
      if (!match) return null
      headPath = join(match[1].trim(), "HEAD")
    }
    const head = readFileSync(headPath, "utf8").trim()
    const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/)
    // A detached HEAD has no branch: the commit itself is the best answer.
    return ref ? ref[1] : head || null
  } catch {
    // Not a repository, or not readable: there is no branch to show.
    return null
  }
}

/**
 * Some endpoints answer with a bare array, others with { all | data | models }. */
function unwrap<T>(value: unknown, ...keys: string[]): T[] {
  if (Array.isArray(value)) return value as T[]
  if (value && typeof value === "object") {
    for (const key of [...keys, "all", "data", "models", "items"]) {
      const found = (value as Record<string, unknown>)[key]
      if (Array.isArray(found)) return found as T[]
    }
  }
  return []
}

/**
 * The single object inside a `{ data: ... }` envelope.
 *
 * Some routes answer with a bare object and some with the envelope; returning
 * the payload either way keeps the callers from having to know which.
 */
function unwrapOne<T>(value: unknown): T {
  if (value && typeof value === "object" && "data" in (value as Record<string, unknown>)) {
    return (value as { data: T }).data
  }
  return value as T
}

/**
 * The folder an endpoint should look at.
 *
 * The server reads the location as a deep object — `location[directory]` — and
 * answers 400 for anything else, including the string "[object Object]" that
 * a plain object used to become.
 */
function locationQuery(directory?: string) {
  return directory ? { "location[directory]": directory } : undefined
}

/** An engine id the UI offered; anything else is a bug, not a user error. */
function requireEngine(engineId: string) {
  const engine = engineById(engineId)
  if (!engine) throw new Error(`Неизвестный движок: ${engineId}`)
  return engine
}

function getWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows()
}

type VoiceState = { dictation: "recording" | "transcribing" | "idle"; error?: string }

function broadcastVoiceState(state: VoiceState): void {
  for (const win of getWindows()) {
    if (!win.isDestroyed()) win.webContents.send("ocd:voice-state", state)
  }
}

/**
 * Push a download's progress to every window.
 *
 * The pull runs in main and outlives any one renderer, so the reports are
 * broadcast rather than returned: a view that opened halfway through still
 * learns how far along the download is.
 */
function broadcastPullProgress(progress: PullProgress): void {
  for (const win of getWindows()) {
    if (!win.isDestroyed()) win.webContents.send("ocd:pull", progress)
  }
}

export interface HudState {
  connected: boolean
  busy: Array<{ id: string; title: string }>
  status: string
}

/** What one window reports: only the fields a renderer knows about. */
interface HudReport {
  busy: Array<{ id: string; title: string }>
}

/** The merged picture, kept so a late HUD window can be told immediately. */
let hudState: HudState = { connected: false, busy: [], status: "" }

/** Ask every window what it is doing, then push the merged picture. */
async function collectHudState(): Promise<HudState> {
  const reports: HudReport[] = []
  for (const win of getWindows()) {
    if (win.isDestroyed()) continue
    try {
      const reply = await win.webContents.executeJavaScript(
        "JSON.stringify(window.__ocdHud ?? null)",
        true,
      )
      if (typeof reply !== "string") continue
      // The HUD window itself has nothing to report; it would otherwise push a
      // null into the list and break the merge below.
      const parsed = JSON.parse(reply) as Partial<HudReport> | null
      if (parsed && Array.isArray(parsed.busy)) reports.push({ busy: parsed.busy })
    } catch {
      // A window that cannot answer simply contributes nothing.
    }
  }

  const online = service.status().connected
  hudState = {
    connected: online,
    busy: reports.flatMap((report) => report.busy),
    status: online ? "Готов к работе" : "Сервер недоступен",
  }
  setHudData(hudState)
  return hudState
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  const handle = <T>(channel: string, fn: (...args: never[]) => Promise<T> | T) => {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return { ok: true, data: await fn(...(args as never[])) }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    })
  }

  // ---------- service ----------

  handle<ServiceStatus>("service:status", () => service.status())

  handle<ServiceStatus>("service:connect", async (serverUrl?: string) => {
    // The stream belongs to the old address. Whatever the new one turns out
    // to be, the old subscription has to go first — otherwise the chat keeps
    // listening to the server it was just pointed away from.
    service.stopEventStream()
    const result = await service.connect(serverUrl)
    if (result.connected) service.startEventStream()
    return result
  })

  handle<ServiceStatus>("service:restart", async () => {
    service.stopEventStream()
    const result = await service.restart()
    if (result.connected) service.startEventStream()
    return result
  })

  /**
   * The window asks for the server's events.
   *
   * The stream lives in main and is already forwarded to every window, so
   * this only has to make sure it is running — and answer honestly when it is
   * not, instead of leaving the caller waiting for events that will never
   * arrive.
   */
  handle<{ ok: boolean }>("events:subscribe", () => {
    if (service.status().connected) service.startEventStream()
    return { ok: service.status().connected }
  })

  // ---------- api ----------

  handle<unknown>("api:info", () => service.get("/api/info"))


  handle<ProviderInfo[]>("api:providers", async (directory?: string) =>
    unwrap<ProviderInfo>(await service.get("/api/provider", locationQuery(directory)), "providers"),
  )

  handle<ModelInfo[]>("api:models", async (directory?: string) => {
    const models = unwrap<ModelInfo>(await service.get("/api/model", locationQuery(directory)))
    return models.map((model) => ({
      ...model,
      ref: `${model.providerID ?? ""}/${model.id}`,
    }))
  })

  handle<AgentInfo[]>("api:agents", async () =>
    unwrap<AgentInfo>(await service.get("/api/agent")).filter((agent) => agent && agent.id),
  )

  /**
   * One agent in full.
   *
   * The list says only the name and the mode. The description and the rights
   * live here, and they are what a person wants to know before picking an
   * agent: what it is for and what it is allowed to do.
   */
  handle<AgentDetails>("api:agent", async (id: string) => {
    const data = await service.get<AgentDetails>(`/api/agent/${id}`)
    if (!data?.id) throw new Error(`Unknown agent: ${id}`)
    return {
      id: data.id,
      name: data.name,
      description: data.description,
      mode: data.mode,
      steps: data.steps,
      permissions: data.permissions ?? [],
    }
  })

 handle<unknown>("api:updatePlugins", () => service.post("/api/plugin/update"))

  handle<McpServerInfo[]>("api:mcp", async () =>
    unwrap<McpServerInfo>(await service.get("/api/mcp"), "servers"),
  )

  handle<SkillInfo[]>("api:skills", async () =>
    unwrap<SkillInfo>(await service.get("/api/skill"), "skills"),
  )

  handle<CommandInfo[]>("api:commands", async () =>
    unwrap<CommandInfo>(await service.get("/api/command"), "commands"),
  )

  handle<SessionInfo[]>("api:sessions", async (directory?: string) =>
    unwrap<SessionInfo>(await service.get("/api/session", locationQuery(directory))),
  )

  handle<SessionInfo>("api:createSession", async (input: {
    title?: string
    directory?: string
    agent?: string
    model?: ModelRef
  }) => {
    const body: Record<string, unknown> = {}
    if (input.title) body.title = input.title
    if (input.directory) body.location = { directory: input.directory }
    if (input.agent) body.agent = input.agent
    // Without a model the server picks its own default, which may be
    // region-locked, so always pin the one chosen in OCD.
    if (input.model) body.model = input.model
    return service.post<SessionInfo>("/api/session", body)
  })

  handle<SessionInfo>("api:session", (id: string) => service.get(`/api/session/${id}`))
  handle<unknown>("api:deleteSession", (id: string) => service.del(`/api/session/${id}`))
  handle<unknown>("api:renameSession", (id: string, title: string) =>
    service.patch(`/api/session/${id}`, { title }),
  )

 handle<unknown>(
    "api:prompt",
    (
      sessionId: string,
      input: { text: string; agent?: string; files?: PromptFile[]; delivery?: PromptDelivery },
    ) => {
      const body: Record<string, unknown> = { text: input.text }
      // Agents are attached as objects: { name }, never bare strings.
      // The body rejects unknown keys, so the model must not be sent here —
      // it is pinned on the session instead.
      if (input.agent) body.agents = [{ name: input.agent }]
      // `steer` folds this into the running turn, `queue` holds it until the
      // turn ends. Omitted leaves the decision to the server's own default.
      if (input.delivery) body.delivery = input.delivery
      if (input.files?.length) {
        // Only the keys that are set: the schema forbids the rest, so an explicit
        // `name: undefined` would be rejected rather than ignored.
        body.files = input.files.map((file) => ({
          uri: file.uri,
          ...(file.name ? { name: file.name } : {}),
          ...(file.description ? { description: file.description } : {}),
        }))
      }
      return service.post(`/api/session/${sessionId}/prompt`, body)
    },
  )

  handle<unknown>("api:setSessionModel", (sessionId: string, model: ModelRef) =>
    service.post(`/api/session/${sessionId}/model`, { model }),
  )

  /**
   * The model history, page by page.
   *
   * The server's list is endless in both directions and hands back a cursor
   * for the page before the one it returned. The plain envelope is unwrapped
   * by the service, which would throw the cursor away, so this asks for the
   * raw body and picks the two pieces apart itself.
   */
  handle<MessagePage>("api:messagePage", async (sessionId: string, page?: MessagePageQuery) => {
    const query: Record<string, string | number | undefined> = { limit: page?.limit ?? 100 }
    if (page?.cursor) query.cursor = page.cursor
    else if (page?.order) query.order = page.order
    const raw = await service.get<{ data?: unknown[]; cursor?: { previous?: string | null } }>(
      `/api/session/${sessionId}/message`,
      query,
      { raw: true },
    )
    const messages = Array.isArray(raw?.data) ? (raw.data as MessageInfo[]) : []
    return { messages, cursor: raw?.cursor?.previous ?? undefined }
  })

  handle<unknown>("api:setSessionAgent", (sessionId: string, agent: string) =>
    service.post(`/api/session/${sessionId}/agent`, { agent }),
  )

  handle<unknown>("api:compactSession", (sessionId: string) =>
    // `steer` runs the compaction at the next step boundary instead of
    // waiting behind queued prompts.
    service.post(`/api/session/${sessionId}/compact`, { delivery: "steer" }),
  )

  handle<SessionInfo>("api:forkSession", (sessionId: string, before?: string) =>
    service.post(`/api/session/${sessionId}/fork`, before ? { before } : {}),
  )

  handle<unknown>("api:moveSession", (sessionId: string, directory: string) =>
    service.post(`/api/session/${sessionId}/move`, { directory }),
  )

  handle<unknown>("api:runSessionCommand", (sessionId: string, command: { name: string; text: string }) =>
    service.post(`/api/session/${sessionId}/command`, { name: command.name, text: command.text }),
  )

  handle<PermissionRule[]>("api:permissionRules", async (projectID?: string) => {
    const rules = await service.get<unknown>("/api/permission/saved", { projectID })
    return Array.isArray(rules) ? (rules as PermissionRule[]) : []
  })

  /**
   * The messages the model will read on the next turn.
   *
   * The app counts the context by itself, from the last answer's token
   * counts; the server knows better. After a compaction, in particular, the
   * difference is the whole point.
   */
  handle<{ count: number; tokens: number }>("api:sessionContext", async (sessionId: string) => {
    const messages = await service.get<MessageInfo[]>(
      `/api/session/${sessionId}/context`,
    )
    const list = Array.isArray(messages) ? messages : []
    let tokens = 0
    for (const message of list) {
      const usage = message.tokens
      if (!usage) continue
      tokens += (usage.input ?? 0) + (usage.output ?? 0) + (usage.reasoning ?? 0)
    }
    return { count: list.length, tokens }
  })

  /**
   * The sessions the server is working on right now.
   *
   * A turn started in another window — or in the OpenCode app itself — is
   * invisible here otherwise: the chat looks idle while the model is writing.
   */
  handle<Record<string, { type: string }>>("api:activeSessions", async () => {
    const active = await service.get<Record<string, { type: string }>>(
      "/api/session/active",
    )
    return active ?? {}
  })

  /** The server's own log of a session: what it was doing and why. */
  handle<string[]>("api:sessionLog", async (sessionId: string) => {
    try {
      const data = await service.get<unknown>(
        `/api/experimental/session/${sessionId}/log`,
      )
      if (Array.isArray(data)) return data.map((line) => String(line))
      if (typeof data === "string") return data.split(/\r?\n/)
      return []
    } catch {
      return []
    }
  })

  /** The resources the MCP servers publish. */
  handle<{ resources: string[]; templates: string[] }>("api:mcpResources", async () => {
    try {
      const body = await service.get<{ resources?: unknown[]; templates?: unknown[] }>(
        "/api/mcp/resource",
      )
      const resources = body?.resources ?? []
      const templates = body?.templates ?? []
      const names = (list: unknown[]) =>
        list
          .map((item) => {
            if (typeof item === "string") return item
            const row = item as { uri?: string; name?: string; server?: string }
            return row.uri ?? row.name ?? row.server ?? ""
          })
          .filter(Boolean)
      return { resources: names(resources), templates: names(templates) }
    } catch {
      return { resources: [], templates: [] }
    }
  })
  /**
   * Files of the project, by name.
   *
   * The server walks the tree itself: the app has no index of its own and no
   * way to keep one in step with the disk.
   */
  handle<FileEntry[]>("api:findFiles", async (query: string, directory?: string) => {
    const found = await service.get<unknown>("/api/fs/find", {
      query,
      limit: 50,
      ...(directory ? { "location[directory]": directory } : {}),
    })
    return Array.isArray(found) ? (found as FileEntry[]) : []
  })

  /** The branch the project is on. */
  handle<VcsBranch | null>("api:vcsBranch", async (directory?: string) => {
    try {
      const branch = await service.get<VcsBranch>("/api/vcs/branch", {
        ...(directory ? { "location[directory]": directory } : {}),
      })
      return branch ?? null
    } catch {
      // A folder that is not a repository has no branch, and that is not an
      // error worth a toast.
      return null
    }
  })

  /** What the project changed, per file. */
  handle<VcsFileStatus[]>("api:vcsStatus", async (directory?: string) => {
    try {
      const status = await service.get<VcsFileStatus[]>("/api/vcs/status", {
        ...(directory ? { "location[directory]": directory } : {}),
      })
      return Array.isArray(status) ? status : []
    } catch {
      return []
    }
  })

  /** The branch a folder is on, read from its own .git. */
  handle<string | null>("api:gitBranch", (directory?: string) => {
    if (!directory) return null
    return currentBranch(directory)
  })

  /**
   * What the project changed and what branch it is on.
   *
   * The server counts the changed files; the branch it can only list, so it
   * is read from the repository itself — the server's list of branches does
   * not say which one is checked out.
   */
  handle<{ branch: string | null; changed: number }>("api:gitStatus", async (directory?: string) => {
    const status = await service.get<VcsFileStatus[]>("/api/vcs/status", {
      ...(directory ? { "location[directory]": directory } : {}),
    })
    const changed = Array.isArray(status) ? status : []
    return {
      branch: directory ? currentBranch(directory) : null,
      changed: changed.length,
    }
  })

  /** The worktrees the server keeps for the projects. */
  handle<WorktreeInfo[]>("api:worktrees", async () => {
    const list = await service.get<unknown>("/api/worktree")
    return Array.isArray(list) ? (list as WorktreeInfo[]) : []
  })

  /**
   * Forget a permission the server remembered.
   *
   * There is no route for making one: the server saves a rule when the user
   * answers "always", and the app's only business here is to be able to
   * forget it again.
   */
  handle<unknown>("api:deletePermissionRule", (id: string) =>
    service.del(`/api/permission/saved/${id}`),
  )

  handle<ModelInfo | null>("api:serverDefaultModel", async () => {
    try {
      const body = (await service.get("/api/model/default")) as ModelInfo
      return body ?? null
    } catch {
      return null
    }
  })

  /**
   * Rewind the conversation to just before one of its messages.
   *
   * This is the "edit and resend" primitive: the server keeps a boundary at the
   * message, drops everything from it onwards, and lets the prompt be sent
   * again on a history that matches the new wording.
   *
   * Staging and committing are separate routes, and the gap matters — staging
   * alone leaves the boundary reversible, committing makes it final. Commit is
   * issued only after the stage succeeded, and a failed commit clears the stage
   * so a half-finished revert cannot linger and swallow the next one.
   *
   * `files` is deliberately not sent: the default leaves the working tree alone,
   * and a rewind of the text should not quietly undo files on disk.
   */
  handle<{ messageID: string }>("api:revert", async (sessionId: string, messageId: string) => {
    // The server spells the key `messageID`; the parameter is camelCase here.
    await service.post(`/api/session/${sessionId}/revert/stage`, { messageID: messageId })
    try {
      await service.post(`/api/session/${sessionId}/revert/commit`)
    } catch (err) {
      await service.del(`/api/session/${sessionId}/revert`).catch(() => undefined)
      throw err
    }
    return { messageID: messageId }
  })

  /** Drops a staged revert that was never committed. */
  handle("api:revertCancel", (sessionId: string) => service.del(`/api/session/${sessionId}/revert`))

  /**
   * Rewind to a message — but only look, do not touch anything yet.
   *
   * The server stages the rewind and answers with the files it would restore.
   * That is what makes the difference between "undo" and "undo, and here is
   * what it costs": a blind rewind can put a file back the way it was an hour
   * ago, and the person who asks for it cannot see that.
   */
  handle<{ messageID: string; files: FileDiffInfo[] }>(
    "api:revertStage",
    async (sessionId: string, messageId: string) => {
      const staged = await service.post<{ messageID?: string; files?: FileDiffInfo[] }>(
        `/api/session/${sessionId}/revert/stage`,
        { messageID: messageId },
      )
      return {
        messageID: staged?.messageID ?? messageId,
        files: staged?.files ?? [],
      }
    },
  )

  /** Apply a staged rewind. */
  handle<unknown>("api:revertCommit", (sessionId: string) =>
    service.post(`/api/session/${sessionId}/revert/commit`),
  )

  /**
   * Stop the turn this session is running.
   *
   * The server route is `/interrupt`; there is no `/abort`. With `resume` the
   * next queued prompt takes over instead of the session going idle, which is
   * what the stop button in a message wants when the user already typed the
   * follow-up.
   */
  handle<{ interrupted: boolean }>("api:interrupt", (sessionId: string, resume?: boolean) =>
    service.post<{ interrupted: boolean }>(`/api/session/${sessionId}/interrupt`, undefined, {
      resume: resume ? "true" : undefined,
    }),
  )

  // ---------- plugins ----------

  handle("plugins:list", () => listPlugins())
  handle("plugins:search", (query: string) => searchPlugins(query))
  handle("plugins:install", (pkg: string) => installPlugin(pkg))
  handle("plugins:uninstall", (id: string) => uninstallPlugin(id))
 handle("plugins:revealLocal", (dir: string) => {
    shell.showItemInFolder(dir)
  })

  // ---------- config file ----------

  handle("configFile:read", () => readConfig())
  handle("configFile:write", (text: string) => writeConfig(text))
  handle("configFile:reload", () => service.post("/api/location/reload"))
  handle("configFile:setReplyLanguage", (lang: ReplyLanguage) => {
    const result = setReplyLanguage(lang)
    if (!result.ok) throw new Error(result.error ?? "Не удалось записать конфиг")
    // Nudge the server so the new instruction applies to the next turn.
    void service.post("/api/location/reload").catch(() => undefined)
    return result
  })
  handle("configFile:replyLanguage", () => configReplyLanguage(readConfig().text))
  handle<boolean>("configFile:languageCurrent", (lang: ReplyLanguage) =>
    configLanguageCurrent(readConfig().text, lang),
  )
  /**
   * Move an instruction that was written as plain text into a real file.
   *
   * Runs on start rather than on demand: the broken state is invisible — the
   * setting reads "Русский" while the model answers in English — so nobody
   * would ever think to go and change it.
   */
  handle("configFile:repairLanguage", () => {
    const result = repairLegacyLanguageInstruction()
    if (result.ok) void service.post("/api/location/reload").catch(() => undefined)
    return result
  })
  handle("configFile:setProvider", (providerID: string, patch: ProviderInstall) => {
    const result = setConfigProvider(providerID, patch)
    if (!result.ok) throw new Error(result.error ?? "Не удалось записать конфиг")
    void service.post("/api/location/reload").catch(() => undefined)
    return result
  })
  handle("configFile:removeProvider", (providerID: string) => {
    const result = removeConfigProvider(providerID)
    if (!result.ok) throw new Error(result.error ?? "Не удалось записать конфиг")
    void service.post("/api/location/reload").catch(() => undefined)
    return result
  })
  handle("configFile:providers", () => configProvidersSummary(readConfig().text))
  handle<string>("configFile:path", () => configPath())

  // ---------- integrations: the server's own catalog ----------

  /**
   * Everything this server can connect to.
   *
   * 229 hosted providers with the methods each one supports. This is a far
   * better catalog than a hardcoded list of ids, because it comes from the
   * server that will have to talk to them: an id renamed upstream does not turn
   * into a dead entry here.
   */
  handle<IntegrationInfo[]>("integration:list", async () =>
    unwrap<IntegrationInfo>(await service.get("/api/integration")),
  )

  /**
   * Connect with an API key, storing the credential on the server.
   *
   * `answer` carries the method's extra form fields when it declares any, which
   * is how a method needing more than a key — a URL, an account id — is filled
   * in.
   */
  handle("integration:connectKey", async (
    integrationId: string,
    key: string,
    answer?: Record<string, string>,
    label?: string,
  ) => {
    await service.post(`/api/integration/${integrationId}/connect/key`, { key, answer, label })
  })

  /**
   * Begin an OAuth attempt.
   *
   * Returns where to send the user and, for the code flow, how long the code
   * stays valid. Nothing is stored yet — the credential appears only once the
   * attempt completes, so a cancelled login leaves nothing behind.
   */
  handle<IntegrationAttempt>("integration:oauthBegin", async (
    integrationId: string,
    methodId: string,
    answer?: Record<string, string>,
    label?: string,
  ) =>
    unwrapOne<IntegrationAttempt>(
      await service.post(`/api/integration/${integrationId}/connect/oauth`, {
        methodID: methodId,
        answer,
        label,
      }),
    ),
  )

  /** Poll an attempt: pending, then complete, failed or expired. */
  handle<AttemptStatus>("integration:oauthStatus", async (integrationId: string, attemptId: string) =>
    unwrapOne<AttemptStatus>(
      await service.get(`/api/integration/${integrationId}/connect/oauth/${attemptId}`),
    ),
  )

  /** Finish a code flow by handing back the code the user pasted. */
  handle("integration:oauthComplete", (integrationId: string, attemptId: string, code?: string) =>
    service.post(`/api/integration/${integrationId}/connect/oauth/${attemptId}/complete`, { code }),
  )

  /** Abandon an attempt so the server releases its resources. */
  handle("integration:oauthCancel", (integrationId: string, attemptId: string) =>
    service.del(`/api/integration/${integrationId}/connect/oauth/${attemptId}`),
  )

  /**
   * Ask a local runtime what it has.
   *
   * Runs in main because a renderer fetch to 127.0.0.1 is a cross-origin
   * request that the page will refuse or hang on, and because a runtime that is
   * simply not running must not raise an unhandled rejection in the page.
   */
  handle<LocalRuntimeStatus>("integration:probe", (baseURL: string) => probeRuntime(baseURL))

  // ---------- local models ----------

  /** Engines that can be asked for models; the UI offers only these. */
  handle("model:engines", () => ENGINES.map(({ id, label, baseURL }) => ({ id, label, baseURL })))

  /** What one engine has on disk. */
  handle("model:list", async (engineId: string) => {
    const engine = requireEngine(engineId)
    return engineModels(engine)
  })

  /**
   * Download a model.
   *
   * Nothing is fetched without this call: a model is downloaded because the
   * user typed its name and pressed the button, never because it turned up in a
   * catalog or because a provider appeared.
   */
  handle<string>("model:pull", (engineId: string, model: string) => {
    const engine = requireEngine(engineId)
    const name = model.trim()
    if (!name) throw new Error("Имя модели не указано")
    return pullModel(engine, name, broadcastPullProgress)
  })

  /** Stop a download in flight. */
  handle<boolean>("model:pullCancel", (jobId: string) => cancelJob(jobId))

  /** Remove a downloaded model. */
  handle("model:delete", async (engineId: string, model: string) => {
    const engine = requireEngine(engineId)
    await deleteModel(engine, model)
  })

  // ---------- what this machine can hold ----------

  /**
   * Memory, video memory and free disk.
   *
   * Read once and reused: the fit pills in the catalog all judge against the
   * same numbers, and shelling out to nvidia-smi per row would be absurd.
   */
  handle<HardwareFacts>("local:hardware", () => probeHardware())

  /**
   * Search Hugging Face for models this app can download.
   *
   * Public endpoints, no token: a repository search filtered to GGUF, and the
   * per-file sizes of one repository. The sizes are what make a fit verdict
   * possible before anything is fetched.
   */
  handle<RepoHit[]>("local:searchRepos", (query: string, limit?: number) =>
    searchRepos(query, limit ?? 20),
  )
  handle<FileGroup[]>("local:repoFiles", (repo: string) => repoFiles(repo))

  // ---------- attachments ----------

  handle("attachments:pick", (kind: "image" | "file") =>
    pickAttachments(getWindow(), kind),
  )
  handle("attachments:fromClipboard", () => attachmentFromClipboard())
  handle("attachments:fromPaths", (paths: string[]) => attachmentsFromPaths(paths))
  handle("attachments:fromDataUrl", (dataUrl: string, nameHint?: string) =>
    attachmentFromDataUrl(dataUrl, nameHint),
  )

  // ---------- request limits ----------

  handle<RequestLimits>("limits:snapshot", (model: string) => snapshot(model))
  handle<RequestLimits>("limits:set", (model: string, window: LimitWindow, limit: number | null) =>
    setLimit(model, window, limit),
  )
  handle<boolean>("limits:clear", (model?: string) => {
    clearRequestLedger(model)
    return true
  })

  // ---------- diagnostics ----------

  /**
   * The renderer's uncaught errors, written next to main's.
   *
   * A throw inside a React event handler only ever shows a console nobody has
   * open; without this the one failure mode that a user can describe — "it just
   * closed" — leaves no trace in the app itself.
   */
  handle<boolean>("diag:report", (payload: { message: string; stack?: string; kind?: string }) => {
    log.error(`renderer ${payload.kind ?? "error"}: ${payload.message}`, payload.stack)
    return true
  })

  // ---------- feedback ----------

  /**
   * Whether this build has somewhere to send to.
   *
   * Asked once by the About screen so it can either show the form or say that
   * there is none, rather than offering a button that fails when it is pressed.
   */
  handle<boolean>("feedback:configured", () => backendConfigured())

  /**
   * What someone typed into the feedback card.
   *
   * The rejection is the sentence to show: `sendFeedback` throws with wording
   * meant for the screen, and the envelope below carries it through untouched.
   */
  handle<boolean>("feedback:send", async (input: FeedbackInput) => {
    await sendFeedback(input)
    return true
  })

  // ---------- context menu ----------

  handle("menu:contextMenu", (target: ContextTarget, messageId?: string) =>
    showContextMenu(getWindow(), target, messageId),
  )

  // ---------- preview pane ----------

  handle<string>("preview:writeTemp", (html: string) => writePreviewFile(html))
  handle("preview:open", (path: string) => preparePreview(path))
  handle<boolean>("preview:openExternal", (url: string) => openPreviewExternal(url))

  // ---------- voice ----------

  // One dictation take at a time; the transcript arrives as an event.
  let dictationRun: Promise<unknown> | null = null
  /** Bumped on every start and every cancel; see the start handler. */
  let dictationGeneration = 0

  handle("voice:defaults", () => voice.defaults())
  handle("voice:devices", () => voice.devices())
  handle("voice:voices", () => voice.voices())
  handle("voice:speak", (text: string) =>
    voice.speak(text, {
      engine: getSettings().ttsEngine as VoiceDefaults["engine"],
      voice: getSettings().ttsVoice,
      rate: getSettings().ttsRate,
      volume: getSettings().ttsVolume,
      pitch: getSettings().ttsPitch,
      maxChars: getSettings().ttsMaxChars,
      playbackVolume: getSettings().playbackVolume,
    }),
  )
  handle("voice:stopSpeaking", () => voice.stopPlayback())

  handle<{ ok: boolean; error?: string }>("voice:startDictation", () => {
    if (dictationRun) return { ok: false, error: "Диктовка уже идёт" }
    // The generation is what tells a late result from a run nobody wants
    // any more. Without it the promise of a cancelled recording still lands
    // in the chat, and its `finally` clears the handle of the *next* run.
    const generation = ++dictationGeneration
    broadcastVoiceState({ dictation: "recording" })
    dictationRun = voice
      .startDictation(
        (state) => broadcastVoiceState({ dictation: state }),
        {
          sttModel: getSettings().sttModel,
          sttLanguage: getSettings().sttLanguage,
          micDevice: getSettings().micDevice,
        },
      )
      .then((result) => {
        if (generation !== dictationGeneration) return result
        broadcastVoiceState({ dictation: "idle" })
        for (const win of getWindows()) {
          if (!win.isDestroyed()) win.webContents.send("ocd:dictation", result)
        }
        return result
      })
      .catch((err: unknown) => {
        if (generation === dictationGeneration) {
          broadcastVoiceState({ dictation: "idle", error: String(err) })
        }
        return { ok: false, error: String(err) }
      })
      .finally(() => {
        // Only the run that is still current may clear the handle: a cancel
        // cleared it already, and a newer run may own it now.
        if (generation === dictationGeneration) dictationRun = null
      })
    return { ok: true }
  })

  handle("voice:stopDictation", () => {
    // Nothing was recording, so there is nothing to transcribe. Saying
    // "transcribing" anyway left the state stuck there for good: no run
    // finished, so nobody sent the "idle" back.
    if (!dictationRun) return
    broadcastVoiceState({ dictation: "transcribing" })
    voice.stopDictation()
  })

  handle("voice:cancelDictation", () => {
    // The generation goes up first: whatever the recording process reports
    // from here on belongs to a run nobody is waiting for.
    dictationGeneration++
    voice.cancelDictation()
    dictationRun = null
    broadcastVoiceState({ dictation: "idle" })
  })

  // ---------- the project's files ----------

  /**
   * What the repository itself says it changed.
   *
   * The agent's own diff is what the conversation did; this is what the
   * working tree looks like to git — the changes that are waiting to be
   * committed, including the ones nobody made in this window.
   *
   * The modes are the server's: the working tree, a branch against its base,
   * and what is already committed.
   */
  handle<FileDiffInfo[]>("api:vcsDiff", async (
    mode: "working" | "branch" | "committed",
    directory?: string,
    base?: string,
  ) => {
    const body = await service.get<unknown>("/api/vcs/diff", {
      ...locationQuery(directory),
      mode,
      ...(base ? { base } : {}),
    })
    return unwrap<FileDiffInfo>(body)
  })

  /**
   * One directory of the project, as the server sees it.
   *
   * The server reads the filesystem for the project the conversation runs in,
   * and it knows where that project is — which the window does not. The app
   * asks for a directory and gets the entries back with their paths.
   */
  handle<FileEntry[]>("api:fsList", async (path?: string, directory?: string) => {
    const body = await service.get<unknown>("/api/fs/list", {
      ...locationQuery(directory),
      ...(path ? { path } : {}),
    })
    return unwrap<FileEntry>(body)
  })

  /**
   * The contents of one file.
   *
   * The path goes into the URL rather than into a query: the route is
   * `/api/fs/read/*`, and the star is the path.
   */
  handle<string>("api:fsRead", async (path: string, directory?: string) => {
    const encoded = path
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/")
    const body = await service.get<unknown>(`/api/fs/read/${encoded}`, locationQuery(directory))
    return typeof body === "string" ? body : String((body as { data?: unknown })?.data ?? body)
  })

  // ---------- the server's own capabilities ----------

  /** Which web search provider answers for the server. */
  handle<WebSearchProvider[]>("api:websearchProviders", async (directory?: string) => {
    const body = await service.get<unknown>("/api/websearch/provider", locationQuery(directory))
    return unwrap<WebSearchProvider>(body)
  })

  /** What the server counts for a stretch of time. */
  handle<SessionStats>("api:sessionStats", async (from?: number, to?: number, project?: string) => {
    const body = await service.get<{ data?: SessionStats } | SessionStats>("/api/experimental/session/stats", {
      ...(from !== undefined ? { from: String(from) } : {}),
      ...(to !== undefined ? { to: String(to) } : {}),
      ...(project ? { project } : {}),
    })
    return ("data" in (body as { data?: SessionStats }) ? (body as { data: SessionStats }).data : body) as SessionStats
  })

  // ---------- one conversation, on the server's side ----------

  /**
   * The variables the agent's commands run with.
   *
   * A conversation of its own, so a key that belongs to this project does not
   * have to be written into the machine's environment for every other
   * conversation.
   */
  handle<unknown>("api:sessionEnvironment", (sessionId: string, variables: Record<string, string>) =>
    service.put(`/api/session/${sessionId}/environment`, { variables }),
  )

  /**
   * Send the blocking tools to the background.
   *
   * A long tool call then does not hold the turn: the answer arrives when it
   * is ready, and the conversation keeps taking messages meanwhile.
   */
  handle<unknown>("api:sessionBackground", (sessionId: string) =>
    service.post(`/api/session/${sessionId}/background`),
  )

  /** The instructions this conversation carries. */
  handle<InstructionEntry[]>("api:sessionInstructions", async (sessionId: string) => {
    const body = await service.get<unknown>(`/api/experimental/session/${sessionId}/instructions/entries`)
    return unwrap<InstructionEntry>(body)
  })

  /** Add or change one of them. */
  handle<unknown>("api:sessionInstructionPut", (sessionId: string, key: string, value: unknown) =>
    service.put(`/api/experimental/session/${sessionId}/instructions/entries/${encodeURIComponent(key)}`, { value }),
  )

  /** Forget one of them. */
  handle<unknown>("api:sessionInstructionRemove", (sessionId: string, key: string) =>
    service.del(`/api/experimental/session/${sessionId}/instructions/entries/${encodeURIComponent(key)}`),
  )

  // ---------- the MCP servers ----------

  /** Add or change one MCP server's configuration. */
  handle<unknown>("api:mcpSet", (server: string, config: Record<string, unknown>, directory?: string) =>
    service.put(`/api/experimental/mcp/${encodeURIComponent(server)}`, { config }, locationQuery(directory)),
  )

  /** Remove one MCP server. */
  handle<unknown>("api:mcpRemove", (server: string, directory?: string) =>
    service.del(`/api/experimental/mcp/${encodeURIComponent(server)}`, locationQuery(directory)),
  )

  /** Ask the server to start talking to one of its servers. */
  handle<unknown>("api:mcpConnect", (server: string, directory?: string) =>
    service.post(`/api/experimental/mcp/${encodeURIComponent(server)}/connect`, undefined, locationQuery(directory)),
  )

  /** Ask the server to stop talking to one of its servers. */
  handle<unknown>("api:mcpDisconnect", (server: string, directory?: string) =>
    service.post(`/api/experimental/mcp/${encodeURIComponent(server)}/disconnect`, undefined, locationQuery(directory)),
  )

  /**
   * The whole transcript of one conversation.
   *
   * The chat reads it a page at a time, because that is what it shows. A
   * comparison of two conversations needs both of them whole, so this route
   * asks for everything at once.
   */
  handle<MessageInfo[]>("api:sessionMessages", async (sessionId: string) => {
    const body = await service.get<unknown>(`/api/session/${sessionId}/message`, { limit: 500 })
    const list = Array.isArray(body) ? body : ((body as { data?: unknown[] }).data ?? [])
    return list as MessageInfo[]
  })

  // ---------- checkpoints ----------
  /** The snapshots this machine holds. */
  handle<Checkpoint[]>("app:checkpoints", () => listCheckpoints())

  /** Take a snapshot of the changed files. */
  handle<Checkpoint>("app:checkpointSave", (directory?: string) =>
    saveCheckpoint(directory ?? ""),
  )

  /** Put the files of a snapshot back. */
  handle<{ restored: number }>("app:checkpointRestore", (id: string) => restoreCheckpoint(id))

  /** Forget a snapshot. */
  handle<boolean>("app:checkpointDelete", (id: string) => deleteCheckpoint(id))

  // ---------- pairing a device ----------

  /**
   * A short-lived code another device can be paired with.
   *
   * The server hands out a code and a link that redeems it; a phone that opens
   * the link becomes another client of the same server. The code is single-use
   * and expires, which is why it is made on demand and not kept.
   */
  handle<{ code: string; expires_in: number }>("api:pair", async () => {
    const body = await service.post<{ data?: { code: string; expires_in: number } }>("/api/pair")
    const pair = (body as { data?: { code: string; expires_in: number } }).data ?? (body as never)
    if (!pair?.code) throw new Error("Сервер не выдал код сопряжения")
    return { code: pair.code, expires_in: pair.expires_in }
  })

  // ---------- app ----------
  handle<AppSettings>("app:getSettings", () => getSettings())
  handle<AppSettings>("app:setSettings", (patch: Partial<AppSettings>) => {
    const before = getSettings()
    const next = setSettings(patch)
    // The material is a property of the native window, so the renderer cannot
    // change it on its own — it has to be re-applied here, and only when the
    // backdrop actually changed.
    if (before.blurBehind !== next.blurBehind || before.backdrop !== next.backdrop) {
      refreshBackdrop()
    }
    return next
  })

  handle("app:version", () => ({
    // `app.getVersion()` is the packaged build's own version, read from the
    // executable. `npm_package_version` only exists when npm started the
    // process, so asking for it here reported "0.0.0" in every real install -
    // the About screen and every bug report about the version with it.
    app: app.getVersion() || process.env.npm_package_version || "0.0.0",
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  }))

  handle("app:minimize", () => getWindow()?.minimize())
  handle<boolean>("app:toggleMaximize", () => {
    const win = getWindow()
    if (!win) return false
    if (win.isMaximized()) {
      win.unmaximize()
      return false
    }
    win.maximize()
    return true
  })
  handle("app:close", () => getWindow()?.close())
 handle("app:setAlwaysOnTop", (value: boolean) => {
    getWindow()?.setAlwaysOnTop(value, "screen-saver")
    getWindow()?.setVisibleOnAllWorkspaces(value)
  })

  handle("app:openExternal", async (url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error("Only http(s) URLs are allowed")
    await shell.openExternal(url)
  })

  handle<string>("app:openPath", (target: string) => shell.openPath(target))

  // ---------- the log, read from the app itself ----------

  /**
   * The tail of the app's own log.
   *
   * Everything the app swallows quietly — a failed request, a broken preview —
   * ends up here. The user asked for a problem, and the answer is in the file:
   * showing it beats sending them to look for it.
   */
  handle<string[]>("diag:tail", (lines?: number) => readLogTail(lines ?? 400))

  /** The folder the log lives in, for the "open the folder" button. */
  handle<string | null>("diag:folder", () => logFolder())

  // ---------- remote (SSH) ----------

  /**
   * Bring up a tunnel to a remote OpenCode and adopt it as the endpoint.
   *
   * On success the settings are written too, so a restart reconnects without
   * the user pressing the button again — a tunnel that silently dies on
   * relaunch is worse than one that never existed.
   */
  handle<{ url: string; port: number }>("remote:connect", async (target: {
    host: string
    remotePort: number
    localPort?: number
    remember?: boolean
  }) => {
    const tunnel = await sshTunnel.open({
      host: target.host,
      remotePort: target.remotePort,
      localPort: target.localPort,
    })

    setSettings({ serverUrlOverride: tunnel.url })
    service.setOverride(tunnel.url)
    // The old stream is still pointed at the local server. It has to go before
    // the new one is started, and the new one has to be started after — the
    // stream follows the endpoint, so a tunnel that is adopted without this
    // leaves the chat listening to the server it just left.
    service.stopEventStream()
    const status = await service.connect(tunnel.url)
    if (status.connected) service.startEventStream()

    if (target.remember === false) setSettings({ serverUrlOverride: "" })
    return { url: tunnel.url, port: tunnel.localPort }
  })

  handle("remote:disconnect", async () => {
    sshTunnel.close()
    setSettings({ serverUrlOverride: "" })
    service.stopEventStream()
    const status = await service.connect()
    if (status.connected) service.startEventStream()
  })

  handle<{ active: boolean; url: string | null }>("remote:status", () => ({
    active: Boolean(sshTunnel.active()),
    url: sshTunnel.active()?.url ?? null,
  }))

// ---------- heads-up display ----------

  /**
   * The HUD mirrors what the app is doing, and only main knows both halves of
   * that (service status from the server, busy sessions from the windows). So
   * main asks every window for its busy set and republishes the merge to the
   * strip, instead of every window writing to the HUD itself.
   */
  handle("hud:request", () => {
    void collectHudState()
  })

  /**
   * Called by main through executeJavaScript (see collectHudState), which runs
   * in the page's own world — so it reads the globals the renderer publishes
   * rather than anything behind the context bridge.
   */
  handle("hud:push", (state: HudState) => setHudData(state))

  handle<boolean>("hud:toggle", () => toggleHud())

// ---------- full-text search ----------

/**
 * The session list main knows about.
 *
 * The search index is keyed by the server's own sessions, so the list that
 * decides what is searched comes from the server too — not from the window
 * that happens to be asking.
 */
let knownSessions: SessionInfo[] = []

async function fetchSessions(): Promise<SessionInfo[]> {
  const sessions = unwrap<SessionInfo>(await service.get("/api/session"))
  return Array.isArray(sessions) ? sessions : []
}

  /** Build the index in the background; resolves when it is usable. */
  handle<{ sessions: number }>("search:build", async (force = false) => {
    knownSessions = await fetchSessions()
    pruneIndex(knownSessions)
    await ensureIndex(knownSessions, force)
    return { sessions: indexSize() }
  })

  handle<SearchHit[]>("search:query", async (query: string) => {
    // The list is usually already known from the build. When it is not — the
    // index was restored from disk and no search ran yet — it is fetched once
    // and kept, rather than asked for on every keystroke.
    if (knownSessions.length === 0) {
      try {
        knownSessions = await fetchSessions()
      } catch {
        /* the index alone still answers, just without fresh titles */
      }
    }
    return search(query, knownSessions)
  })

 /** Renderer asked for a toast because a turn ended out of sight. */
  handle<boolean>("notify:finish", (notice: FinishNotice) => {
    const owner = getWindow()
    flashTaskbar(owner, notice.failed)
    // The corner card is the one that names the conversation and shows the
    // answer, and it is worth showing even to someone reading it. The system
    // toast is the loud one, so it waits for a window that is not in front.
    showFinishNotice(notice)
    if (notice.focused) return true
    return notifyFinish(notice, owner)
  })

  /**
   * A toast the user asked for in advance.
   *
   * The rule's own switch decides this, not the general one: a rule that
   * never fires because a different switch is off is not a rule.
   */
  handle<boolean>("notify:rule", (notice: { title: string; body: string }) => {
    const owner = getWindow()
    flashTaskbar(owner, false)
    return notifyRule(notice, owner)
  })

  /** The card was clicked: bring that conversation forward. */
  handle<boolean>("notice:dismiss", (sessionId: string) => {
    dismissNotice(sessionId)
    return true
  })

  /**
   * Re-run one of the agent's commands in a visible terminal.
   *
   * The point is to hand the command to the terminal the user already has,
   * rather than to grow a second one inside the app: their profiles, fonts and
   * history all keep working, and nothing new can break.
   */
  handle("shell:openTerminal", ({ command, cwd }: { command: string; cwd?: string }) =>
    openInTerminal(command, cwd),
  )

  /**
   * Run a command once and bring back its verdict.
   *
   * The caller is the verify-after-done check: it wants an exit code and, on
   * failure, the lines that explain it — not a stream to render. The command
   * comes from the user's own settings, so there is nothing to sanitise here;
   * what matters is that a failure is reported, never swallowed.
   */
  handle<RunResult>(
    "shell:run",
    ({ command, cwd, timeoutMs }: { command: string; cwd?: string; timeoutMs?: number }) =>
      runCommand(command, cwd, timeoutMs ?? 120_000),
  )

  /** System print dialog for the current conversation. */
  handle<{ ok: boolean; canceled?: boolean; error?: string }>("print:conversation", async (payload: ExportPayload) =>
    printConversation(payload, getWindow(), conversationHtml(payload)),
  )

  /** Permissions the server is blocked on. An empty list means none waiting. */
  handle<PermissionRequest[]>("permission:list", async (directory?: string) =>
    unwrap<PermissionRequest>(
      await service.get(
      `/api/permission/request`,
      directory ? { "location[directory]": directory } : undefined,
    ),
    ),
  )

  /**
   * Answer a pending permission request.
   *
   * The contract comes from the bundled server client: POST on the request
   * path with body { decision, message } and a 204 on success. A wrong
   * `decision` is rejected with 400 before the lookup, so the accepted set is
   * exactly once | always | reject - allow and deny are not valid values.
   */
  handle("permission:reply", async (
    sessionId: string,
    requestId: string,
    decision: PermissionDecision,
    message?: string,
  ) => {
    await service.post(`/api/session/${sessionId}/permission/${requestId}/reply`, { decision, message })
  })

  /**
   * Questions the model is waiting on.
   *
   * These are not tool calls the server replays — a tool that asks something
   * creates a form, and the turn stays blocked until the form is settled. The
   * list endpoint is per session, which is why the renderer polls the session
   * it is showing rather than the whole workspace.
   */
  handle<PendingForm[]>("form:list", async (sessionId: string) =>
    unwrap<PendingForm>(await service.get(`/api/session/${sessionId}/form`)),
  )

  /** Answers a pending question; 204 with no body on success. */
  handle("form:reply", async (sessionId: string, formId: string, answer: FormAnswer) => {
    await service.post(`/api/session/${sessionId}/form/${formId}/reply`, { answer })
  })

  /** Drops a question without answering, so the turn can move on. */
  handle("form:cancel", async (sessionId: string, formId: string) => {
    // The route takes no body; the optional "why" is not part of the contract.
    await service.del(`/api/session/${sessionId}/form/${formId}`)
  })

  handle<string | null>("app:pickDirectory", async () => {
    const win = getWindow()
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ["openDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory"] })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  // ---------- session inbox (the server's own queue) ----------

  /**
   * Waiting items, flattened to what the queue bar needs.
   *
   * The inbox also carries compaction and move items, which are the server's
   * own housekeeping; beside a sentence somebody typed they would read as
   * noise, so they are left out. Normalised here rather than in the renderer
   * because this is the boundary where the server's shape stops.
   */
  function toInboxItems(raw: unknown): InboxItem[] {
    if (!Array.isArray(raw)) return []
    const items: InboxItem[] = []
    for (const entry of raw) {
      const item = entry as Record<string, unknown>
      if (item.type !== "user") continue
      const payload = (item.payload ?? {}) as Record<string, unknown>
      const time = (item.time ?? {}) as Record<string, unknown>
      const id = typeof item.id === "string" ? item.id : ""
      if (!id) continue
      items.push({
        id,
        createdAt: typeof time.created === "number" ? time.created : 0,
        delivery: item.delivery === "steer" ? "steer" : "queue",
        text: typeof payload.text === "string" ? payload.text : "",
        files: Array.isArray(payload.files)
          ? (payload.files as InboxItem["files"])
          : [],
      })
    }
    return items
  }

  handle<InboxItem[]>("inbox:list", async (sessionId: string) => {
    const list = await service.get<unknown>(`/api/session/${sessionId}/inbox`)
    return toInboxItems(list)
  })

  handle<boolean>("inbox:cancel", async (sessionId: string, inboxId: string) => {
    await service.del(`/api/session/${sessionId}/inbox/${inboxId}`)
    return true
  })

  handle<boolean>("inbox:delivery", async (
    sessionId: string,
    inboxId: string,
    delivery: PromptDelivery,
  ) => {
    await service.patch(`/api/session/${sessionId}/inbox/${inboxId}`, { delivery })
    return true
  })

  // ---------- settings transfer ----------

  /**
   * Hand the settings over as a file.
   *
   * They otherwise die with the machine: the JSON in the Windows profile is the
   * only copy, and a folder of sources says nothing about how the app was
   * configured on it.
   */
  handle<string>("settings:export", async () => {
    const win = getWindow()
    const options = {
      defaultPath: "ocd-settings.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    }
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return ""
    return exportSettings(result.filePath)
  })

  handle<AppSettings>("settings:import", async () => {
    const win = getWindow()
    const options = {
      properties: ["openFile" as const],
      filters: [{ name: "JSON", extensions: ["json"] }],
    }
    const result = win
      ? await dialog.showOpenDialog(win, { ...options, properties: ["openFile"] })
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return getSettings()
    return importSettings(result.filePaths[0])
  })

  // ---------- tray, hotkey, session windows ----------

  /**
   * The renderer is the only place that knows the session list, so it pushes a
   * trimmed snapshot here whenever it changes and main keeps the menu current.
   */
  handle("app:trayState", (next: {
    recent?: Array<{ id: string; title: string }>
    connected?: boolean
    visible?: boolean
    language?: ReturnType<typeof currentLanguage>
  }) => {
    updateTrayState({
      ...(next.recent ? { recent: next.recent.slice(0, 10) } : {}),
      ...(typeof next.connected === "boolean" ? { connected: next.connected } : {}),
      ...(typeof next.visible === "boolean" ? { visible: next.visible } : {}),
      ...(next.language ? { language: next.language } : {}),
    })
  })

  handle<boolean>("app:showWindow", () => {
    const win = getWindow()
    if (!win) return false
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    updateTrayState({ visible: true })
    return true
  })

 /** Reveal the window and let the renderer put the caret in the composer. */
  handle("app:focusComposer", () => {
    const win = getWindow()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    win.webContents.send("ocd:command", { kind: "focus-composer" })
  })

  handle<boolean>("app:openSessionWindow", (sessionId: string, title?: string | null) => {
    if (!sessionId) return false
    openSessionWindow(sessionId, title ?? null)
    return true
  })

  /**
   * Claim or release the global hotkey. The renderer calls this right after
   * writing the setting so the two never disagree; a taken key is reported
   * back rather than swallowed.
   */
  handle<{ ok: boolean; error?: string }>("app:setGlobalHotkey", (accelerator: string) => {
    const result = registerGlobalHotkey((accelerator ?? "").trim(), () => {
      const win = getWindow()
      if (!win) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      win.webContents.send("ocd:command", { kind: "focus-composer" })
    })
    if (result.ok) setSettings({ globalHotkey: (accelerator ?? "").trim() })
    return result
  })

  handle<{ ok: boolean; message: string }>("app:checkForUpdates", () => checkForUpdates())

  handle<{ ok: boolean; message: string }>("app:downloadUpdate", () => downloadUpdate())

  handle<{ ok: boolean; message: string }>("app:installUpdate", () => installUpdate())

  handle("app:updateState", () => updateState())

  handle("app:setAutoUpdate", (enabled: boolean) => {
    setSettings({ autoUpdate: enabled })
    if (enabled) setAutoUpdate(true)
    return getSettings().autoUpdate
  })

  handle("app:exportConversation", async (payload: {
    sessionId: string
    title: string
    markdown: string
    format: "markdown" | "html" | "pdf"
    messages: number
  }) => {
    const result = await exportConversation(payload, getWindow())
    if (!result.ok && result.error) throw new Error(result.error)
    return result
  })

  handle<unknown>("app:saveText", async (payload: { name: string; content: string; ext: string }) => {
    const result = await saveText(payload, getWindow())
    if (!result.ok && result.error) throw new Error(result.error)
    return result
  })

  // ---------- stored credentials ----------

  /**
   * The keys the server keeps for the providers.
   *
   * The server answers with the secret itself, so the app shows only the tail
   * of it: a key on screen is a key in a screenshot.
   */
  handle<StoredCredential[]>("api:credentials", async () => {
    const list = await service.get<unknown>("/api/credential")
    const rows = Array.isArray(list) ? list : []
    return rows.map((row) => {
      const item = row as Record<string, unknown>
      const value = item.value as { type?: string; key?: string } | undefined
      const key = value?.key ?? ""
      return {
        id: String(item.id ?? ""),
        integrationID: String(item.integrationID ?? ""),
        label: String(item.label ?? item.integrationID ?? ""),
        active: item.active === true,
        type: value?.type ?? "key",
        // The last four characters are enough to tell two keys apart.
        tail: key.length > 4 ? key.slice(-4) : key,
      }
    })
  })

  /** Make a stored key the one in use for its provider. */
  handle<unknown>("api:activateCredential", (id: string) =>
    service.post(`/api/credential/${id}/activate`, {}),
  )

  /** Forget a stored key. */
  handle<unknown>("api:deleteCredential", (id: string) =>
    service.del(`/api/credential/${id}`),
  )
  /**
   * Save every conversation of a project as one file.
   *
   * The server exports a session at a time, and the point of this is to have
   * them together: an archive of a project that can be read elsewhere, or
   * handed to someone who has to see what happened.
   */
  handle("app:exportProjectSessions", async (directory?: string) => {
    const sessions = await service.get<unknown>(
      "/api/session",
      directory ? { "location[directory]": directory } : undefined,
    )
    const list = Array.isArray(sessions) ? sessions.slice(0, 50) : []
    const exported: unknown[] = []
    // A few at a time: fifty requests in a row would take a minute, and the
    // server answers them all the same way.
    for (let i = 0; i < list.length; i += 8) {
      const batch = list.slice(i, i + 8)
      const parts = await Promise.all(
        batch.map(async (session) => {
          const id = (session as { id?: string }).id
          if (!id) return null
          try {
            const data = await service.get<unknown>(
              `/api/experimental/session/${id}/export`,
            )
            return data ?? null
          } catch {
            // One session that will not export is not worth stopping for.
            return null
          }
        }),
      )
      for (const part of parts) if (part) exported.push(part)
    }
    return saveText(
      { name: "sessions", content: JSON.stringify({ sessions: exported }, null, 2), ext: "json" },
      getWindow(),
    )
  })

  // ---------- terminal ----------

  /** Run a command in the server's terminal and attach to it. */
  handle("pty:open", async (input: { command: string; args?: string[]; cwd?: string; title?: string }) =>
    openPty(input),
  )

  /** What the user typed in the terminal. */
  handle("pty:input", (id: string, data: string) => {
    writePty(id, data)
  })

  /** Stop the command. */
  handle("pty:close", async (id: string) => {
    await closePty(id)
  })

  /**
   * Save the conversation as the server's own file.
   *
   * The Markdown and PDF exports are for reading; this one is the session
   * itself, with its messages, and the server can take it back — which is the
   * only way to move a conversation between machines.
   */
  handle("app:exportSessionFile", async (sessionId: string, title: string) => {
    const data = await service.get<unknown>(
      `/api/experimental/session/${sessionId}/export`,
    )
    if (!data) throw new Error("The server returned an empty export")
    return saveText(
      { name: title || sessionId, content: JSON.stringify(data, null, 2), ext: "json" },
      getWindow(),
    )
  })

  /** Take a session file back and make a session of it. */
  handle("app:importSessionFile", async () => {
    const win = getWindow()
    const result = win
      ? await dialog.showOpenDialog(win, {
          properties: ["openFile"],
          filters: [{ name: "JSON", extensions: ["json"] }],
        })
      : await dialog.showOpenDialog({
          properties: ["openFile"],
          filters: [{ name: "JSON", extensions: ["json"] }],
        })
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true }
    const text = await readFile(result.filePaths[0], "utf8")
    const payload = JSON.parse(text) as { info?: unknown; messages?: unknown; location?: unknown }
    if (!payload.info || !Array.isArray(payload.messages)) {
      return { ok: false, error: "Not a session file" }
    }
    const created = await service.post<{ data?: { id?: string } }>(
      "/api/experimental/session/import",
      {
        info: payload.info,
        messages: payload.messages,
        ...(payload.location ? { location: payload.location } : {}),
      },
    )
    return { ok: true, id: created?.data?.id ?? "" }
  })
}

/** Forward server events and connection status to every open window. */
export function broadcastServiceEvents(getWindows: () => BrowserWindow[]): () => void {
  const onEvent = (payload: Record<string, unknown>) => {
    countModelRequest(payload)
    for (const win of getWindows()) {
      if (!win.isDestroyed()) win.webContents.send("ocd:event", payload)
    }
  }
  const onStatus = (status: ServiceStatus) => {
    for (const win of getWindows()) {
      if (!win.isDestroyed()) win.webContents.send("ocd:status", status)
    }
  }
  // The update arrow follows the state, not the other way round: main learns
  // about a new version the moment the check finds one, and the header should
  // not have to wait out a poll interval to show it.
  const onUpdate = (state: UpdateState) => {
    for (const win of getWindows()) {
      if (!win.isDestroyed()) win.webContents.send("ocd:update", state)
    }
  }
  service.on("event", onEvent)
  service.on("status", onStatus)
  updateEvents.on("state", onUpdate)
  return () => {
    service.off("event", onEvent)
    service.off("status", onStatus)
    updateEvents.off("state", onUpdate)
  }
}

/** How a provider phrases a refusal, across the SDKs OCD talks to. */
const RATE_LIMIT_TEXT = /rate.?limit|too many requests|429|quota|resource[_ ]exhausted/i

/** The model a step ran on, as "<provider>/<id>". */
function stepModel(data: Record<string, unknown>): string | null {
  const model = data.model as { providerID?: string; id?: string } | undefined
  if (!model?.providerID || !model.id) return null
  return `${model.providerID}/${model.id}`
}

/**
 * Feed the request ledger from the event stream.
 *
 * One `session.step.started` is one call to a model — a turn that reads five
 * files makes several, which is exactly what a per-request limit charges for.
 * A refusal mentioning a limit starts a cooldown, so the meter can say why it
 * is red instead of only showing a number that keeps climbing.
 *
 * Counting happens in main rather than in the window so that the tally
 * survives the chat being closed, and so that a turn started from another
 * window is counted too.
 */
function countModelRequest(event: Record<string, unknown>): void {
  const data = (event.data ?? {}) as Record<string, unknown>
  if (event.type === "session.step.started") {
    const model = stepModel(data)
    if (model) countRequest(model)
    return
  }
  if (event.type !== "session.error" && event.type !== "session.execution.failed") return
  const model = stepModel(data)
  if (!model) return
  const error = (data.error ?? {}) as Record<string, unknown>
  const text = [
    error.name,
    error.type,
    (error.data as Record<string, unknown> | undefined)?.message,
    error.message,
  ]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
  if (text && RATE_LIMIT_TEXT.test(text)) markRateLimited(model)
}

/**
 * Read finished assistant replies aloud when the user asked for it.
 * Text is accumulated per assistant message and spoken once the turn ends.
 */
export function startAutoSpeech(): () => void {
  let text = ""
  let muted = false

  const flush = () => {
    const spoken = text.trim()
    text = ""
    if (muted || !spoken) return
    const settings = getSettings()
    if (!settings.speakReplies) return
    muted = true
    void voice
      .speak(spoken, {
        engine: settings.ttsEngine as VoiceDefaults["engine"],
        voice: settings.ttsVoice,
        rate: settings.ttsRate,
        volume: settings.ttsVolume,
        pitch: settings.ttsPitch,
        maxChars: settings.ttsMaxChars,
        playbackVolume: settings.playbackVolume,
      })
      .catch(() => undefined)
      .finally(() => {
        muted = false
      })
  }

  const onEvent = (event: Record<string, unknown>) => {
    const data = (event.data ?? {}) as Record<string, unknown>
    switch (event.type) {
      case "session.step.started":
        text = ""
        break
      case "session.text.delta":
        text += String(data.delta ?? "")
        break
      case "session.text.ended":
        if (typeof data.text === "string" && data.text.length > text.length) {
          text = data.text
        }
        break
      case "session.execution.succeeded":
        flush()
        break
      case "session.execution.failed":
        text = ""
        break
      default:
        break
    }
  }

  service.on("event", onEvent)
  return () => {
    service.off("event", onEvent)
  }
}







