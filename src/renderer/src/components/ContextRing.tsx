import type { MessageInfo, ModelInfo } from "@shared/types"
import { getLanguage, translate } from "../i18n"

/** BCP-47 tags for grouping the token counts. */
const NUMBER_LOCALE = {
  ru: "ru-RU",
  en: "en-US",
  de: "de-DE",
  fr: "fr-FR",
  zh: "zh-CN",
} as const

/** Fallback when the server does not report a context window. */
const ASSUMED_LIMIT = 200_000

interface Props {
  messages: MessageInfo[]
  models: ModelInfo[]
  providerID?: string
  modelID?: string
}

export interface ContextUsage {
  used: number
  limit: number
  ratio: number
  percent: number
}

/**
 * Work out how much of the model's context window the conversation occupies.
 *
 * Everything the model has to read counts: the fresh prompt, cached history,
 * cache writes and reasoning tokens. Output is excluded because it is not
 * re-read on the next turn.
 */
export function contextUsage({ messages, models, providerID, modelID }: Props): ContextUsage {
  let latest: MessageInfo | undefined
  for (const message of messages) {
    if (message.type === "assistant" && message.tokens) {
      latest = message
      break
    }
  }

  const tokens = latest?.tokens
  const used =
    (tokens?.input ?? 0) +
    (tokens?.cache?.read ?? 0) +
    (tokens?.cache?.write ?? 0) +
    (tokens?.reasoning ?? 0)

  const model = models.find(
    (item) => item.id === modelID && (!providerID || item.providerID === providerID),
  )
  const limit = model?.limit?.context && model.limit.context > 0 ? model.limit.context : ASSUMED_LIMIT

  const ratio = limit > 0 ? Math.min(used / limit, 1) : 0
  return { used, limit, ratio, percent: Math.round(ratio * 100) }
}

function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`
  return String(value)
}

/** Donut gauge for context window usage. */
export function ContextRing(props: Props) {
  const { used, limit, ratio, percent } = contextUsage(props)
  if (used <= 0) return null

  const size = 17
  const stroke = 2.5
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r

  const tone = ratio >= 0.9 ? "var(--danger)" : ratio >= 0.7 ? "var(--warn)" : "var(--accent)"

  const locale = NUMBER_LOCALE[getLanguage()]
  const title = translate("chat.contextUsage", {
    used: used.toLocaleString(locale),
    limit: limit.toLocaleString(locale),
    percent,
  })

  return (
    <span className="ctxring" title={title} role="img" aria-label={title}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--line-strong)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="ctxring-label" style={{ color: tone }}>
        {compact(used)}
      </span>
    </span>
  )
}