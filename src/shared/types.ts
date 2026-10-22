/** Shared types between main, preload and renderer. */

import type { PreparedPreview } from "./preview"

export type { PreparedPreview }

export interface ServiceStatus {
  connected: boolean
  url: string | null
  version: string | null
  pid: number | null
  /** Reason the last connect attempt failed, when not connected. */
  error: string | null
  /** Where the discovered service registration lives. */
  registrationFile: string | null
}

/** What the header's update arrow shows itself from. */
export interface UpdateState {
  /** A version has been found and nothing has been installed over it yet. */
  available: boolean
  version: string
  /** Downloaded and sitting in the updater cache, ready to install. */
  staged: boolean
}

export interface ProjectInfo {
  id: string
  canonical: string
  time?: { created?: number; updated?: number; active?: number }
}

export interface LocationInfo {
  directory?: string
  worktree?: string
  projectID?: string
}

export interface ModelRef {
  providerID: string
  id: string
  variant?: string
}

/**
 * One reasoning level of a model.
 *
 * The server offers them per model — `low`, `medium`, `high` and so on — and
 * each carries the settings the model expects, e.g. a reasoning effort.
 */
export interface ModelVariant {
  id: string
  settings?: Record<string, unknown>
}

export interface ModelInfo {
  id: string
  name?: string
  providerID?: string
  attachment?: boolean
  reasoning?: boolean
  temperature?: boolean
  tool_call?: boolean
  releaseDate?: string
  cost?: Record<string, unknown>
  limit?: { context?: number; output?: number }
  /** Reasoning levels the model offers, if it offers any. */
  variants?: ModelVariant[]
  /** Filled by OCD: computed "<providerID>/<modelID>" */
  ref?: string
}

export interface ProviderInfo {
  id: string
  name?: string
  env?: string[]
  authenticated?: boolean
  models?: Record<string, ModelInfo>
}

/** One rule of what an agent may do. */
export interface AgentPermission {
  action: string
  resource: string
  effect: "allow" | "ask" | "deny"
}

/**
 * What an agent is, in full.
 *
 * The list of agents carries only the name and the mode; the description and
 * the rights come from the agent itself, and they are the interesting part:
 * "may it write files" and "will it ask before reading .env" are questions a
 * person asks before choosing an agent, not after.
 */
export interface AgentDetails {
  id: string
  name: string
  description?: string
  mode?: string
  steps?: number
  permissions?: AgentPermission[]
}

export interface AgentInfo {
  id: string
  name: string
  mode?: string
  description?: string
  color?: string
  steps?: number
  hidden?: boolean
  model?: ModelRef
  tools?: Record<string, boolean>
  permission?: unknown
}

/** Prompt body attaches agents as objects, not bare strings. */
export interface AgentAttachment {
  name: string
}

export interface PluginEntry {
  id: string
  source: { type?: string; path?: string; [k: string]: unknown }
  features: Record<string, boolean>
  state: { status?: string; error?: string; [k: string]: unknown }
}

export interface McpServerInfo {
  id?: string
  name?: string
  status?: string
  error?: string
  transport?: { type?: string }
  tools?: Record<string, unknown>
  resources?: unknown[]
  prompts?: unknown[]
}

export interface SkillInfo {
  id: string
  name?: string
  description?: string
  path?: string
  scope?: string
}

export interface CommandInfo {
  name: string
  description?: string
  agent?: string
  template?: string
  subtask?: boolean
}

/** Visual shown in the chat while a turn is running. */
export type BusyAnimationKind = "off" | "matrix" | "aurora" | "scanlines" | "pulse" | "dots"

/** Language the model must answer in; "auto" leaves the decision to the model. */
export type ReplyLanguage = "ru" | "en" | "auto"

/** Interface language of the app itself. */
export type UiLanguage = "ru" | "en" | "de" | "fr" | "zh"

/**
 * What a note on the About screen is about.
 *
 * A wish and a complaint arrive at the author differently: the first is a
 * request for work, the second is something already broken. Everything else
 * falls into "other" rather than growing a new kind nobody reads.
 */
export type FeedbackKind = "wish" | "complaint" | "problem" | "other"

/** Native names — the picker stays readable whatever the current language is. */
export const UI_LANGUAGES: ReadonlyArray<{ code: UiLanguage; label: string }> = [
  { code: "ru", label: "Русский" },
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "zh", label: "中文" },
]

/** Credentials written into provider.<id> in opencode.jsonc. */
export interface ProviderInstall {
  apiKey?: string
  baseURL?: string
  npm?: string
}

export interface ConfigProviderSummary {
  id: string
  hasKey: boolean
  baseURL?: string
  npm?: string
}

/** A field of a connection method's form; the same shape as a question's. */
export interface MethodField {
  key: string
  title?: string
  description?: string
  type: string
  options?: Array<{ value: string; label: string; description?: string }>
  placeholder?: string
  default?: string
  hidden?: boolean
  /** String hint: `uri`, `email`, `date`. Decides the input's keyboard. */
  format?: "email" | "uri" | "date" | "date-time" | string
  minLength?: number
  maxLength?: number
  pattern?: string
  /** Show this field only when another field has the given value. */
  when?: Array<{ key: string; op: "eq" | "neq"; value: string }>
}

/** How one integration can be connected. */
export interface IntegrationMethod {
  type: "key" | "env" | "oauth" | "command"
  /** Present for named methods such as OAuth variants. */
  id?: string
  label?: string
  /** Environment variables this method reads. */
  names?: string[]
  form?: MethodField[]
}

/** A credential already held for an integration. */
export interface ConnectionInfo {
  type?: string
  status?: string
  label?: string
  [k: string]: unknown
}

export interface IntegrationInfo {
  id: string
  name: string
  methods: IntegrationMethod[]
  connections: ConnectionInfo[]
}

/** One OAuth attempt, from the moment it starts until it settles. */
export interface IntegrationAttempt {
  attemptID: string
  url: string
  instructions: string
  /** `auto` completes in the browser; `code` needs the code pasted back. */
  mode: "auto" | "code"
  time: { created: number; expires: number }
}

export type AttemptStatus =
  | { status: "pending" }
  | { status: "complete" }
  | { status: "failed"; message: string }
  | { status: "expired" }

