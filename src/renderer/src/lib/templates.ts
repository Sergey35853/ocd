/**
 * The user's own starting points for a prompt.
 *
 * A template is a piece of text the user writes once and puts into the
 * composer as often as they like: a review checklist, a bug report skeleton,
 * the question they ask every morning. They live on this machine and nowhere
 * else — the server has no place for them, and they are not worth sending
 * anywhere.
 */

export interface PromptTemplate {
  id: string
  name: string
  text: string
}

const KEY = "ocd.templates.v1"

/** Read the templates, or nothing when the storage is not available. */
export function readTemplates(): PromptTemplate[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => ({
        id: String(item.id ?? ""),
        name: String(item.name ?? ""),
        text: String(item.text ?? ""),
      }))
      .filter((item) => item.id && item.text)
  } catch {
    // A corrupt list is not worth an error: the screen simply starts empty.
    return []
  }
}

/** Write the templates back. */
export function writeTemplates(list: PromptTemplate[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* private mode or full quota: the templates simply will not survive */
  }
}

/**
 * The placeholders a template uses.
 *
 * `{что-то}` is a hole in the text: the template is inserted with the hole
 * marked, and the user writes over it. The braces are ASCII on purpose — the
 * text of a prompt is usually about code, and a brace in it is a brace.
 */
export function placeholders(text: string): Array<{ name: string; at: number; length: number }> {
  const found: Array<{ name: string; at: number; length: number }> = []
  const pattern = /\{([a-zA-Z0-9_.-]{1,40})\}/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    found.push({ name: match[1], at: match.index, length: match[0].length })
  }
  return found
}

/** A new template with an id of its own. */
export function newTemplate(name: string, text: string): PromptTemplate {
  return {
    id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim() || "template",
    text,
  }
}
