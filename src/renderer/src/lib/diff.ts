/**
 * What the agent changed, read out of the tool calls that changed it.
 *
 * OpenCode offers no way to ask "what has changed in this session": there is no
 * diff endpoint, no revision history and no comparison against the disk. What
 * the transcript does carry is every `edit` call with the exact text it
 * replaced and the exact text it wrote instead - which is a diff, already
 * computed, stored by the server. So the changes view is built from the
 * conversation rather than from the file system: it shows what the agent said
 * it changed, which is also the only answer available when a conversation is
 * re-read days later, or when the file has since been edited again by hand.
 *
 * Everything here is pure and synchronous so it can be tested without a server.
 */

import type { FileDiffInfo, MessageContent, MessageInfo } from "@shared/types"
import { chronological } from "./format"

/** One row of a diff. */
export interface DiffLine {
  kind: "add" | "del" | "ctx" | "meta"
  text: string
  /** Line number in the old file; null on an added line. */
  oldNo: number | null
  /** Line number in the new file; null on a removed line. */
  newNo: number | null
}

export interface DiffStats {
  added: number
  removed: number
}

/**
 * Ceiling on the cells the LCS table may hold.
 *
 * A whole-file rewrite of a large file can be tens of thousands of lines, and
 * the table is quadratic in that. Past the limit the middle of the change is
 * reported as a block replacement instead of an exact diff: a blunt answer that
 * renders instantly beats a precise one that freezes the window.
 */
const MAX_CELLS = 1_500_000

/** Context lines around each change in an exported patch. */
const PATCH_CONTEXT = 3

// ---------------------------------------------------------------------------
// Diffing
// ---------------------------------------------------------------------------

/**
 * Split into lines, without inventing a trailing empty one.
 *
 * A file ending in a newline has no last line, and counting one would put an
 * empty context row at the bottom of every diff and an extra line in every
 * export.
 */
function splitLines(text: string): string[] {
  if (text === "") return []
  const lines = text.split(/\r?\n/)
  if (lines[lines.length - 1] === "") lines.pop()
  return lines
}

/**
 * Line diff of two texts.
 *
 * The common prefix and suffix are stripped before anything else, which is what
 * keeps the quadratic part small on the common case: an edit inside a big file
 * leaves a handful of changed lines in the middle and thousands of identical
 * ones around them.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before)
  const b = splitLines(after)

  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1

  let tail = 0
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail += 1
  }

  const out: DiffLine[] = []
  for (let i = 0; i < head; i += 1) {
    out.push({ kind: "ctx", text: a[i], oldNo: i + 1, newNo: i + 1 })
  }
  out.push(...diffMiddle(a.slice(head, a.length - tail), b.slice(head, b.length - tail), head))
  for (let i = 0; i < tail; i += 1) {
    out.push({
      kind: "ctx",
      text: a[a.length - tail + i],
      oldNo: a.length - tail + i + 1,
      newNo: b.length - tail + i + 1,
    })
  }
  return out
}

/** The part between the common prefix and the common suffix. */
function diffMiddle(a: string[], b: string[], offset: number): DiffLine[] {
  const added = (text: string, i: number): DiffLine => ({
    kind: "add",
    text,
    oldNo: null,
    newNo: offset + i + 1,
  })
  const removed = (text: string, i: number): DiffLine => ({
    kind: "del",
    text,
    oldNo: offset + i + 1,
    newNo: null,
  })

  if (a.length === 0) return b.map(added)
  if (b.length === 0) return a.map(removed)

  if (a.length * b.length > MAX_CELLS) {
    // Too big to align exactly: report the block as replaced. The line numbers
    // stay correct, only the pairing inside the block is coarse.
    return [...a.map(removed), ...b.map((text, i) => added(text, a.length + i))]
  }

  // table[i * width + j] is the length of the longest common subsequence of
  // a[i..] and b[j..], filled backwards so the walk below can read it forward.
  const width = b.length + 1
  const table = new Int32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "ctx", text: a[i], oldNo: offset + i + 1, newNo: offset + j + 1 })
      i += 1
      j += 1
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      out.push(removed(a[i], i))
      i += 1
    } else {
      out.push(added(b[j], j))
      j += 1
    }
  }
  while (i < a.length) {
    out.push(removed(a[i], i))
    i += 1
  }
  while (j < b.length) {
    out.push(added(b[j], j))
    j += 1
  }
  return out
}

export function diffStats(lines: DiffLine[]): DiffStats {
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.kind === "add") added += 1
    else if (line.kind === "del") removed += 1
  }
  return { added, removed }
}

// ---------------------------------------------------------------------------
// Reading changes out of tool calls
// ---------------------------------------------------------------------------

/** How a call changed a file. */
export type StepKind = "patch" | "edit" | "write"

