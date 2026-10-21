import { useEffect, useMemo, useRef, useState } from "react"
import type { LimitWindow, RequestLimits } from "@shared/types"
import { cx } from "../lib/format"
import { useT, type DictKey } from "../i18n"
import { IconChevron, IconGauge, IconPencil } from "./Icon"

/** The window the chip leads with: the tightest one that actually has a limit. */
function headline(windows: RequestLimits["windows"]): RequestLimits["windows"][number] | null {
  const limited = windows.find((item) => item.limit !== null && item.used > 0)
  return limited ?? windows.find((item) => item.limit !== null) ?? null
}

/** "2 ч 14 м" / "47 мин" / "38 с" — short enough for a panel row. */
export function countdown(ms: number): string {
  if (ms <= 0) return "0"
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}с`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ч ${minutes % 60} мин`
  const days = Math.floor(hours / 24)
  return `${days} д ${hours % 24} ч`
}

const WINDOW_LABEL: Record<LimitWindow, DictKey> = {
  "5h": "limit.w5h",
  day: "limit.wDay",
  week: "limit.wWeek",
  month: "limit.wMonth",
}

/**
 * How many requests this conversation's model still has before a provider stops
 * answering.
 *
 * The server publishes no quota, so the numbers here are two different things
 * and the header never pretends otherwise: the count is what OCD watched go
 * out, and the ceiling is a remembered figure (built-in for Zen's free pool,
 * typed by the user otherwise). Both are stated as such in the panel rather
 * than dressed up as live telemetry.
 *
 * Hidden entirely when there is nothing to say — no counts and no limit.
 */