/** One step of a model download, pushed from main as it happens. */
export interface PullProgress {
  /** Handle for cancelling this specific download. */
  id: string
  engine: string
  model: string
  /** 0..1, or null when the engine reports no sizes. */
  fraction: number | null
  /** Bytes, when the engine reports them. */
  total?: number
  done?: number
  status: "running" | "done" | "error" | "cancelled"
  message?: string
}

/** How a model of this size would run here. */
export type Fit = "fits-gpu" | "needs-ram" | "too-big"

/** What this machine can hold: memory, video memory, free disk. */
export interface HardwareFacts {
  /** Unified memory, where CPU and GPU share one pool. */
  uma: boolean
  vramTotalBytes: number
  /** Total less what the driver keeps; what a model may actually claim. */
  vramUsableBytes: number
  ramTotalBytes: number
  ramAvailableBytes: number
  diskFreeBytes: number
  gpuName?: string
  vramUsedBytes?: number
  vendor?: string
}

/** A Hugging Face repository that ships GGUF weights. */
export interface RepoHit {
  repo: string
  downloads: number
  likes: number
  updated: string
  /** Gated repositories need a token and cannot be fetched anonymously. */
  gated: boolean
}

/** One servable weight file, with split parts collapsed into a single entry. */
export interface FileGroup {
  /** Quantisation label, e.g. `Q4_K_M`; what a reader chooses by. */
  label: string
  paths: string[]
  totalBytes: number
}

/** What a probe found at a local runtime's port. */
export interface LocalRuntimeStatus {
  /** The port answered. */
  online: boolean
  /** How many models it reports, when it answered. */
  models?: number
  /** A sample, so the view can show what is there. */
  sample?: string[]
  /** Why the probe failed, when it did. */
  error?: string
}

export interface BusyAnimationSettings {
  kind: BusyAnimationKind
  /** 0.05 – 0.7: how strongly the animation is visible over the acrylic. */
  opacity: number
  /** 0.3 – 2.5: playback speed multiplier. */
  speed: number
  /** Hue in degrees, 0 – 360. Drives every effect. */
  hue: number
  /** Column width for the matrix effect, 8 – 28 px. */
  density: number
}

export interface SessionInfo {
  id: string
  title?: string
  slug?: string
  version?: string
  time?: { created?: number; updated?: number }
  model?: ModelRef
  /** The agent the session is pinned to. Empty means the server's own choice. */
  agent?: string
  location?: LocationInfo
  projectID?: string
  parentID?: string | null
}

/** One block of an assistant turn. */
export interface MessageContent {
  type: "text" | "reasoning" | "tool"
  text?: string
  /** Tool name. Older servers spelled it `tool`, current ones `name`. */
  tool?: string
  name?: string
  /** Tool call id; `callID` on older servers, `id` on current ones. */
  callID?: string
  id?: string
  state?: {
    status?: string
    title?: string
    input?: unknown
    output?: unknown
    /**
     * A shell result is a list of typed parts rather than a single string:
     * `{ type: "text", text: "..." }`. `output` stays empty for those, which is
     * why the stream reads the command's printing from here.
     */
    content?: unknown
    /**
     * What the call did, in the server's own words. A call that touched files
     * carries `files`, each with a real unified `patch` — the authoritative
     * diff, deletions included, which no client can reconstruct afterwards.
     */
    metadata?: ToolMetadata
    error?: string
    time?: { created?: number; completed?: number }
    [k: string]: unknown
  }
  metadata?: Record<string, unknown>
}

/** `state.metadata.files` as the server writes it. */
export interface ToolMetadata {
  files?: FileDiffInfo[]
  /** The server gave up on a very long patch; what is here is all there is. */
  truncated?: boolean
  [k: string]: unknown
}

/** One file a call changed, with the patch that changed it. */
export interface FileDiffInfo {
  file: string
  /** Unified diff, headers included, as the server computed it. */
  patch: string
  status?: "added" | "deleted" | "modified" | string
  additions?: number
  deletions?: number
}

export interface TokenUsage {
  input?: number
  output?: number
  reasoning?: number
  cache?: { read?: number; write?: number }
}

/** Messages are returned newest-first with a "type" discriminator. */
export interface MessageInfo {
  id: string
  type: "user" | "assistant" | "idle" | string
  time?: { created?: number; streamed?: number; completed?: number }
  /** Present on user turns. */
  text?: string
  /**
   * Files the user attached to this turn.
   *
   * Never set by the server — a prompt carries its attachments by name, not by
   * content — so this is filled in by the app that sent it. Optional for that
   * reason, and because history loaded from disk has no way to recover them.
   */
  attachments?: Attachment[]
  /** Present on assistant turns. */
  content?: MessageContent[]
  agent?: string
  model?: ModelRef
  finish?: string
  cost?: number
  tokens?: TokenUsage
  error?: {
    /** e.g. "provider.auth", "message.aborted" */
    type?: string
    message?: string
    status?: number
    name?: string
    data?: { message?: string }
  } | null
  outcome?: string
}

/**
 * One page of history and the cursor that walks backwards through it.
 *
 * The server's message list is endless in both directions; the cursor is the
 * only way back to the beginning of a long conversation.
 */
export interface MessagePage {
  messages: MessageInfo[]
  /** Cursor for the page before this one. Absent when the start is reached. */
  cursor?: string
}

/** Which page of the history to ask the server for. */
export interface MessagePageQuery {
  limit?: number
  cursor?: string
  order?: "asc" | "desc"
}

/** A permission answer the server remembers for a project. */
export interface PermissionRule {
  id: string
  projectID?: string
  action: string
  resource: string
  time?: { created?: number; updated?: number }
}

/** One file or folder the server found in the project. */
export interface FileEntry {
  path: string
  type: "file" | "directory" | string
}

/**
 * A web search provider the server can use.
 *
 * The server has its own search and knows which provider answers for it; the
 * app only has to say so.
 */
export interface WebSearchProvider {
  id: string
  name: string
}

/**
 * An instruction attached to one conversation.
 *
 * The value is whatever the server keeps: a note, a rule, a piece of context
 * that belongs to this conversation and to no other.
 */
export interface InstructionEntry {
  key: string
  value: unknown
}

/** How many tokens a stretch of work cost. */
export interface ToolUsage {
  name: string
  calls: number
  succeeded: number
  failed: number
  unfinished: number
  durationP50?: number
}

/**
 * The server's own accounting for a stretch of time.
 *
 * The server counts what happened; the app only draws it. Nothing here is
 * guessed locally.
 */
