import { useState } from "react"
import type { AutoRun } from "@shared/types"
import { cx } from "../lib/format"
import { useT, type DictKey } from "../i18n"
import { IconTrash } from "./Icon"
import { Field, Switch } from "./ui"

/**
 * The conversations that start by themselves.
 *
 * The same task every morning: the app opens the conversation and sends the
 * prompt, so the work is already waiting when the user sits down. The rules
 * are the user's own, so they live in the settings and are edited here.
 *
 * No weekdays named means every day: an empty list is not "never", it is
 * "every day", because a rule that never runs is a rule nobody set.
 */
export function AutoRuns({
  runs,
  onChange,
}: {
  runs: AutoRun[]
  onChange(runs: AutoRun[]): void
}) {
  const t = useT()
  const [prompt, setPrompt] = useState("")
  const [time, setTime] = useState("09:00")
  const [days, setDays] = useState<number[]>([])

  const add = () => {
    const text = prompt.trim()
    if (!text) return
    onChange([
      ...runs,
      {
        id: `auto-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        prompt: text,
        agent: "",
        time,
        days,
        enabled: true,
      },
    ])
    setPrompt("")
  }

  const update = (id: string, patch: Partial<AutoRun>) => {
    onChange(runs.map((run) => (run.id === id ? { ...run, ...patch } : run)))
  }

  const remove = (id: string) => onChange(runs.filter((run) => run.id !== id))

  const toggleDay = (day: number) => {
    setDays((current) =>
      current.includes(day) ? current.filter((item) => item !== day) : [...current, day],
    )
  }

  return (
    <Field label={t("auto.title")} hint={t("auto.hint")}>
      {runs.length === 0 ? (
        <div className="desc">{t("auto.empty")}</div>
      ) : (
        <div className="rules-list">
          {runs.map((run) => (
            <div key={run.id} className="row" style={{ gap: 6 }}>
              <span className="grow">
                <span className="mono">{run.time}</span> — {run.prompt}
              </span>
              <Switch on={run.enabled} onChange={(on) => update(run.id, { enabled: on })} />
              <button
                type="button"
                className="iconbtn tiny"
                title={t("tpl.remove")}
                onClick={() => remove(run.id)}
              >
                <IconTrash size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="auto-add">
        <input
          className="input grow"
          placeholder={t("auto.prompt")}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") add()
          }}
        />
        <input
          className="input time"
          type="time"
          value={time}
          onChange={(event) => setTime(event.target.value)}
        />
        <button type="button" className="btn" onClick={add}>
          {t("auto.add")}
        </button>
      </div>

      <div className="auto-days">
        {days.length === 0 ? <span className="desc">{t("auto.everyDay")}</span> : null}
        {([0, 1, 2, 3, 4, 5, 6] as const).map((day) => (
          <button
            key={day}
            type="button"
            className={cx("chipbtn", days.includes(day) && "on")}
            onClick={() => toggleDay(day)}
          >
            {t(`auto.day${day}` as DictKey)}
          </button>
        ))}
      </div>
    </Field>
  )
}
