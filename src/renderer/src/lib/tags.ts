import { useSyncExternalStore } from "react"

/**
 * Free-form labels a person puts on a conversation.
 *
 * Like pins and notes, tags are local to OCD and deliberately invisible to the
 * model: the server has no notion of them, and pushing them into the transcript
 * would mean the next turn reads them as context. They exist to cut across the
 * folder tree — "доделать", "под вопросом", "важное" cut across projects — and
 * to make a handful of conversations findable and manageable as one group.
 *
 * Storage is a single localStorage record mapping a session id to its tags, so
 * one write is one key and the whole set can be listed for the filter without a
 * scan. Changes are broadcast so the sidebar, the filter and any editor stay in
 * step without lifting the state into the store.
 */

const TAG_KEY = "ocd.tags.v1"

export type TagStore = Record<string, string[]>

/** A stable stand-in for "no tags", so snapshots are referentially equal. */
const EMPTY: string[] = []

let cache: TagStore | null = null
/** The distinct tags across every conversation, sorted; rebuilt on each write. */
let distinctCache: string[] = []
const listeners = new Set<() => void>()

function load(): TagStore {
  if (cache) return cache
  try {
    const parsed = JSON.parse(localStorage.getItem(TAG_KEY) ?? "{}") as TagStore
    cache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch {
    cache = {}
  }
  return cache
}

function rebuildDistinct(): void {
  const seen = new Set<string>()
  for (const tags of Object.values(cache ?? {})) {
    if (Array.isArray(tags)) for (const tag of tags) seen.add(tag)
  }
  distinctCache = [...seen].sort((a, b) => a.localeCompare(b))
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function commit(next: TagStore): void {
  cache = next
  rebuildDistinct()
  try {
    localStorage.setItem(TAG_KEY, JSON.stringify(next))
  } catch {
    /* storage unavailable: tags simply do not survive the restart */
  }
  for (const listener of listeners) listener()
}

/** The tags of one conversation; a shared empty array when it has none. */
export function readTags(sessionId: string): string[] {
  if (!sessionId) return EMPTY
  const tags = load()[sessionId]
  return Array.isArray(tags) ? tags : EMPTY
}

/** Replace a conversation's tags, deduplicated and trimmed. */
export function setTags(sessionId: string, tags: string[]): void {
  if (!sessionId) return
  const store = { ...load() }
  const unique = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))]
  if (unique.length) store[sessionId] = unique
  else delete store[sessionId]
  commit(store)
}

/** Add one tag if it is not already there. */
export function addTag(sessionId: string, tag: string): void {
  const trimmed = tag.trim()
  if (!trimmed) return
  const current = readTags(sessionId)
  if (current.includes(trimmed)) return
  setTags(sessionId, [...current, trimmed])
}

/** Drop one tag from a conversation. */
export function removeTag(sessionId: string, tag: string): void {
  setTags(
    sessionId,
    readTags(sessionId).filter((item) => item !== tag),
  )
}

/** Every distinct tag across all conversations, sorted — for the filter. */
export function allTags(): string[] {
  load()
  return distinctCache
}

/** Tags of one conversation, kept in step with the store. */
export function useSessionTags(sessionId: string): string[] {
  return useSyncExternalStore(
    subscribe,
    () => readTags(sessionId),
    () => readTags(sessionId),
  )
}

/** Every distinct tag, kept in step with the store. */
export function useAllTags(): string[] {
  return useSyncExternalStore(
    subscribe,
    () => allTags(),
    () => allTags(),
  )
}
