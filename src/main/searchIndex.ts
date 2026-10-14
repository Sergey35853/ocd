import { app } from "electron"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { MessageInfo, MessageContent, SessionInfo } from "@shared/types"
import { service } from "./service"

/**
 * Full-text index over conversation bodies.
 *
 * OpenCode has no search endpoint, so the only way to find a phrase the user
 * remembers is to read the sessions. Doing that on every keystroke would be
 * absurd, so the index is built once, persisted next to the settings, and
 * reused: 48 sessions with hundreds of messages each would otherwise mean
 * thousands of HTTP round trips per search box focus.
 */

interface IndexEntry {
  /** Session title at index time, so a hit can be labelled without a fetch. */
  title: string
  /** When the session was last touched; a change invalidates the entry. */
  updated: number
  /** Message count, used as a cheap staleness signal alongside `updated`. */
  messages: number
  /** Lower-cased plain text of the whole conversation. */
  text: string
}

interface IndexFile {
  version: 1
  sessions: Record<string, IndexEntry>
}

export interface SearchHit {
  sessionId: string
  title: string
  /** Short excerpt around the first match, with newlines flattened. */
  snippet: string
  /** 1-based index of the matching message, so the chat can jump to it. */
  messageIndex: number
  updated: number
}

/** Cap on the stored text per session: enough for real answers, bounded on disk. */
const MAX_TEXT = 60_000
const SNIPPET = 160

let cache: IndexFile | null = null
let building: Promise<void> | null = null

function indexFile(): string {
  return join(app.getPath("userData"), "ocd-search-index.json")
}

function load(): IndexFile {
  if (cache) return cache
  try {
    const file = indexFile()
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as IndexFile
      if (parsed?.version === 1 && parsed.sessions) {
        cache = parsed
        return cache
      }
    }
  } catch {
    /* a corrupt index is not worth keeping: rebuild instead */
  }
  cache = { version: 1, sessions: {} }
  return cache
}

function save(): void {
  if (!cache) return
  const file = indexFile()
  try {
    mkdirSync(dirname(file), { recursive: true })
    // Write-then-rename: a crash mid-write must not leave a half index that
    // fails to parse on the next launch.
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(cache), "utf8")
    renameSync(tmp, file)
  } catch (err) {
    console.error("Failed to persist the search index:", err)
  }
}

/** Plain text of a conversation: message bodies, tool names, no JSON blobs. */
function conversationText(messages: MessageInfo[]): { text: string; count: number } {
  const parts: string[] = []
  for (const message of messages) {
    for (const part of message.content ?? []) {
      const block = part as MessageContent
      if (block.type === "text" && typeof block.text === "string") parts.push(block.text)
      else if (block.type === "tool" && block.tool) parts.push(block.tool)
    }
  }
  return { text: parts.join("\n").slice(0, MAX_TEXT).toLowerCase(), count: messages.length }
}

/**
 * Fetch messages for one session, tolerating failure.
 *
 * A single unreadable session must not abort the whole index — that would
 * leave the search box permanently empty because of one bad session.
 */
async function indexSession(session: SessionInfo): Promise<void> {
  const store = load()
  const updated = session.time?.updated ?? 0
  const existing = store.sessions[session.id]
  if (existing && existing.updated === updated) return

  try {
    const raw = await service.get(`/api/session/${session.id}/message`)
    const messages = Array.isArray(raw) ? (raw as MessageInfo[]) : []
    const { text, count } = conversationText(messages)
    store.sessions[session.id] = { title: session.title ?? "", updated, messages: count, text }
  } catch {
    // Keep whatever was indexed before rather than dropping the session.
  }
}

/** Build or refresh the index. Concurrent callers share one run. */
export function ensureIndex(sessions: SessionInfo[], force = false): Promise<void> {
  if (building) return building

  building = (async () => {
    const store = load()
    if (force) store.sessions = {}
    // Newest first: if the run is cut short, the sessions the user is most
    // likely to search are the ones that made it in.
    const ordered = [...sessions].sort(
      (a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0),
    )

    // Batched so 48 sessions do not open 48 sockets at once.
    const BATCH = 6
    for (let i = 0; i < ordered.length; i += BATCH) {
      await Promise.all(ordered.slice(i, i + BATCH).map(indexSession))
    }
    save()
  })().finally(() => {
    building = null
  })

  return building
}

/** Drop entries for sessions the server no longer knows about. */
export function pruneIndex(sessions: SessionInfo[]): void {
  const store = load()
  const alive = new Set(sessions.map((session) => session.id))
  let changed = false
  for (const id of Object.keys(store.sessions)) {
    if (!alive.has(id)) {
      delete store.sessions[id]
      changed = true
    }
  }
  if (changed) save()
}

export function indexSize(): number {
  return Object.keys(load().sessions).length
}

/**
 * Find sessions whose body contains every word of the query.
 *
 * All words must match (AND), which is what makes a phrase search narrow
 * instead of returning everything that shares a common word.
 */
export function search(query: string, sessions: SessionInfo[]): SearchHit[] {
  const store = load()
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
  if (words.length === 0) return []

  const byId = new Map(sessions.map((session) => [session.id, session]))

  const hits: SearchHit[] = []
  for (const [sessionId, entry] of Object.entries(store.sessions)) {
    const at = words.map((word) => entry.text.indexOf(word))
    if (at.some((position) => position < 0)) continue

    // Snippet around the earliest match, which reads best when several words
    // are spread across the conversation.
    const start = Math.min(...at)
    const from = Math.max(0, start - SNIPPET / 3)
    const slice = entry.text.slice(from, from + SNIPPET).replace(/\s+/g, " ").trim()

    const session = byId.get(sessionId)
    hits.push({
      sessionId,
      title: session?.title ?? entry.title ?? sessionId,
      snippet: from > 0 ? "…" + slice : slice,
      messageIndex: 0,
      updated: session?.time?.updated ?? entry.updated,
    })
  }

  return hits.sort((a, b) => b.updated - a.updated)
}

export function clearIndex(): void {
  cache = { version: 1, sessions: {} }
  save()
}