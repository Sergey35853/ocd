import type {
  MessageContent,
  MessageInfo,
  SessionInfo,
  TokenUsage,
} from "@shared/types"
import { cleanText } from "./text"
import { getLanguage, translate } from "../i18n"

/** BCP-47 tags for date formatting — "ru" alone would not resolve. */
const DATE_LOCALE = {
  ru: "ru-RU",
  en: "en-US",
  de: "de-DE",
  fr: "fr-FR",
  zh: "zh-CN",
} as const

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ")
}

/** Compact age label: 15m, 6d — matches the Hermes sidebar style. */
export /**
 * "3 недели назад" from a timestamp.
 *
 * Also accepts an ISO string, because engines report `modified_at` that way
 * while the server's own message times are milliseconds.
 */
function shortAge(from?: number | string): string {
  if (!from) return ""
  const start = typeof from === "string" ? Date.parse(from) : from
  if (!Number.isFinite(start)) return ""
  const ms = Date.now() - start
  const min = Math.floor(ms / 60_000)
  if (min < 1) return translate("session.now")
  if (min < 60) return translate("session.ageMin", { n: min })
  const hours = Math.floor(min / 60)
  if (hours < 24) return translate("session.ageHour", { n: hours })
  const days = Math.floor(hours / 24)
  if (days < 30) return translate("session.ageDay", { n: days })
  const months = Math.floor(days / 30)
  if (months < 12) return translate("session.ageMonth", { n: months })
  return translate("session.ageYear", { n: Math.floor(months / 12) })
}

const DAY = 86_400_000

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Relative group headings: Today / This week / September, localised. */
export function groupSessions(sessions: SessionInfo[]): Array<{ label: string; items: SessionInfo[] }> {
  const now = Date.now()
  const today = startOfDay(now)
  const buckets = new Map<string, SessionInfo[]>()
  const order: string[] = []

  for (const session of sessions) {
    const ts = session.time?.created ?? session.time?.updated ?? 0
    const day = startOfDay(ts)
    let label: string
    if (day === today) label = translate("session.today")
    else if (day >= today - 6 * DAY) label = translate("session.week")
    else if (day >= startOfDay(now - 29 * DAY)) label = translate("session.month")
    else {
      const d = new Date(ts)
      const sameYear = d.getFullYear() === new Date().getFullYear()
      label = d.toLocaleDateString(DATE_LOCALE[getLanguage()], {
        month: "long",
        ...(sameYear ? {} : { year: "numeric" }),
      })
    }
    const key = `${label}`
    if (!buckets.has(key)) {
      buckets.set(key, [])
      order.push(key)
    }
    buckets.get(key)!.push(session)
  }

  return order.map((label) => ({
    label,
    items: [...buckets.get(label)!].sort(
      (a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0),
    ),
  }))
}

/** Assistant/user text pulled out of a message's content array. */
export function textOf(content: MessageContent[] | undefined): string {
  if (!Array.isArray(content)) return ""
  return content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    // Cleaned here rather than at the call sites: this is the one place every
    // rendered answer passes through, and a NUL that slips past one caller
    // shows up on screen as a replacement glyph and in the search index.
    .map((block) => cleanText(block.text as string))
    .join("\n\n")
}

export function toolBlocks(content: MessageContent[] | undefined): MessageContent[] {
  if (!Array.isArray(content)) return []
  return content.filter((block) => block.type === "tool")
}

export function reasoningText(content: MessageContent[] | undefined): string {
  if (!Array.isArray(content)) return ""
  return content
    .filter((block) => block.type === "reasoning" && typeof block.text === "string")
    .map((block) => cleanText(block.text as string))
    .join("\n\n")
}

/** The API returns newest-first; the stream renders oldest-first. */
export function chronological(messages: MessageInfo[]): MessageInfo[] {
  return messages
    .filter((message) => message && message.id)
    .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))
}

/** "idle" bookkeeping rows are not chat turns. */
export function chatTurns(messages: MessageInfo[]): MessageInfo[] {
  return chronological(messages).filter((message) => message.type === "user" || message.type === "assistant")
}

/** Human-readable failure text from an OpenCode message error. */
export function errorText(error: MessageInfo["error"]): string {
  if (!error) return ""
  const message = error.message ?? error.data?.message ?? error.name ?? error.type ?? ""
  const status = error.status ? ` (HTTP ${error.status})` : ""
  return `${message}${status}`
}

/** "provider.auth" -> "provider: auth" style hint for known failures. */
export function errorHint(error: MessageInfo["error"]): string {
  const text = errorText(error).toLowerCase()
  if (!text) return ""
  if (text.includes("not available in your country")) {
    return translate("err.regionLocked")
  }
  if (text.includes("rate limit") || text.includes("too many requests")) {
    return translate("err.rateLimit")
  }
  if (text.includes("quota") || text.includes("limit reached")) {
    return translate("err.quota")
  }
  if (text.includes("api key") || text.includes("unauthorized")) {
    return translate("err.needKey")
  }
  return ""
}

export function prettyJson(value: unknown): string {
  if (value === undefined) return ""
  if (typeof value === "string") return cleanText(value)
  try {
    return cleanText(JSON.stringify(value, null, 2) ?? String(value))
  } catch {
    return cleanText(String(value))
  }
}

export function toolLabel(block: MessageContent): string {
  const title = block.state?.title
  if (typeof title === "string" && title.trim()) return title
  const input = block.state?.input
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>
    for (const key of ["path", "filePath", "command", "pattern", "query", "url", "description"]) {
      const value = record[key]
      if (typeof value === "string" && value.trim()) return value
    }
  }
  return block.tool ?? translate("tool.fallback")
}

export function formatTokens(tokens: TokenUsage | undefined): string {
  if (!tokens) return ""
  const parts: string[] = []
  if (tokens.input) parts.push(`${translate("tok.in")} ${tokens.input}`)
  if (tokens.output) parts.push(`${translate("tok.out")} ${tokens.output}`)
  if (tokens.reasoning) parts.push(`${translate("tok.think")} ${tokens.reasoning}`)
  const cache = tokens.cache
  if (cache?.read) parts.push(`${translate("tok.cache")} ${cache.read}`)
  return parts.join(" · ")
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return ""
  if (bytes < 1024) return translate("size.bytes", { n: bytes })
  if (bytes < 1024 * 1024) return translate("size.kb", { n: Math.round(bytes / 1024) })
  const mb = bytes / (1024 * 1024)
  // A model weighs gigabytes, and "8571.7 МБ" is a number nobody reads. From a
  // gigabyte the unit that says something is the larger one.
  if (mb < 1024) return translate("size.mb", { n: mb.toFixed(1) })
  return translate("size.gb", { n: (mb / 1024).toFixed(1) })
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}