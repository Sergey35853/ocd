import { useState } from "react"
import type { NotifyRule } from "@shared/types"
import { useT } from "../i18n"
import { IconTrash } from "./Icon"
import { Field, Switch } from "./ui"

/**
 * The rules that make the app speak up on its own.
 *
 * The general notification is all or nothing, and a rule is for the cases in
 * between: the answer mentions a word, the turn cost too much, the turn
 * failed. The rules are the user's own, so they live in the settings and are
 * edited here — a rule nobody can reach is a rule nobody set.
 */
export function NotifyRules({
  rules,
  onChange,
}: {
  rules: NotifyRule[]
  onChange(rules: NotifyRule[]): void
}) {
  const t = useT()
  const [kind, setKind] = useState<NotifyRule["kind"]>("keyword")
  const [value, setValue] = useState("")

  const add = () => {
    const text = value.trim()
    // The cost rule needs a number and the keyword rule needs a word; the
    // error rule needs nothing at all.
    if (kind !== "error" && !text) return
    if (kind === "cost" && !Number.isFinite(Number(text))) return
    onChange([
      ...rules,
      { id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, kind, value: text, enabled: true },
    ])
    setValue("")
  }

  const update = (id: string, patch: Partial<NotifyRule>) => {
    onChange(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)))
  }

  const remove = (id: string) => onChange(rules.filter((rule) => rule.id !== id))

  return (
    <Field label={t("set.notifyRules")} hint={t("set.notifyRulesHint")}>
      <div className="rules-list">
        {rules.length === 0 ? (
          <div className="desc">{t("set.ruleEmpty")}</div>
        ) : (
          rules.map((rule) => (
            <div key={rule.id} className="row" style={{ gap: 6 }}>
              <span className="grow">
                {labelOf(rule.kind, t)}
                {rule.value ? ` — ${rule.value}` : ""}
              </span>
              <Switch
                on={rule.enabled}
                onChange={(on) => update(rule.id, { enabled: on })}
              />
              <button
                type="button"
                className="iconbtn tiny"
                title={t("tpl.remove")}
                onClick={() => remove(rule.id)}
              >
                <IconTrash size={12} />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="hstack" style={{ marginTop: 6 }}>
        <select
          className="select"
          value={kind}
          onChange={(event) => setKind(event.target.value as NotifyRule["kind"])}
        >
          <option value="keyword">{t("set.ruleKeyword")}</option>
          <option value="cost">{t("set.ruleCost")}</option>
          <option value="error">{t("set.ruleError")}</option>
        </select>
        {kind !== "error" ? (
          <input
            className="input grow"
            inputMode={kind === "cost" ? "decimal" : "text"}
            placeholder={kind === "cost" ? t("set.ruleAmount") : t("set.ruleWord")}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") add()
            }}
          />
        ) : null}
        <button type="button" className="btn" onClick={add}>
          {t("common.add")}
        </button>
      </div>
    </Field>
  )
}

/** What the rule watches for, in words. */
function labelOf(
  kind: NotifyRule["kind"],
  t: (key: never) => string,
): string {
  if (kind === "cost") return t("set.ruleCost" as never)
  if (kind === "error") return t("set.ruleError" as never)
  return t("set.ruleKeyword" as never)
}