export interface SessionStats {
  range: { from: number; to: number }
  sessions: number
  subagents: number
  prompts: number
  steps: number
  tokens: TokenUsage
  cost: number
  tools: {
    mode: "none" | "summary" | "detail"
    totals?: Record<string, unknown>
    usage?: ToolUsage[]
  }  /** How many days had work in them. */
  activeDays: number
  /** How many days in a row had work in them, ending today. */
  streak: number
  /** One point per day. */
  activity: Array<{ date: string; steps: number }>
  models: Array<{
    model: { providerID?: string; id: string }
    steps: number
    tokens: TokenUsage
    cost: number
  }>
}

/** The branch a project is on. */
export interface VcsBranch {
  current?: string
  default?: string
}

/** What a project changed in one file. */
export interface VcsFileStatus {
  file: string
  additions?: number
  deletions?: number
  status?: "added" | "deleted" | "modified" | string
}

/** One of the worktrees the server keeps. */
export interface WorktreeInfo {
  directory: string
  strategy?: string
}

/** A command the server runs and keeps alive. */
export interface PtyInfo {
  id: string
  title: string
  command: string
  args: string[]
  cwd: string
  status: "running" | "exited" | string
  pid?: number
  exitCode?: number
}

/**
 * A key the server keeps for a provider.
 *
 * The secret itself never comes to the window: only the last four characters
 * are kept, which is enough to tell two keys apart and useless to anybody
 * else.
 */
export interface StoredCredential {
  id: string
  integrationID: string
  label: string
  active: boolean
  type: string
  tail: string
}

export interface ConfigFileInfo {
  path: string
  text: string
  exists: boolean
}

export interface NpmPluginHit {
  name: string
  version: string
  description?: string
  author?: string
  keywords?: string[]
  date?: string
  links?: { npm?: string; homepage?: string; repository?: string }
}

export type PluginSourceKind = "builtin" | "local" | "npm" | "unknown"

export interface ManagedPlugin {
  /** Config key used in opencode.jsonc "plugins" array. */
  id: string
  kind: PluginSourceKind
  /** Resolved absolute path for local plugins. */
  path: string | null
  enabled: boolean
  /** Present when the server reports this plugin. */
  runtime: PluginEntry | null
  /** Present for npm-sourced plugins when metadata was fetched. */
  meta: NpmPluginHit | null
  error?: string
}

/**
 * A snapshot of the changed files, taken before something risky happens.
 *
 * The way back from a change the agent made wrongly is the copy that was made
 * before it. The files are read and written through the server, because the
 * server is the one that knows where the project is.
 */
export interface CheckpointFile {
  /** The path, relative to the project root. */
  path: string
  /** How many bytes the copy holds. */
  size: number
}

export interface Checkpoint {
  id: string
  /** When the snapshot was taken. */
  at: number
  /** The project it belongs to. */
  directory: string
  /** The branch it was taken on, when the server could say. */
  branch: string
  files: CheckpointFile[]
}

/**
 * A rule that makes the app speak up on its own.
 *
 * The general notification is all or nothing: either every finished turn is
 * announced, or none is. A rule is for the cases in between — the answer
 * mentions a word, the turn cost too much, the turn failed.
 */
export interface NotifyRule {
  id: string
  /** What the rule watches for. */
  kind: "keyword" | "cost" | "error"
  /**
   * The word to look for, or the amount in dollars.
   *
   * A number for the cost rule, a word for the keyword rule; the error rule
   * needs nothing.
   */
  value: string
  enabled: boolean
}

/**
 * A conversation that starts by itself.
 *
 * The same task every morning, every Monday, every hour: the app opens the
 * conversation and sends the prompt, so the work is already waiting when the
 * user sits down.
 */
export interface AutoRun {
  id: string
  /** The prompt the conversation starts with. */
  prompt: string
  /** The agent it runs; empty means the default one. */
  agent: string
  /** When it starts, as "HH:MM" in the machine's own time. */
  time: string
  /** The weekdays it starts on: 0 is Sunday. Empty means every day. */
  days: number[]
  enabled: boolean
}

export interface AppSettings {
  /** Default directory for new chats/projects. Empty means last used. */
  defaultDirectory: string
  defaultProvider: string
  defaultModel: string
  /** Reasoning level of the default model, e.g. "high". Empty means the model's own. */
  defaultModelVariant?: string
  defaultAgent: string
  /** The user's own key combinations, by action. Empty means "not assigned". */
  shortcuts?: Record<string, string>
  /** "system" | "light" | "dark" | "auto" */
  theme: string
  /** System material behind the window: "micaAlt" (like an Explorer folder) or "acrylic". */
  backdrop: string
  /** Opacity 0..1 of the tint painted over the system backdrop. */
  acrylicOpacity: number
  acrylicTint: string
  accentColor: string
  blurBehind: boolean
  alwaysOnTop: boolean
  startMinimized: boolean
  closeToTray: boolean
  /** Accelerator that shows the window and focuses the composer. Empty = off. */
  globalHotkey: string
  /** Ask the server whether a newer release is out. */
  autoUpdate: boolean
  /**
   * The agent may look, but not touch.
   *
   * Every request of the agent to change something is refused without being
   * asked about; the ones that only read are answered at once. The point is a
   * conversation that cannot cost the user a file.
   */
  safeMode: boolean
  fontScale: number
  showThinking: boolean
  /** Windows toast when a turn ends while the window is in the background. */
  notifyOnFinish: boolean
  /** The rules that make the app speak up on its own. */
  notifyRules?: NotifyRule[]
  /** The conversations that start by themselves. */
  autoRuns?: AutoRun[]
  /**
   * Delete conversations untouched for this many days. 0 (or absent) is off.
   *
   * The list grows one conversation at a time and never shrinks on its own;
   * this is the broom, and it is off until someone asks for it — a rule that
   * deletes work without being turned on would be a rule to fear.
   */
  autoCleanupDays?: number
  /** Spend ceiling per day, in the same units the server reports. 0 is off. */
  budgetDaily?: number
  /** Spend ceiling per month. 0 is off. */
  budgetMonthly?: number
  /**
   * Run the verify command automatically after a turn reports success.
   *
   * The agent saying "done" is a claim; this is the check on it. Off by
   * default because a command can cost seconds and touch the network, and
   * because a rule that runs a shell after every answer without being asked
   * would be a rule to fear.
   */
  verifyAfterDone?: boolean
  /** The command to run for that check, e.g. `npm test`. Empty means none. */
  verifyCommand?: string
  /**
   * What to say to the watched session when its folder changes.
   *
   * Empty (the default) means watch-mode only tells the user the project moved.
   * A non-empty prompt is auto-sent when files change — useful for "re-run the
   * tests" workflows, but a prompt that edits files in response to file changes
   * would loop, so it is off until the person writes one.
   */
  watchPrompt?: string
  /** Show live token/cost figures in the chat header. */
  showUsage: boolean
  /** Show the request-limit meter in the chat header. */
  showLimits: boolean
  /**
   * What happens when a prompt is sent while a turn is still running.
   *
   * "steer" folds the new message into the answer being written — the model
   * reads it and changes course. "queue" waits for the turn to finish first.
   */
  busySendMode: PromptDelivery
  sendOnEnter: boolean
  autoUpdatePlugins: boolean
  /** Manual override for the OpenCode server URL. */
  serverUrlOverride: string
  /** Enforced through the "instructions" entry in opencode.jsonc. */
  replyLanguage: ReplyLanguage
  /** Interface language: "ru" | "en" | "de" | "fr" | "zh". */
  uiLanguage: UiLanguage