export function LimitMeter({
  model,
  limits,
  now,
  visible,
  onRefresh,
  onSetLimit,
  onReset,
}: {
  /** "<provider>/<id>", or null when no model is pinned to this session. */
  model: string | null
  /** Ledger keyed by model, as read from main. The one this session runs on wins. */
  limits: Record<string, RequestLimits> | undefined
  /** Ticking clock from the store, so the countdown moves without a timer. */
  now: number
  visible: boolean
  onRefresh(model: string): void
  onSetLimit(model: string, window: LimitWindow, limit: number | null): void
  onReset(model: string): void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<LimitWindow | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  /**
   * The callback, kept out of the dependencies.
   *
   * It arrives as an inline arrow from the chat, so it is a new function on
   * every render: depending on it called it again on every render, and its
   * answer started the next round. The tally is asked for when the model
   * changes and not otherwise.
   */
  const refreshRef = useRef(onRefresh)
  useEffect(() => {
    refreshRef.current = onRefresh
  }, [onRefresh])

  // The tally only moves when a request goes out, so it is fetched on mount
  // and whenever the pinned model changes — not on a timer.
  useEffect(() => {
    if (!model) return
    refreshRef.current(model)
  }, [model])

  useEffect(() => {
    if (!open) return
    const away = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", away)
    document.addEventListener("keydown", key)
    return () => {
      document.removeEventListener("mousedown", away)
      document.removeEventListener("keydown", key)
    }
  }, [open])

  const snapshot = model ? limits?.[model] : undefined
  const lead = snapshot ? headline(snapshot.windows) : null
  const cooldownUntil = snapshot?.cooldownUntil ?? null
  // Read off the store clock, which is what decides whether to keep ticking.
  const refusing = cooldownUntil !== null && cooldownUntil > now

  const ratio = useMemo(() => {
    if (!lead || !lead.limit) return null
    return Math.min(lead.used / lead.limit, 1)
  }, [lead])

  /**
   * A clock of this panel's own.
   *
   * The store's `now` advances only while a turn is running, which is right for
   * the timers around it and wrong here: "frees up in 3 мин" and the wait after
   * a refusal both count time passing while nothing happens. So the panel ticks
   * itself while it is open, and the chip carries on ticking until a refusal
   * clears — the only two moments this figure is on screen and moving.
   */
  const [tick, setTick] = useState<number | null>(null)

  // A different model is a different ledger; the old clock has nothing to add.
  useEffect(() => {
    setTick(null)
  }, [model])

  useEffect(() => {
    if (!open && !refusing) return
    setTick(Date.now())
    const timer = setInterval(() => {
      const at = Date.now()
      setTick(at)
      // The refusal window closed on its own: stop waking the window up.
      if (!open && cooldownUntil !== null && at >= cooldownUntil) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [open, refusing, cooldownUntil])

  // The store clock keeps up while a turn runs and would otherwise pull this
  // one backwards, so the later of the two is the real time.
  const clock = tick === null ? now : Math.max(now, tick)

  if (!visible || !model || !snapshot) return null

  const total = snapshot.windows.reduce((sum, item) => sum + item.used, 0)
  if (!total && !lead) return null

  const cooling = cooldownUntil !== null && cooldownUntil > clock
  const exhausted = lead?.limit !== null && lead?.limit !== undefined && (lead?.used ?? 0) >= lead.limit

  const title = cooling
    ? t("limit.cooldown", { time: countdown(cooldownUntil! - clock) })
    : lead
      ? t("limit.summary", { used: lead.used, limit: lead.limit ?? "∞" })
      : t("limit.counted", { used: total })

  return (
    <div className="limits" ref={rootRef}>
      <button
        type="button"
        className={cx(
          "limit-bar",
          open && "open",
          cooling || exhausted ? "warn" : ratio !== null && ratio >= 0.8 ? "high" : null,
        )}
        onClick={() => setOpen((value) => !value)}
        title={title}
        aria-expanded={open}
      >
        <IconGauge size={13} />
        {lead && lead.limit ? (
          <span className="limit-count">
            {lead.used}
            <span className="limit-of">/{lead.limit}</span>
          </span>
        ) : (
          <span className="limit-count">{total}</span>
        )}
        <IconChevron size={12} className="flip" />
      </button>

      {open && snapshot ? (
        <div className="limit-panel">
          <div className="limit-model" title={model}>
            {model}
          </div>

          {cooling ? (
            <div className="limit-alert">
              {t("limit.cooldown", { time: countdown(cooldownUntil! - clock) })}
            </div>
          ) : null}

          {snapshot.windows.map((item) => (
            <LimitRow
              key={item.window}
              item={item}
              now={clock}
              editing={editing === item.window}
              onEdit={() => setEditing(editing === item.window ? null : item.window)}
              onSubmit={(value) => {
                onSetLimit(model, item.window, value)
                setEditing(null)
              }}
            />
          ))}

          <div className="limit-foot">
            <span className={cx("limit-source", snapshot.source === "user" && "user")}>
              {snapshot.source === "user"
                ? t("limit.sourceUser")
                : snapshot.source === "builtin"
                  ? t("limit.sourceBuiltin")
                  : t("limit.sourceNone")}
            </span>
            <button type="button" className="limit-clear" onClick={() => onReset(model)}>
              {t("limit.reset")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function LimitRow({
  item,
  now,
  editing,
  onEdit,
  onSubmit,
}: {
  item: RequestLimits["windows"][number]
  now: number
  editing: boolean
  onEdit(): void
  onSubmit(value: number | null): void
}) {
  const t = useT()
  const ratio = item.limit ? Math.min(item.used / item.limit, 1) : null
  // No limit means no bar: an empty track would read as "room left" for a
  // ceiling nobody stated.
  const state = !item.limit ? "none" : ratio! >= 1 ? "full" : ratio! >= 0.8 ? "high" : "ok"

  return (
    <div className={cx("limit-row", state)}>
      <div className="limit-line">
        <span className="limit-name">{t(WINDOW_LABEL[item.window])}</span>
        <span className="limit-nums">
          {item.used}
          <span className="limit-of">/{item.limit ?? "∞"}</span>
        </span>
        <button type="button" className="limit-edit" onClick={onEdit} title={t("limit.setTitle")}>
          <IconPencil size={11} />
        </button>
      </div>

      {item.limit ? (
        <div className="limit-track">
          <div className="limit-fill" style={{ width: `${Math.round(ratio! * 100)}%` }} />
        </div>
      ) : null}

      <div className="limit-reset">
        {item.resetAt ? t("limit.resetsIn", { time: countdown(item.resetAt - now) }) : t("limit.noRequests")}
      </div>

      {editing ? <LimitEditor value={item.limit} onSubmit={onSubmit} onCancel={onEdit} /> : null}
    </div>
  )
}

/** A single number box; empty saves as "forget the limit". */
function LimitEditor({
  value,
  onSubmit,
  onCancel,
}: {
  value: number | null
  onSubmit(value: number | null): void
  onCancel(): void
}) {
  const t = useT()
  const [text, setText] = useState(value === null ? "" : String(value))

  return (
    <form
      className="limit-editor"
      onSubmit={(event) => {
        event.preventDefault()
        const parsed = Number.parseInt(text.trim(), 10)
        onSubmit(Number.isFinite(parsed) && parsed > 0 ? parsed : null)
      }}
    >
      <input
        autoFocus
        type="number"
        min={1}
        inputMode="numeric"
        value={text}
        placeholder={t("limit.placeholder")}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation()
            onCancel()
          }
        }}
      />
      <button type="submit" className="limit-ok">
        {t("limit.save")}
      </button>
    </form>
  )
}