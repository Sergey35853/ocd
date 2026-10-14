import { useMemo, useState } from "react"
import type { MessageInfo } from "@shared/types"
import { cx } from "../lib/format"
import { useT } from "../i18n"
import { IconChevron } from "./Icon"

/** The counters the server reports live, per session. */
export interface LiveUsage {
  cost: number
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  at: number
}

function empty(): LiveUsage {
  return { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, at: 0 }
}

/** Fold the persisted per-message figures into a session total. */
function fromMessages(messages: MessageInfo[]): LiveUsage {
  const total = empty()
  for (const message of messages) {
    const cost = typeof message.cost === "number" ? message.cost : 0
    const tokens = message.tokens
    total.cost += cost
    total.input += tokens?.input ?? 0
    total.output += tokens?.output ?? 0
    total.reasoning += tokens?.reasoning ?? 0
    total.cacheRead += tokens?.cache?.read ?? 0
    total.cacheWrite += tokens?.cache?.write ?? 0
  }
  if (total.cost || total.input || total.output) total.at = Date.now()
  return total
}

/**
 * Money and tokens for the current conversation.
 *
 * Prefers the live counters from `session.usage.updated` and falls back to the
 * figures stored on each message, so a conversation opened from cold still
 * shows its history's total. Collapsed to the cost alone; the breakdown is one
 * click away because nobody wants five numbers in a header.
 */
export function UsageMeter({
  messages,
  live,
  visible,
}: {
  messages: MessageInfo[]
  live: LiveUsage | undefined
  visible: boolean
}) {
  const t = useT()
  const [open, setOpen] = useState(false)

  const totals = useMemo(() => {
    const fromLog = fromMessages(messages)
    // Live numbers are cumulative for the session; only fall back when absent.
    if (!live || !live.at) return fromLog
    return { ...live, cost: live.cost || fromLog.cost }
  }, [messages, live])

  if (!visible) return null
  if (!totals.cost && !totals.input && !totals.output) return null

  const tokens = totals.input + totals.output + totals.reasoning
  const fresh = totals.at > Date.now() - 15_000

  return (
    <div className="usage">
      <button
        type="button"
        className={cx("usage-bar", open && "open", fresh && "live")}
        onClick={() => setOpen((value) => !value)}
        title={t("usage.detail")}
        aria-expanded={open}
      >
        <span className="usage-cost">{formatMoney(totals.cost)}</span>
        <span className="usage-tokens">{compact(tokens)}</span>
        <IconChevron size={12} className="flip" />
      </button>

      {open ? (
        <div className="usage-panel">
          <Row label={t("usage.input")} value={totals.input.toLocaleString("ru-RU")} />
          <Row label={t("usage.output")} value={totals.output.toLocaleString("ru-RU")} />
          {totals.reasoning ? (
            <Row label={t("usage.reasoning")} value={totals.reasoning.toLocaleString("ru-RU")} />
          ) : null}
          {totals.cacheRead ? (
            <Row
              label={t("usage.cacheRead")}
              value={totals.cacheRead.toLocaleString("ru-RU")}
              muted
            />
          ) : null}
          {totals.cacheWrite ? (
            <Row
              label={t("usage.cacheWrite")}
              value={totals.cacheWrite.toLocaleString("ru-RU")}
              muted
            />
          ) : null}
          <div className="usage-sep" />
          <Row label={t("usage.total")} value={compact(tokens)} />
          <Row label={t("usage.cost")} value={formatMoney(totals.cost)} strong />
        </div>
      ) : null}
    </div>
  )
}

function Row({
  label,
  value,
  muted,
  strong,
}: {
  label: string
  value: string
  muted?: boolean
  strong?: boolean
}) {
  return (
    <div className={cx("usage-row", muted && "muted", strong && "strong")}>
      <span>{label}</span>
      <span className="usage-value">{value}</span>
    </div>
  )
}

function compact(value: number): string {
  if (!value) return "0"
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}M`
}

/**
 * Money with a currency that only appears when the server reported one.
 *
 * Providers price in USD but report bare numbers; inventing "USD" for a plan
 * billed in credits would be a lie, so a zero-cost conversation shows no
 * currency at all.
 */
function formatMoney(value: number): string {
  if (!value) return "—"
  if (value < 0.01) return "<$0.01"
  return `$${value.toFixed(value < 10 ? 2 : 1)}`
}