  // ---- busy animation (shown while a turn is running) ----
  busyAnimation: BusyAnimationSettings

  // ---- voice (inherited from oc-voice / oc-dictate plugin configs) ----
  /** Read assistant replies aloud when a turn finishes. */
  speakReplies: boolean
  /** "auto" | "edge" (edge-tts) | "sapi" (offline Windows voice) */
  ttsEngine: string
  ttsVoice: string
  ttsRate: string
  ttsVolume: string
  ttsPitch: string
  ttsMaxChars: number
  playbackVolume: number
  /** faster-whisper model: tiny | base | small | medium | large-v3 */
  sttModel: string
  sttLanguage: string
  /** sounddevice index or device name; "" = system default */
  micDevice: string
  /** What a finished dictation does. */
  dictateDeliver: "insert" | "send"
}

// ---- request limits ----

/**
 * A sliding window OCD counts model requests in.
 *
 * Five hours is first because that is the window OpenCode Zen publishes for its
 * free models; the rest are what people ask about once they run out.
 */
export type LimitWindow = "5h" | "day" | "week" | "month"

/** Width of each window in milliseconds. */
export const LIMIT_WINDOWS: ReadonlyArray<{ id: LimitWindow; ms: number }> = [
  { id: "5h", ms: 5 * 60 * 60_000 },
  { id: "day", ms: 24 * 60 * 60_000 },
  { id: "week", ms: 7 * 24 * 60 * 60_000 },
  { id: "month", ms: 30 * 24 * 60 * 60_000 },
]

export interface LimitWindowStat {
  window: LimitWindow
  /** Requests OCD watched go out inside the window. */
  used: number
  /** null when no limit is known: the count is still shown, never a fake bar. */
  limit: number | null
  /** When the oldest counted request leaves the window; null if there are none. */
  resetAt: number | null
}

/**
 * What OCD knows about one model's request allowance.
 *
 * The server publishes no quota, so every figure here is either something OCD
 * counted itself or a limit the user typed in. `source` says which, because a
 * remembered number must not be presented as one the provider reported.
 */
export interface RequestLimits {
  /** "<providerID>/<modelID>", the key the ledger is stored under. */
  model: string
  windows: LimitWindowStat[]
  /** Where the shown limit came from. */
  source: "builtin" | "user" | "none"
  /** Set when a 429 was seen; the meter counts down instead of guessing. */
  cooldownUntil: number | null
  updatedAt: number
}

/**
 * A finished turn, as the two ways of telling the user about it need it.
 *
 * Lives here rather than in main because the renderer hands it over and main
 * both toasts it and puts it in the corner card.
 */
export interface FinishNotice {
  title: string
  body: string
  failed: boolean
  sessionId: string
  /** Whether OCD's window was in front when the turn ended. */
  focused: boolean
}

/** Live server event forwarded from the main process. */
export type AttachmentKind = "image" | "file"

/**
 * What the server does with a prompt that arrives while a turn is running.
 *
 * `steer` folds it into the running answer: the model reads it before it
 * finishes and changes course. `queue` holds it until the turn ends — and the
 * server keeps that queue durably, so it survives a restart, unlike a list
 * held in this process.
 */
export type PromptDelivery = "steer" | "queue"

/**
 * One item waiting in the server's inbox for a conversation.
 *
 * The server owns this queue: it is durable, it survives the app being closed,
 * and it delivers on its own when the running turn ends. OCD keeps no second
 * copy, so this is what the queue bar renders.
 */
export interface InboxItem {
  id: string
  /** Epoch ms the item was enqueued, for showing how long it has waited. */
  createdAt: number
  delivery: PromptDelivery
  /** The prompt itself. Attachments are named, not carried. */
  text: string
  files: Array<{ uri: string; name?: string }>
}

/**
 * One file part of a prompt, as the server's prompt endpoint wants it.
 *
 * `description` is the server's own field and reaches the model; it is where an
 * attachment that cannot speak for itself says what it is.
 */
export interface PromptFile {
  uri: string
  name?: string
  description?: string
}

/** A file or image staged in the composer. */
export interface Attachment {
  id: string
  kind: AttachmentKind
  name: string
  mime: string
  size: number
  /** data: URL for images, file:// URL for everything else. */
  uri: string
  /** Preview source for the chip: the data URL, or empty for plain files. */
  preview: string
  /**
   * A sentence about this attachment for the model, not for the screen.
   *
   * Set where the bytes alone would mislead. A Windows shortcut that could not
   * be followed arrives as a few kilobytes of shell link with no path in it;
   * saying so is what turns an unanswerable attachment into something the model
   * can reason about instead of guessing at.
   */
  description?: string
}

export interface PickedFiles {
  attachments: Attachment[]
  /** Human-readable lines for items that could not be read. */
  errors: string[]
  /**
   * What happened that was neither a file nor a failure: a shortcut pointing
   * somewhere, a folder too large to send whole, files left out on purpose.
   *
   * Separate from `errors` because none of these are problems the user needs to
   * fix — they are decisions the drop made for them, and saying so plainly is
   * what keeps "some files were not attached" from reading as a bug.
   */
  notes?: string[]
}