/** One tool call that changed a file. */
export interface EditStep {
  kind: StepKind
  /** The file the call named, or the one its patch header names. */
  path: string
  /**
   * The text the call replaced, when the call said so.
   *
   * Empty for a server patch and for a write: neither states what was on the
   * disk before it ran, and a guess would read as certainty.
   */
  before: string
  /** The text the call wrote; for a patch, the patch itself. */
  after: string
  /** Lines of the call's own diff, so every step can be shown on its own. */
  lines: DiffLine[]
  /**
   * The server's own unified diff for this file, verbatim.
   *
   * Preferred over anything rebuilt here: it knows the state of the file before
   * the call, which a write never reports and which is gone by the time the
   * conversation is read back.
   */
  patch: string | null
  /** Status the server reported: added, deleted or modified. */
  status: string | null
  /** Stable key for React. */
  key: string
}

export interface FileChange {
  path: string
  /** How many tool calls touched the file. */
  edits: number
  /**
   * Whether `lines` describes the whole file in one pass.
   *
   * Server patches always do: they were computed against the file as it stood
   * when the call ran, so concatenating them in order is the file's history.
   * Rebuilt steps chain only while each call's "before" is the previous call's
   * "after"; the chain breaks when something else edited the file in between,
   * and then the honest thing to show is one block per call.
   */
  exact: boolean
  lines: DiffLine[]
  stats: DiffStats
  /** Rewritten whole with no "before" to compare against. */
  whole: boolean
  /** True when every step came from the server's own diff. */
  authoritative: boolean
  steps: EditStep[]
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

/** Tool name, whichever of the two spellings this server uses. */
export function toolName(block: MessageContent): string {
  return block.tool ?? block.name ?? ""
}

/** Tool call id, whichever of the two spellings this server uses. */
export function callKey(block: MessageContent): string | undefined {
  return block.callID ?? block.id ?? undefined
}

function filePathOf(record: Record<string, unknown>): string | null {
  for (const key of ["filePath", "path", "file"]) {
    const value = text(record[key])
    if (value && value.trim()) return value
  }
  return null
}

/**
 * The files the server says this call changed, with its own diff for each.
 *
 * This is the authoritative source and the first one tried: a call that writes
 * a whole file says nothing about what was there before, and only the server
 * was there to see it.
 */
function serverFiles(block: MessageContent): FileDiffInfo[] {
  const files = block.state?.metadata?.files
  if (!Array.isArray(files)) return []
  const out: FileDiffInfo[] = []
  for (const item of files) {
    if (!item || typeof item !== "object") continue
    const file = (item as FileDiffInfo).file
    const patch = (item as FileDiffInfo).patch
    if (typeof file !== "string" || !file.trim()) continue
    if (typeof patch !== "string") continue
    out.push(item as FileDiffInfo)
  }
  return out
}

/**
 * The steps one tool call stands for.
 *
 * Matched on shape rather than on the tool name, for the reason the rest of the
 * interface does it too: the server reports several of these calls with an
 * empty tool name, so keying on names would silently drop them.
 */
export function stepsOf(block: MessageContent): EditStep[] {
  if (block.type !== "tool") return []
  // A call that failed changed nothing, and its half-finished intent is not a
  // change worth showing.
  if (block.state?.status === "error") return []
  const call = callKey(block) ?? block.state?.title ?? "call"

  const reported = serverFiles(block)
  if (reported.length) {
    return reported.map((file, index) => ({
      kind: "patch" as const,
      path: file.file,
      before: "",
      after: "",
      lines: parsePatch(file.patch),
      patch: file.patch,
      status: file.status ?? null,
      key: `${call}:${index}`,
    }))
  }

  const input = block.state?.input
  if (!input || typeof input !== "object") return []
  const record = input as Record<string, unknown>

  const raw = text(record.patch) ?? text(record.diff)
  if (raw && raw.trim()) {
    const path = filePathOf(record) ?? pathFromPatch(raw) ?? "changes.patch"
    return [
      {
        kind: "patch",
        path,
        before: "",
        after: "",
        lines: parsePatch(raw),
        patch: raw,
        status: null,
        key: `${call}:patch`,
      },
    ]
  }

  const path = filePathOf(record)
  if (!path) return []

  // Multi-edit: several replacements of one file in a single call.
  const edits = record.edits ?? record.replacements
  if (Array.isArray(edits)) {
    const steps: EditStep[] = []
    edits.forEach((item, index) => {
      if (!item || typeof item !== "object") return
      const pair = item as Record<string, unknown>
      const before = text(pair.oldString) ?? ""
      const after = text(pair.newString) ?? ""
      steps.push({
        kind: "edit",
        path,
        before,
        after,
        lines: diffLines(before, after),
        patch: null,
        status: null,
        key: `${call}:${index}`,
      })
    })
    if (steps.length) return steps
  }

  const before = text(record.oldString)
  const after = text(record.newString)
  if (before !== null || after !== null) {
    const old = before ?? ""
    const next = after ?? ""
    return [
      {
        kind: "edit",
        path,
        before: old,
        after: next,
        lines: diffLines(old, next),
        patch: null,
        status: null,
        key: call,
      },
    ]
  }

  const content = text(record.content)
  if (content !== null) {
    return [
      {
        kind: "write",
        path,
        before: "",
        after: content,
        lines: diffLines("", content),
        patch: null,
        status: null,
        key: call,
      },
    ]
  }

  return []
}

/**
 * The file a raw patch names, read off its own header.
 *
 * Both spellings are accepted: git writes `+++ b/path`, and the server's own
 * patches use bare absolute paths in `---` and `+++`.
 */
function pathFromPatch(patch: string): string | null {
  const plus = /^\+\+\+ (?:b\/)?(.+)$/m.exec(patch)
  if (plus) return plus[1].trim()
  const minus = /^--- (?:a\/)?(.+)$/m.exec(patch)
  return minus ? minus[1].trim() : null
}

/**
 * Read a unified diff that a tool handed over verbatim.
 *
 * The hunk headers are kept as `meta` rows: they carry the line numbers the
 * author claimed, which is worth showing even when the app cannot check them.
 */
export function parsePatch(patch: string): DiffLine[] {
  const raw = patch.split(/\r?\n/)
  // A patch that ends with a newline leaves one empty row behind, which would
  // render as a context line that was never in the diff.
  if (raw.length > 1 && raw[raw.length - 1] === "") raw.pop()

  const out: DiffLine[] = []
  for (const line of raw) {
    const sign = line[0]
    const text = line.slice(1)
    if (line.startsWith("--- ") || line.startsWith("+++ ")) continue
    // The server prefixes its patches with `Index: <path>` and a rule of `=`,
    // the way git does with `diff --git` and `index`.
    if (line.startsWith("@@")) {
      out.push({ kind: "meta", text: line, oldNo: null, newNo: null })
      continue
    }
    if (line.startsWith("Index: ") || line.startsWith("index ")) continue
    if (/^={3,}$/.test(line) || line.startsWith("diff ")) continue
    if (sign === "+") out.push({ kind: "add", text, oldNo: null, newNo: null })
    else if (sign === "-") out.push({ kind: "del", text, oldNo: null, newNo: null })
    else if (line.startsWith(" ") || line === "") out.push({ kind: "ctx", text, oldNo: null, newNo: null })
  }
  return out
}

/**
 * Every file the conversation changed, oldest change first.
 *
 * Windows paths are case-insensitive, so two spellings of the same file are one
 * entry; the first spelling is the one shown.
 */
export function sessionChanges(messages: MessageInfo[]): FileChange[] {
  const files = new Map<string, FileChange & { base: string | null; head: string | null }>()

  for (const message of chronological(messages)) {
    for (const block of message.content ?? []) {
      for (const step of stepsOf(block)) {
        const id = step.path.toLowerCase()
        const existing = files.get(id)
        if (!existing) {
          const fresh = newFile(step.path)
          fresh.steps.push(step)
          fresh.edits = 1
          applyStep(fresh, step)
          files.set(id, fresh)
          continue
        }
        existing.steps.push(step)
        existing.edits += 1
        applyStep(existing, step)
      }
    }
  }

  const changes: FileChange[] = []
  for (const entry of files.values()) {
    const { base, head, ...rest } = entry
    if (rest.exact && rest.authoritative) {
      // Server patches were computed against the file as it stood before each
      // call, so laying them end to end is the whole story of the file — and
      // the only way to see deletions on a whole-file write.
      const lines = rest.steps.flatMap((step) => step.lines)
      changes.push({ ...rest, lines, stats: diffStats(lines) })
    } else if (rest.exact) {
      // Rebuilt edits that chain: one diff of the first "before" to the last
      // "after", which is the file as a whole.
      const lines = diffLines(base ?? "", head ?? "")
      changes.push({ ...rest, lines, stats: diffStats(lines) })
    } else {
      // A broken chain: the numbers still add up, but only per call.
      changes.push({ ...rest, lines: [], stats: diffStats(rest.steps.flatMap((step) => step.lines)) })
    }
  }
  return changes
}

function newFile(path: string): FileChange & { base: string | null; head: string | null } {
  return {
    path,
    edits: 0,
    exact: true,
    lines: [],
    stats: { added: 0, removed: 0 },
    whole: false,
    authoritative: true,
    steps: [],
    base: null,
    head: null,
  }
}

/** Fold one more step into the file's running before/after. */
function applyStep(entry: FileChange & { base: string | null; head: string | null }, step: EditStep): void {
  if (step.kind === "patch") {
    // A patch from the server is exact on its own: it was computed against the
    // file as it stood. A raw patch from a tool is not, so it stands alone.
    if (step.patch !== null) return
    entry.authoritative = false
    entry.exact = false
    return
  }
  if (step.kind === "write") {
    entry.whole = true
    // Nothing to rebuild a diff from: the call reported the new text only, and
    // whatever was on the disk is gone.
    entry.authoritative = false
    if (entry.base === null) {
      entry.base = ""
      entry.head = step.after
      return
    }
    if (entry.head === step.after) return
    entry.exact = false
    return
  }
  if (entry.base === null) {
    // Reconstructed from what the call said it replaced, not from the server:
    // right for a plain edit, and the only account available at all when the
    // call is a write that never named the old text.
    entry.authoritative = false
    entry.base = step.before
    entry.head = step.after
    return
  }
  if (entry.exact && entry.head === step.before) {
    entry.authoritative = false
    entry.head = step.after
    return
  }
  entry.authoritative = false
  entry.exact = false
}

export interface ChangeTotals {
  files: number
  added: number
  removed: number
}

export function changeTotals(changes: FileChange[]): ChangeTotals {
  let added = 0
  let removed = 0
  for (const change of changes) {
    added += change.stats.added
    removed += change.stats.removed
  }
  return { files: changes.length, added, removed }
}

// ---------------------------------------------------------------------------
// Patch export
// ---------------------------------------------------------------------------

/**
 * Render a change as a unified diff, ready for `git apply`.
 *
 * A server patch is passed through untouched: it was computed against the real
 * file, so rewriting it from the parsed rows could only lose something. Only a
 * diff rebuilt here gets its context trimmed, because the alternative there is
 * a file-length patch for a one-line edit, which nobody reads and nobody
 * applies. A file whose edits did not chain has no single honest diff, so it
 * falls back to one block per tool call.
 */
export function toPatch(change: FileChange): string {
  const reported = change.steps.map(stepPatch).join("")
  if (reported) return reported
  return change.exact ? linesToPatch(change.path, change.lines) : ""
}

/** Each step's own patch, for a file whose edits did not chain. */
export function stepsPatch(change: FileChange): string {
  return change.steps.map(stepPatch).join("")
}

function stepPatch(step: EditStep): string {
  if (!step.patch) return linesToPatch(step.path, step.lines)
  return step.patch.endsWith("\n") ? step.patch : `${step.patch}\n`
}

function linesToPatch(path: string, lines: DiffLine[]): string {
  const unchanged = (line: DiffLine) => line.kind === "ctx" || line.kind === "meta"
  const changed = lines.map((line, index) => (unchanged(line) ? -1 : index)).filter((i) => i >= 0)
  if (!changed.length) return ""

  const spans: Array<[number, number]> = []
  for (const index of changed) {
    const from = Math.max(0, index - PATCH_CONTEXT)
    const to = Math.min(lines.length - 1, index + PATCH_CONTEXT)
    const last = spans[spans.length - 1]
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to)
    else spans.push([from, to])
  }

