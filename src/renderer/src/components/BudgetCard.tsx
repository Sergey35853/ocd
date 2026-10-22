import { useCallback, useEffect, useState } from "react"
import type { SessionStats } from "@shared/types"
import { useStore } from "../lib/store"
import { cx } from "../lib/format"
import { getLanguage, useT } from "../i18n"

/**
 * Spend against a ceiling, for today and for the month.
 *
 * The statistics already count what the work cost; this is the same number
 * held next to a line the person drew themselves, so "am I still inside it" is
 * a glance and not a subtraction. A ceiling of zero is no ceiling, and the row
 * then shows the spend on its own rather than a bar that is always empty.
 *
 * The figures come from the server on a slow tick — they describe the last
 * turn as much as the next, so a minute of staleness costs nothing.
 */
export function BudgetCard() {
  const store = useStore()
  const t = useT()
  const locale = getLanguage()
  const daily = store.settings?.budgetDaily ?? 0
  const monthly = store.settings?.budgetMonthly ?? 0
  const [today, setToday] = useState<number | null>(null)
  const [month, setMonth] = useState<SessionStats | null>(null)

  const refresh = useCallback(async () => {
    try {
      const now = Date.now()
      const [dayStats, monthStats] = await Promise.all([
        window.ocd.api.sessionStats(startOfDay(), now),
        window.ocd.api.sessionStats(startOfMonth(), now),
      ])
      setToday(dayStats.cost)
      setMonth(monthStats)
    } catch {
      /* a server that cannot count simply leaves the figures blank */
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 60_000)
    return () => clearInterval(timer)
  }, [refresh])

  const num = (value: number) => (Number.isFinite(value) ? value.toLocaleString(locale) : "0")
  const topModels = [...(month?.models ?? [])].sort((a, b) => b.cost - a.cost).slice(0, 3)
  const anyBudget = daily > 0 || monthly > 0

  return (
    <div className="card">
      <div className="card-head">
        {t("budget.title")}
        <div className="spacer" />
      </div>
      <div className="card-body" style={{ display: "grid", gap: 12 }}>
        <p className="about-hint">{t("budget.hint")}</p>
        <div className="budget-list">
          <BudgetRow label={t("budget.day")} spent={today ?? 0} budget={daily} num={num} />
          <BudgetRow label={t("budget.month")} spent={month?.cost ?? 0} budget={monthly} num={num} />
        </div>
        {!anyBudget ? <p className="about-hint">{t("budget.noBudget")}</p> : null}
        {topModels.length ? (
          <div className="budget-block">
            <div className="stats-section">{t("budget.topModels")}</div>
            {topModels.map((model) => (
              <div className="budget-model" key={`${model.model.providerID ?? ""}/${model.model.id}`}>
                <span className="grow" title={model.model.id}>
                  {model.model.id}
                </span>
                <span className="budget-num">${model.cost.toFixed(2)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** One period's spend next to its ceiling, as a bar when there is one. */
function BudgetRow({
  label,
  spent,
  budget,
  num,
}: {
  label: string
  spent: number
  budget: number
  num(value: number): string
}) {
  const over = budget > 0 && spent >= budget
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0
  return (
    <div className="budget-row">
      <div className="budget-head">
        <span className="budget-label">{label}</span>
        <span className={cx("budget-num", over && "over")}>
          ${num(spent)}
          {budget > 0 ? ` / $${num(budget)}` : ""}
        </span>
      </div>
      {budget > 0 ? (
        <div className="budget-track">
          <div className={cx("budget-fill", over && "over")} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  )
}

/** Local midnight, as epoch ms. */
function startOfDay(): number {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** The first of this month, as epoch ms. */
function startOfMonth(): number {
  const date = new Date()
  date.setDate(1)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}