export interface ServerEvent {
  id?: string
  type: string
  created?: number
  location?: LocationInfo
  /**
   * Whatever the server sent alongside the type. A union of a hundred event
   * shapes, each with its own payload, and the consumer is the one that knows
   * which `type` it asked for — so this stays opaque and is narrowed at the
   * point of use rather than typed as `any` for everyone else to inherit.
   */
  data?: Record<string, unknown>
  [k: string]: unknown
}

/** Event types the chat view reacts to. */
export type ChatEventType =
  | "server.connected"
  | "session.created"
  | "session.updated"
  | "session.deleted"
  | "session.text.started"
  | "session.text.delta"
  | "session.text.ended"
  | "session.reasoning.started"
  | "session.reasoning.delta"
  | "session.reasoning.ended"
  | "session.tool.started"
  | "session.tool.completed"
  | "session.step.started"
  | "session.step.ended"
  | "session.execution.started"
  | "session.execution.succeeded"
  | "session.execution.failed"
  | "session.usage.updated"
  | "permission.updated"
  | "permission.asked"
  | "model.updated"
  | "provider.updated"

/**
 * A tool call OpenCode wants confirmed before it runs.
 *
 * Shapes taken from the server's own client: the reply endpoint is keyed by
 * `id` and `sessionID`, and `action`/`resources` come from the create call
 * used to persist an "always" decision.
 */
export interface PermissionRequest {
  id: string
  sessionID: string
  /** Tool name, e.g. "bash", "edit", "external_directory". */
  action?: string
  /** Paths or patterns the call would touch. */
  resources?: string[]
  agent?: string
  metadata?: Record<string, unknown>
  source?: string
}

/** "once" allows this call, "always" persists the rule, "reject" refuses. */
export type PermissionDecision = "once" | "always" | "reject"

/**
 * A pending question from the model, as the server models it.
 *
 * The server does not answer these through the message stream: a tool that asks
 * something creates a *form* whose metadata names the tool block that spawned
 * it, and the turn stays blocked until `POST /form/{id}/reply` lands. This is
 * the only way to unblock it — sending a normal prompt does not settle it.
 */
export interface FormOption {
  value: string
  label: string
  description?: string
}

export interface FormField {
  key: string
  title?: string
  description?: string
  /** Only "string" carries options today; other field kinds render as text. */
  type: string
  options?: FormOption[]
  /** True when the field also accepts free text beyond its options. */
  custom?: boolean
  required?: boolean
}

export interface PendingForm {
  id: string
  sessionID: string
  title: string
  fields: FormField[]
  metadata?: {
    kind?: string
    /** Tool block that asked, so the form can be shown next to it. */
    tool?: { messageID?: string; id?: string }
  }
}

/** Field key to value. Values are strings, numbers, booleans or string lists. */
export type FormAnswer = Record<string, string | number | boolean | string[]>

export interface SearchHit {
  sessionId: string
  title: string
  /** Excerpt around the first match, newlines flattened. */
  snippet: string
  /** Session's last activity, used to order results. */
  updated: number
  /** The id of the message the match is in, when the index knows it. */
  messageId?: string
  /** 1-based number of that message in the transcript. */
  messageIndex?: number
}

/**
 * One line of a JSONL export.
 *
 * The format other tools read: one object per line, and nothing but the
 * message on it. The window knows which message was the user's and which was
 * the model's, so the records are built there.
 */
export interface ExportRecord {
  role: "user" | "assistant" | "tool"
  content: string
  /** The tool's name, for a tool line. */
  name?: string
}