  const hasOld = lines.some((line) => line.oldNo !== null)
  const hasNew = lines.some((line) => line.newNo !== null)

  let out = hasOld ? `--- a/${path}\n+++ b/${path}\n` : `--- /dev/null\n+++ b/${path}\n`
  if (!hasNew) out = `--- a/${path}\n+++ /dev/null\n`

  for (const [from, to] of spans) {
    const slice = lines.slice(from, to + 1)
    const oldNumbers = slice.filter((line) => line.oldNo !== null).map((line) => line.oldNo as number)
    const newNumbers = slice.filter((line) => line.newNo !== null).map((line) => line.newNo as number)
    const oldCount = oldNumbers.length
    const newCount = newNumbers.length
    // A hunk with no old lines still needs a position: the line before the
    // insertion, which is why a pure addition at the top of a file reads -0,0.
    const oldStart = oldCount
      ? (oldNumbers[0] as number)
      : Math.max(0, (newNumbers[0] ?? 1) - 1)
    const newStart = newCount ? (newNumbers[0] as number) : Math.max(1, (oldNumbers[0] ?? 1))
    out += `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n`
    for (const line of slice) {
      if (line.kind === "del") out += `-${line.text}\n`
      else if (line.kind === "add") out += `+${line.text}\n`
      else out += ` ${line.text}\n`
    }
  }
  return out
}

/** The whole conversation's changes as one patch file. */
export function patchDocument(changes: FileChange[]): string {
  return changes
    .map((change) => (change.exact ? toPatch(change) : stepsPatch(change)))
    .filter(Boolean)
    .join("\n")
}

/** Whether the diffs of this conversation are the server's own. */
export function allAuthoritative(changes: FileChange[]): boolean {
  return changes.length > 0 && changes.every((change) => change.authoritative)
}