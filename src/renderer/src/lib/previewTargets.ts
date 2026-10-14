import type { MessageContent } from "@shared/types"
import { previewSpec, type PreviewKind, type PreviewRoute } from "@shared/preview"

export type { PreviewKind, PreviewRoute }

// ---------------------------------------------------------------------------
// Inline markup in an assistant reply
// ---------------------------------------------------------------------------

const FENCE = /^([ \t]*)(`{3,}|~{3,})[ \t]*([\w+-]*)[^\n]*\n([\s\S]*?)\n?\1?\2[ \t]*$/gm

const MARKUP_LANGS = new Set(["html", "htm", "xhtml"])
const DOCUMENT_START = /^\s*(<!DOCTYPE\s+html|<html\b)/i

export interface HtmlSnippet {
  /** Stable key for React and for reusing an already staged file. */
  id: string
  html: string
  /** First heading or <title>, for the pane's tab label. */
  title: string
}

/** Trim the shared indent so a nested fence still yields a valid document. */
function dedent(source: string): string {
  const lines = source.replace(/\s+$/, "").split("\n")
  const indents = lines
    .filter((line) => line.trim())
    .map((line) => line.match(/^[ \t]*/)?.[0].length ?? 0)
  const shared = indents.length ? Math.min(...indents) : 0
  return shared > 0 ? lines.map((line) => line.slice(shared)).join("\n") : lines.join("\n")
}

function titleOf(html: string, fallback: string): string {
  const heading =
    /<h[1-3][^>]*>([\s\S]{0,120}?)<\/h[1-3]>/i.exec(html) ??
    /<title[^>]*>([\s\S]{0,120}?)<\/title>/i.exec(html)
  const text = heading?.[1]
    ?.replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return text || fallback
}

/**
 * Pull renderable HTML out of an assistant reply.
 *
 * The model usually answers "here is a dashboard" with a ```html fence, and
 * that inline markup is the common case worth previewing. Only HTML qualifies:
 * a fenced ```svg or ```json is source the user asked to read, not an artifact
 * to run, and staging it would hand page-authored script to the pane.
 */
export function htmlSnippets(text: string): HtmlSnippet[] {
  if (!text.includes("<")) return []
  const found: HtmlSnippet[] = []
  let match: RegExpExecArray | null

  FENCE.lastIndex = 0
  while ((match = FENCE.exec(text)) !== null) {
    const [, , , lang, body] = match
    const source = dedent(body)
    if (!source.includes("<")) continue
    const tagged = lang.toLowerCase()
    if (!MARKUP_LANGS.has(tagged) && !(tagged === "" && DOCUMENT_START.test(source))) continue

    found.push({
      id: `fence-${hash(source)}`,
      html: source,
      title: titleOf(source, `HTML ${found.length + 1}`),
    })
  }

  return found
}

/** One piece of an assistant reply: prose, or a previewable HTML fence. */
export type TextSegment =
  | { kind: "text"; text: string }
  | { kind: "snippet"; snippet: HtmlSnippet; fence: string }

/**
 * Split a reply into prose and previewable HTML fences, keeping the fence text
 * so the button can sit right under the code the user already reads.
 */
export function segmentText(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  let cursor = 0

  for (const snippet of htmlSnippets(text)) {
    const at = text.indexOf(snippet.html, cursor)
    if (at < 0) continue
    if (at > cursor) segments.push({ kind: "text", text: text.slice(cursor, at) })
    segments.push({
      kind: "snippet",
      snippet,
      // The dedented body is what loads; show the original spacing instead so
      // the code block still looks like it did in the reply.
      fence: text.slice(at, at + snippet.html.length),
    })
    cursor = at + snippet.html.length
  }

  if (cursor < text.length) segments.push({ kind: "text", text: text.slice(cursor) })
  return segments.length ? segments : [{ kind: "text", text }]
}

// ---------------------------------------------------------------------------
// Files the agent produced
// ---------------------------------------------------------------------------

export interface PreviewFile {
  path: string
  kind: PreviewKind
  route: PreviewRoute
}

/**
 * Files a tool call touched that the pane can display.
 *
 * Only the `path`-shaped inputs are read: a `command` like `cat x.htm` mentions
 * a path without producing one, and treating that as an artifact would put a
 * button on calls that never wrote anything.
 */
export function previewFiles(blocks: MessageContent[]): PreviewFile[] {
  const found: PreviewFile[] = []
  const seen = new Set<string>()

  for (const block of blocks) {
    if (block.type !== "tool") continue
    const input = block.state?.input
    if (!input || typeof input !== "object") continue
    const record = input as Record<string, unknown>

    for (const key of ["filePath", "path", "file"]) {
      const value = record[key]
      if (typeof value !== "string" || seen.has(value)) continue
      const spec = previewSpec(value)
      if (!spec) continue
      seen.add(value)
      found.push({ path: value, kind: spec.kind, route: spec.route })
    }
  }

  return found
}

/**
 * Paths to previewable files that the answer merely *mentions*.
 *
 * A model very often finishes with "Готово: `C:\...\chart.html`" without a
 * tool call in that turn — the file was written a step earlier, or in a
 * different turn entirely. Looking only at tool inputs missed those, which is
 * why the pane used to stay shut on the most common shape of answer there is.
 *
 * Returned as plain paths and deliberately unverified: existence is the
 * main process's call, and it will reject a path that is not really a file.
 * Requiring the extension to be previewable keeps ordinary source paths
 * (`src\index.ts`) out of the result.
 */
export function mentionedFiles(text: string): PreviewFile[] {
  if (!text || !text.includes(".")) return []

  // Inside backticks first: that is how models quote a path, and it delimits
  // names containing spaces. The bare form is a fallback for `foo.html`.
  const candidates: string[] = []
  const QUOTED = /`([^`\n]*?\.[A-Za-z0-9]{1,6})`/g
  let match: RegExpExecArray | null
  while ((match = QUOTED.exec(text)) !== null) candidates.push(match[1])

  const BARE = /(?:^|[\s(])((?:[A-Za-z]:[\\/]|\\\\|\/)[^\s"'<>|)]*?\.[A-Za-z0-9]{1,6})/g
  while ((match = BARE.exec(text)) !== null) candidates.push(match[1])

  const found: PreviewFile[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const path = candidate.trim().replace(/[.,;:]+$/, "")
    if (!path || seen.has(path)) continue
    const spec = previewSpec(path)
    if (!spec) continue
    seen.add(path)
    found.push({ path, kind: spec.kind, route: spec.route })
  }
  return found
}

/** Short stable digest, used only to key snippets. */
function hash(source: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}