export interface OcdApi {
  service: {
    status(): Promise<ServiceStatus>
    connect(serverUrl?: string): Promise<ServiceStatus>
    restart(): Promise<ServiceStatus>
  }
  api: {
    info(): Promise<unknown>
    config(): Promise<unknown>
    projects(): Promise<ProjectInfo[]>
    currentLocation(): Promise<LocationInfo | null>
    locations(): Promise<unknown>
    providers(location?: string): Promise<ProviderInfo[]>
    models(location?: string): Promise<ModelInfo[]>
    agents(): Promise<AgentInfo[]>
    /** One agent in full: what it does and what it may do. */
    agent(id: string): Promise<AgentDetails>
    plugins(): Promise<PluginEntry[]>
    updatePlugins(): Promise<unknown>
    mcp(): Promise<McpServerInfo[]>
    skills(): Promise<SkillInfo[]>
    commands(): Promise<CommandInfo[]>
    sessions(directory?: string): Promise<SessionInfo[]>
    createSession(input: {
      title?: string
      directory?: string
      agent?: string
      model?: ModelRef
    }): Promise<SessionInfo>
    session(id: string): Promise<SessionInfo>
    deleteSession(id: string): Promise<unknown>
    renameSession(id: string, title: string): Promise<unknown>
    messages(
      sessionId: string,
      page?: { limit?: number; cursor?: string; order?: "asc" | "desc" },
    ): Promise<MessageInfo[]>
    /**
     * One page of history plus the cursor to the page before it.
     *
     * The plain list is the last page: the newest messages. Older ones are
     * fetched with the cursor the server hands back.
     */
    messagePage(
      sessionId: string,
      page?: { limit?: number; cursor?: string; order?: "asc" | "desc" },
    ): Promise<MessagePage>
    /** The whole transcript of one conversation, for a comparison. */
    sessionMessages(sessionId: string): Promise<MessageInfo[]>
    prompt(
      sessionId: string,
      input: {
        text: string
        agent?: string
        files?: Array<{ uri: string; name?: string }>
        /** What to do when a turn is already running. Omitted = server default. */
        delivery?: PromptDelivery
      },
    ): Promise<unknown>
    /**
     * Stop the running turn. The server route is `/interrupt`; `resume` hands
     * the turn to the next queued prompt instead of going idle.
     */
    interrupt(sessionId: string, resume?: boolean): Promise<{ interrupted: boolean }>
    /** Pin the model of an existing session (POST /api/session/{id}/model). */
    setSessionModel(sessionId: string, model: ModelRef): Promise<unknown>
    /** Pin the agent of an existing session (POST /api/session/{id}/agent). */
    setSessionAgent(sessionId: string, agent: string): Promise<unknown>
    /** Ask the server to shrink the conversation (POST /api/session/{id}/compact). */
    compactSession(sessionId: string): Promise<unknown>
    /** Branch the conversation (POST /api/session/{id}/fork). */
    forkSession(sessionId: string, before?: string): Promise<SessionInfo>
    /** Move a session to another project directory (POST /api/session/{id}/move). */
    moveSession(sessionId: string, directory: string): Promise<unknown>
    /** Run a server-side command in a session (POST /api/session/{id}/command). */
    runSessionCommand(
      sessionId: string,
      command: { name: string; text: string },
    ): Promise<unknown>
    /** Permission rules remembered for the project (GET /api/permission/saved). */
    permissionRules(projectID?: string): Promise<PermissionRule[]>
    /** Remember a permission answer (POST /api/session/{id}/permission). */
    savePermissionRule(
      sessionId: string,
      rule: { action: string; resources: string[]; save?: string[] },
    ): Promise<unknown>
    /** Forget a remembered permission answer (DELETE /api/permission/saved/{id}). */
    deletePermissionRule(id: string): Promise<unknown>
    /** Files of the project, found by name. */
    findFiles(query: string, directory?: string): Promise<FileEntry[]>
    /** The branch the project is on. */
    vcsBranch(directory?: string): Promise<VcsBranch | null>
    /** The branch a folder is on, read from the repository itself. */
    gitBranch(directory?: string): Promise<string | null>
    /** The branch and the number of changed files. */
    gitStatus(directory?: string): Promise<{ branch: string | null; changed: number }>
    /** What the project changed, per file. */
    vcsStatus(directory?: string): Promise<VcsFileStatus[]>
    /** The worktrees the server keeps. */
    worktrees(): Promise<WorktreeInfo[]>
    /** The messages the model will read on the next turn. */
    sessionContext(sessionId: string): Promise<{ count: number; tokens: number }>
    /** The sessions the server is working on right now. */
    activeSessions(): Promise<Record<string, { type: string }>>
    /** The server's own log of a session. */
    sessionLog(sessionId: string): Promise<string[]>
    /** The resources the MCP servers publish. */
    mcpResources(): Promise<{ resources: string[]; templates: string[] }>
    /** The keys the server keeps for the providers. */
    credentials(): Promise<StoredCredential[]>
    /** Makes a stored key the one in use. */
    activateCredential(id: string): Promise<unknown>
    /** Forgets a stored key. */
    deleteCredential(id: string): Promise<unknown>
    /**
     * Rewinds the conversation to before a message, dropping it and everything
     * after. Fails with 409 while a turn is running.
     */
    revert(sessionId: string, messageId: string): Promise<{ messageID: string }>
    /** Drops a staged revert that was never committed. */
    revertCancel(sessionId: string): Promise<unknown>
    /** Stages a rewind and answers with the files it would restore. */
    revertStage(
      sessionId: string,
      messageId: string,
    ): Promise<{ messageID: string; files: FileDiffInfo[] }>
    /** Applies a staged rewind. */
    revertCommit(sessionId: string): Promise<unknown>
    // ---- the project's files, as the server sees them ----
    /** What the repository says it changed. */
    vcsDiff(
      mode: "working" | "branch" | "committed",
      directory?: string,
      base?: string,
    ): Promise<FileDiffInfo[]>
    /** One directory of the project. The path is relative to the project root. */
    fsList(path?: string, directory?: string): Promise<FileEntry[]>
    /** The contents of one file. */
    fsRead(path: string, directory?: string): Promise<string>
    // ---- the server's own capabilities ----
    /** A short-lived code another device can be paired with. */
    pair(): Promise<{ code: string; expires_in: number }>
    websearchProviders(directory?: string): Promise<WebSearchProvider[]>
    sessionStats(from?: number, to?: number, project?: string): Promise<SessionStats>
    // ---- one conversation, on the server's side ----
    sessionEnvironment(sessionId: string, variables: Record<string, string>): Promise<unknown>
    sessionBackground(sessionId: string): Promise<unknown>
    sessionInstructions(sessionId: string): Promise<InstructionEntry[]>
    sessionInstructionPut(sessionId: string, key: string, value: unknown): Promise<unknown>
    sessionInstructionRemove(sessionId: string, key: string): Promise<unknown>
    // ---- the MCP servers ----
    mcpSet(server: string, config: Record<string, unknown>, directory?: string): Promise<unknown>
    mcpRemove(server: string, directory?: string): Promise<unknown>
    mcpConnect(server: string, directory?: string): Promise<unknown>
    mcpDisconnect(server: string, directory?: string): Promise<unknown>
  }
  plugins: {
    list(): Promise<ManagedPlugin[]>
    search(query: string): Promise<NpmPluginHit[]>
    install(pkg: string): Promise<{ ok: boolean; error?: string }>
    uninstall(id: string): Promise<{ ok: boolean; error?: string }>
    addLocal(dir: string): Promise<{ ok: boolean; error?: string }>
    revealLocal(dir: string): Promise<unknown>
  }
  configFile: {
    read(): Promise<ConfigFileInfo>
    write(text: string): Promise<{ ok: boolean; error?: string }>
    reload(): Promise<unknown>
    path(): Promise<string>
    setReplyLanguage(lang: ReplyLanguage): Promise<{ ok: boolean; error?: string }>
    replyLanguage(): Promise<ReplyLanguage>
    /** Whether the managed instruction file already has the current wording. */
    languageCurrent(lang: ReplyLanguage): Promise<boolean>
    setProvider(providerID: string, patch: ProviderInstall): Promise<{ ok: boolean; error?: string }>
    removeProvider(providerID: string): Promise<{ ok: boolean; error?: string }>
    providers(): Promise<ConfigProviderSummary[]>
  }
  /**
   * The server's own catalog of connectable services.
   *
   * Connecting stores the credential on the server rather than in the config
   * file, which is what lets OAuth and account logins work at all.
   */
  integration: {
    list(): Promise<IntegrationInfo[]>
    connectKey(
      integrationId: string,
      key: string,
      answer?: Record<string, string>,
      label?: string,
    ): Promise<unknown>
    oauthBegin(
      integrationId: string,
      methodId: string,
      answer?: Record<string, string>,
      label?: string,
    ): Promise<IntegrationAttempt>
    /** `pending` while the user is in the browser; then settled. */
    oauthStatus(integrationId: string, attemptId: string): Promise<AttemptStatus>
    /** Finishes a `mode: "code"` attempt with the pasted code. */
    oauthComplete(integrationId: string, attemptId: string, code?: string): Promise<unknown>
    oauthCancel(integrationId: string, attemptId: string): Promise<unknown>
    /** Asks a local runtime what it has; offline is a normal answer. */
    probe(baseURL: string): Promise<LocalRuntimeStatus>
  }
  /**
   * Models on a local engine.
   *
   * Nothing here downloads on its own: `pull` runs because the user asked for a
   * model by name from the Providers view.
   */
  model: {
    /** Engines that can be asked for models. */
    engines(): Promise<Array<{ id: string; label: string; baseURL: string }>>
    list(engineId: string): Promise<Array<{ name: string; size?: number; modified?: string }>>
    /** Starts a download and returns a job id; progress arrives as an event. */
    pull(engineId: string, model: string): Promise<string>
    pullCancel(jobId: string): Promise<boolean>
    delete(engineId: string, model: string): Promise<unknown>
    /** Progress of every download, including ones started in another window. */
    onProgress(cb: (progress: PullProgress) => void): () => void
  }
  /** What this machine can hold, and what can be downloaded to fill it. */
  local: {
    hardware(): Promise<HardwareFacts>
    /** Hugging Face repositories shipping GGUF, most downloaded first. */
    searchRepos(query: string, limit?: number): Promise<RepoHit[]>
    /** Servable weight files in one repository, with their sizes. */
    repoFiles(repo: string): Promise<FileGroup[]>
  }
  preview: {
    /** Stage assistant-authored HTML in userData and return its path. */
    writeTemp(html: string): Promise<string>
    /** Resolve a file into something the pane can render, converting if needed. */
    open(path: string): Promise<PreparedPreview>
    /** Hand a guest's _blank target to the system browser; false if refused. */
    openExternal(url: string): Promise<boolean>
  }
  app: {
    getSettings(): Promise<AppSettings>
    setSettings(patch: Partial<AppSettings>): Promise<AppSettings>
    version(): Promise<{ app: string; electron: string; node: string; chrome: string }>
    minimize(): Promise<void>
    toggleMaximize(): Promise<boolean>
    close(): Promise<void>
    setAlwaysOnTop(value: boolean): Promise<void>
    openExternal(url: string): Promise<void>
    openPath(target: string): Promise<string>
    pickDirectory(): Promise<string | null>

    // ---- tray, global hotkey, session windows ----
    trayState(next: {
      recent?: Array<{ id: string; title: string }>
      connected?: boolean
      visible?: boolean
      language?: string
    }): Promise<void>
    showWindow(): Promise<boolean>
    /** Show the window and put the caret in the composer. */
    focusComposer(): Promise<void>
    /** Open one conversation in its own OS window; re-requests focus it. */
    openSessionWindow(sessionId: string, title?: string | null): Promise<boolean>
    /** Claim or release the global hotkey; `ok: false` means it was taken. */
    setGlobalHotkey(accelerator: string): Promise<{ ok: boolean; error?: string }>
    setAutoUpdate(enabled: boolean): Promise<boolean>
    checkForUpdates(): Promise<{ ok: boolean; message: string }>
    /** Fetch an update that `checkForUpdates` reported. Never starts on its own. */
    downloadUpdate(): Promise<{ ok: boolean; message: string }>
    /** Install the downloaded update and restart; fails if nothing is staged. */
    installUpdate(): Promise<{ ok: boolean; message: string }>
    /** What the header's update button shows itself from. */
    updateState(): Promise<UpdateState>
    /** System print dialog; the document is the same one the HTML export writes. */
    printConversation(payload: {
      sessionId: string
      title: string
      markdown: string
      messages: number
    }): Promise<{ ok: boolean; canceled?: boolean; error?: string }>
    exportConversation(payload: {
      sessionId: string
      title: string
      markdown: string
      format: "markdown" | "html" | "pdf" | "jsonl"
      messages: number
      /** The conversation as records, for the JSONL export. */
      records?: Array<{ role: "user" | "assistant" | "tool"; content: string; name?: string }>
    }): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>
    /** Saves the conversation as the server's own session file. */
    exportSessionFile(
      sessionId: string,
      title: string,
    ): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>
    /** Takes a session file back and makes a session of it. */
    importSessionFile(): Promise<{ ok: boolean; canceled?: boolean; id?: string; error?: string }>
    /** Write app-produced text (a patch) exactly as given, wherever the user says. */
    saveText(payload: {
      name: string
      content: string
      ext: string
    }): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>
    // ---- checkpoints: copies of the changed files ----
    /** The snapshots this machine holds. */
    checkpoints(): Promise<Checkpoint[]>
    /** Take a snapshot of the changed files. */
    checkpointSave(directory?: string): Promise<Checkpoint>
    /** Put the files of a snapshot back. */
    checkpointRestore(id: string): Promise<{ restored: number }>
    /** Forget a snapshot. */
    checkpointDelete(id: string): Promise<boolean>
    /** Saves every conversation of a project as one file. */
    exportProjectSessions(
      directory?: string,
    ): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>
    /** Commands pushed from main: tray entries, hotkey, tray language switch. */
    onCommand(cb: (command: { kind: string; sessionId?: string; language?: string }) => void): () => void
  }
  search: {
    /** Build (or refresh) the conversation index; resolves with its size. */
    build(force?: boolean): Promise<{ sessions: number }>
    query(text: string, sessions: SessionInfo[]): Promise<SearchHit[]>
    clear(): Promise<void>
  }
  notify: {
    /** Windows toast for a finished turn; the renderer decides when. */
    finish(notice: FinishNotice): Promise<boolean>
    /** A toast the user asked for in advance, by a rule. */
    rule(notice: { title: string; body: string }): Promise<boolean>
  }
  shell: {
    /**
     * Re-runs a command in the machine's own terminal rather than a second one
     * inside the app. `launcher` names what was used, so the caller can say so.
     */
    openTerminal(command: string, cwd?: string): Promise<{ launcher: string; opened: boolean }>
    /**
     * Runs a command once and brings back its verdict — an exit code and both
     * streams. A failing exit is a result, not a rejection. This is what the
     * verify-after-done check uses to see whether the agent's claim of "done"
     * survives the project's own tests.
     */
    run(
      command: string,
      cwd?: string,
      timeoutMs?: number,
    ): Promise<{ exit: number; stdout: string; stderr: string }>
  }
  fsWatch: {
    /**
     * Watch one project folder for changes; the store reacts to the resulting
     * `ocd.fsChanged` events. Starting replaces any previous watch.
     */
    start(directory: string): Promise<{ watching: boolean }>
    /** Stop watching. */
    stop(): Promise<{ directory: string | null }>
  }
  permission: {
    /** Requests the server is waiting on for an answer. */
    list(directory?: string): Promise<PermissionRequest[]>
    /** Answer one request. Without this the turn waits forever. */
    reply(
      sessionId: string,
      requestId: string,
      decision: PermissionDecision,
      message?: string,
    ): Promise<void>
  }
  form: {
    /** Questions the model asked, still waiting for an answer. */
    list(sessionId: string): Promise<PendingForm[]>
    /** Settle a question. This is what releases the blocked turn. */
    reply(sessionId: string, formId: string, answer: FormAnswer): Promise<void>
    /** Dismiss a question without answering it. */
    cancel(sessionId: string, formId: string): Promise<void>
  }
  remote: {
    connect(target: {
      host: string
      remotePort: number
      localPort?: number
      remember?: boolean
    }): Promise<{ url: string; port: number }>
    disconnect(): Promise<void>
    status(): Promise<{ active: boolean; url: string | null }>
  }
  /** The finished-reply card in the bottom-right corner. */
  notice: {
    onShow(cb: (payload: FinishNotice) => void): () => void
    /** The card was clicked: open that conversation and put the card away. */
    dismiss(sessionId: string): Promise<boolean>
  }
  /** Heads-up display; main owns the state and pushes it. */
  hud: {
    onState(
      cb: (state: {
        connected: boolean
        busy: Array<{ id: string; title: string }>
        status: string
      }) => void,
    ): () => void
    request(): Promise<void>
    toggle(): Promise<boolean>
  }
  attachments: {
    /** Native file dialog for images and any other file. */
    pick(kind: "image" | "file"): Promise<PickedFiles>
    /** Image currently on the Windows clipboard, if any. */
    fromClipboard(): Promise<PickedFiles>
    /** Read files dropped onto the window. */
    fromPaths(paths: string[]): Promise<PickedFiles>
    /** Store an inline data: URL as an attachable image. */
    fromDataUrl(dataUrl: string, nameHint?: string): Promise<PickedFiles>
  }
  contextMenu: {
    /** Native right-click menu for the composer or the message stream. */
    show(target: "input" | "stream", messageId?: string): Promise<void>
    /** Files chosen from the context menu land here. */
    onAttach(cb: (picked: PickedFiles) => void): () => void
    /** The menu asks for a rewind to a message. */
    onRevertRequest(cb: (payload: { messageId: string }) => void): () => void
  }
  events: {
    subscribe(): Promise<{ ok: boolean; error?: string }>
    onEvent(cb: (event: ServerEvent) => void): () => void
    onStatus(cb: (status: ServiceStatus) => void): () => void
    /** Push of the update state, so the header arrow follows the finding. */
    onUpdate(cb: (state: UpdateState) => void): () => void
  }
  /** A terminal the server runs and the app attaches to. */
  pty: {
    open(input: {
      command: string
      args?: string[]
      cwd?: string
      title?: string
    }): Promise<PtyInfo>
    input(id: string, data: string): Promise<void>
    close(id: string): Promise<void>
    onOutput(cb: (payload: { id: string; data: string }) => void): () => void
  }
  voice: {
    /** Defaults inherited from the oc-voice / oc-dictate plugin configs. */
    defaults(): Promise<{
      engine: string
      voice: string
      rate: string
      volume: string
      pitch: string
      maxChars: number
      speakReplies: boolean
      sttModel: string
      sttLanguage: string
      micDevice: string
      maxSeconds: number
    }>
    devices(): Promise<{ devices: Array<{ index: number; name: string }>; default: number | null; error?: string }>
    voices(): Promise<Array<{ id: string; name: string; gender?: string; locale?: string }>>
    speak(text: string): Promise<{ ok: boolean; skipped?: boolean; engine?: string; voice?: string; error?: string }>
    stopSpeaking(): Promise<void>
    startDictation(): Promise<{ ok: boolean; error?: string }>
    stopDictation(): Promise<{ ok: boolean; text?: string; lang?: string; seconds?: number; error?: string }>
    cancelDictation(): Promise<void>
    onState(cb: (state: { dictation: "recording" | "transcribing" | "idle"; error?: string }) => void): () => void
    onResult(cb: (result: { ok: boolean; text?: string; lang?: string; seconds?: number; error?: string }) => void): () => void
  }
  /**
   * How many requests each model has been sent and what ceiling they count
   * against. Counted by OCD, not read from the provider — see main/limits.ts.
   */
  limits: {
    /** Current tally for one model, keyed by "<providerID>/<modelID>". */
    snapshot(model: string): Promise<RequestLimits>
    /** Type in a limit for one window; null forgets it and falls back. */
    set(model: string, window: LimitWindow, limit: number | null): Promise<RequestLimits>
    /** Forget the tally for one model, or for every model. */
    clear(model?: string): Promise<boolean>
  }
  /** The renderer's failures, so they land in the same log as main's. */
  diag: {
    report(payload: { message: string; stack?: string; kind?: string }): Promise<boolean>
    /** The tail of the app's own log. */
    tail(lines?: number): Promise<string[]>
    /** The folder the log lives in. */
    folder(): Promise<string | null>
  }
  /**
   * The way back to whoever ships this.
   *
   * `configured` is asked once by the About screen: a build without a backend
   * says so instead of offering a button that fails. `send` rejects with a
   * sentence meant to be shown.
   */
  feedback: {
    configured(): Promise<boolean>
    send(input: {
      kind: FeedbackKind
      message: string
      /** Where to answer, if the sender wants to be answered. */
      contact?: string
      /** Attach the version and OS. Off means the text arrives on its own. */
      tech?: boolean
      /** The app's own log; sent only together with `tech`. */
      log?: string
    }): Promise<boolean>
  }
  /** Settings as a file, for moving the configuration to another machine. */
  settings: {
    /** Resolves to the written path, or "" when the dialog was cancelled. */
    export(): Promise<string>
    /** Resolves to the settings in force; unchanged if cancelled. */
    import(): Promise<AppSettings>
  }
  /**
   * The server's own queue for a conversation.
   *
   * Prompts sent while a turn runs with `delivery: "queue"` land here rather
   * than anywhere in this app, which is what makes them survive a restart.
   */
  inbox: {
    list(sessionId: string): Promise<InboxItem[]>
    /** Drop one item that has not been delivered yet. */
    cancel(sessionId: string, inboxId: string): Promise<boolean>
    /** Promote a waiting item into the running turn instead. */
    setDelivery(sessionId: string, inboxId: string, delivery: PromptDelivery): Promise<boolean>
  }
}


