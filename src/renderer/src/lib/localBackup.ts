/**
 * Carrying what a person wrote in one machine's browser storage to another.
 *
 * Pins, notes, drafts, templates, tags and per-conversation environment live in
 * localStorage: fast, offline, and tied to this origin. They are also the data
 * a reinstall or a new machine would quietly destroy, so they are worth putting
 * in a file. Transient state (open tabs, the current view, turn timings) is
 * deliberately excluded — it describes this machine's session, and replaying it
 * elsewhere would only resurrect stale references.
 */

/** localStorage keys worth backing up, matched by prefix. */
const PREFIXES = [
  "ocd.pins.v1:",
  "ocd.note.v1:",
  "ocd.draft.v1:",
  "ocd.env.",
  "ocd.templates.v1",
  "ocd.tags.v1",
]

function owned(key: string): boolean {
  return PREFIXES.some((prefix) => key.startsWith(prefix))
}

/** Every backed-up key and its raw value, straight from storage. */
export function collectLocalData(): Record<string, string> {
  const items: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || !owned(key)) continue
    const value = localStorage.getItem(key)
    if (value !== null) items[key] = value
  }
  return items
}

/**
 * The file contents: a versioned envelope, so a later format can still read an
 * older backup instead of guessing at a bare object.
 */
export function backupJson(now: number = Date.now()): string {
  return JSON.stringify({ version: 1, savedAt: now, items: collectLocalData() }, null, 2)
}

/**
 * Write a parsed backup back over localStorage.
 *
 * Returns how many entries landed. Zero means the file was not a backup worth
 * trusting — not an object, or nothing the app actually owns — so the caller can
 * refuse rather than half-restore something foreign.
 */
export function applyLocalData(payload: unknown): number {
  const items = (payload as { items?: unknown } | undefined)?.items
  if (!items || typeof items !== "object" || Array.isArray(items)) return 0
  let count = 0
  for (const [key, value] of Object.entries(items as Record<string, unknown>)) {
    if (typeof value !== "string") continue
    if (!owned(key)) continue
    localStorage.setItem(key, value)
    count += 1
  }
  return count
}
