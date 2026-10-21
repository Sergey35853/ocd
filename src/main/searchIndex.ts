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
  /** Where each message's text begins in `text`, and which message it is. */
  marks: MessageMark[]
}

/**
 * One message inside the indexed text.
 *
 * The text of a session is stored as one blob, so a hit cannot say which
 * message it came from without being told where each message starts.
 */
interface MessageMark {
  /** Character offset in the entry's text. */
  at: number
  /**
   * 1-based number of the message in the transcript, counted in the order the
   * server handed the messages over.
   */
  number: number
}

interface IndexFile {
  version: 2
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
      // An index from before the message marks existed cannot say which
      // message a hit came from, so it is rebuilt rather than believed.
      if (parsed?.version === 2 && parsed.sessions) {
        cache = parsed
        return cache
      }
    }
  } catch {
    /* a corrupt index is not worth keeping: rebuild instead */
  }
  cache = { version: 2, sessions: {} }
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

/**
 * Plain text of a conversation: message bodies, tool names, no JSON blobs.
 *
 * The offset of every message in the joined text is kept alongside it: a hit
 * has to name the message it came from, and the blob alone cannot say which
 * one that was. The marks stop at the same place the text does, because
 * anything past it was never indexed.
 */
function conversationText(messages: MessageInfo[]): {
  text: string
  count: number
  marks: MessageMark[]
} {
  const parts: string[] = []
  const marks: MessageMark[] = []
  let offset = 0

  for (const [index, message] of messages.entries()) {
    const blocks: string[] = []
    for (const part of message.content ?? []) {
      const block = part as MessageContent
      if (block.type === "text" && typeof block.text === "string") blocks.push(block.text)
      else if (block.type === "tool" && block.tool) blocks.push(block.tool)
    }
    const chunk = blocks.join("\n").toLowerCase()
    if (chunk) {
      if (offset < MAX_TEXT) marks.push({ at: offset, number: index + 1 })
      parts.push(chunk)
      // The separator join() adds between two parts.
      offset += chunk.length + 1
    }
  }

  return { text: parts.join("\n").slice(0, MAX_TEXT), count: messages.length, marks }
}

/**
 * The message a character offset falls into.
 *
 * Zero when nothing is known about it: the index is a summary, and a hit
 * without a message number is still a hit.
 */
function messageAt(marks: MessageMark[], offset: number): number {
  let number = 0
  for (const mark of marks) {
    if (mark.at > offset) break
    number = mark.number
  }
  return number
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
    const { text, count, marks } = conversationText(messages)
    store.sessions[session.id] = { title: session.title ?? "", updated, messages: count, text, marks }
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
      messageIndex: messageAt(entry.marks ?? [], start),
      updated: session?.time?.updated ?? entry.updated,
    })
  }

  return hits.sort((a, b) => b.updated - a.updated)
}

export function clearIndex(): void {
  cache = { version: 2, sessions: {} }
  save()
}