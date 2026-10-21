import { useState } from "react"
import { useStore } from "../lib/store"
import { useT } from "../i18n"
import { IconTrash } from "./Icon"
import { Field, Modal } from "./ui"

/**
 * The variables the agent's commands run with, for one conversation.
 *
 * The server has no route that hands these back: `sessionEnvironment` only
 * writes. Nothing on the screen could therefore be the server's own answer,
 * and a dialog that pretended otherwise would be lying about what it knows.
 * So the dialog keeps its own copy — in the window's storage, under the
 * session's id — and offers that copy for editing. What the user sees is what
 * OCD last sent, not a live view of the server.
 */

const ENV_KEY = "ocd.env."

interface Variable {
  name: string
  value: string
}

/** The copy the window kept of the last set it sent. */
function readVariables(sessionId: string): Variable[] {
  try {
    const raw = localStorage.getItem(ENV_KEY + sessionId)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      if (typeof item !== "object" || item === null) return []
      const { name, value } = item as { name?: unknown; value?: unknown }
      if (typeof name !== "string" || typeof value !== "string") return []
      return [{ name, value }]
    })
  } catch {
    return []
  }
}

function writeVariables(sessionId: string, variables: Variable[]): void {
  try {
    localStorage.setItem(ENV_KEY + sessionId, JSON.stringify(variables))
  } catch {
    /* storage unavailable: the set simply does not survive the restart */
  }
}

/**
 * The environment of one conversation.
 *
 * The list is edited here and sent in one piece: the server replaces the
 * whole set, so a variable that is missing from the payload is a variable the
 * conversation no longer has.
 */
export function SessionEnvironmentDialog({
  sessionId,
  onClose,
}: {
  sessionId: string
  onClose(): void
}) {
  const store = useStore()
  const t = useT()
  const [variables, setVariables] = useState<Variable[]>(() => readVariables(sessionId))
  const [name, setName] = useState("")
  const [value, setValue] = useState("")
  const [saving, setSaving] = useState(false)

  const add = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      store.toast(t("session.envNameRequired"), "error")
      return
    }
    setVariables((current) => {
      const existing = current.findIndex((item) => item.name === trimmed)
      // The same name twice is one variable with two values, and keeping both
      // would drop one of them without a word when the set is sent.
      if (existing < 0) return [...current, { name: trimmed, value }]
      return current.map((item, index) => (index === existing ? { name: trimmed, value } : item))
    })
    setName("")
    setValue("")
  }

  const remove = (index: number) => {
    setVariables((current) => current.filter((_, at) => at !== index))
  }

  const save = async () => {
    setSaving(true)
    try {
      const payload: Record<string, string> = {}
      for (const variable of variables) payload[variable.name] = variable.value
      await window.ocd.api.sessionEnvironment(sessionId, payload)
      // The copy is written after the server took the set: a copy of a set
      // the server refused would be a lie the next time this opens.
      writeVariables(sessionId, variables)
      store.toast(t("session.envSaved"))
      onClose()
    } catch (err) {
      store.toast(err instanceof Error ? err.message : String(err), "error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={t("session.env")}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={saving}
            onClick={() => void save()}
          >
            {t("common.save")}
          </button>
        </>
      }
    >
      <div style={{ color: "var(--text-faint)", fontSize: 12, marginBottom: 10 }}>
        {t("session.envHint")}
      </div>

      {variables.length === 0 ? (
        <p style={{ color: "var(--text-faint)" }}>{t("session.envEmpty")}</p>
      ) : (
        <ul className="rule-list">
          {variables.map((variable, index) => (
            <li key={`${variable.name}:${index}`}>
              <div className="rule-main">
                <span className="rule-action" style={{ fontFamily: "var(--mono)" }}>
                  {variable.name}
                </span>
                <span
                  className="rule-resource"
                  title={variable.value}
                  style={{ fontFamily: "var(--mono)" }}
                >
                  {variable.value}
                </span>
              </div>
              <button
                type="button"
                className="iconbtn"
                title={t("chat.removeAttachment")}
                onClick={() => remove(index)}
              >
                <IconTrash size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Field label={t("session.envName")}>
        <input
          className="input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") add()
          }}
        />
      </Field>
      <Field label={t("session.envValue")}>
        <input
          className="input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") add()
          }}
        />
      </Field>
      <div className="hstack" style={{ justifyContent: "flex-end", marginTop: 10 }}>
        <button type="button" className="btn" onClick={add}>
          {t("session.envAdd")}
        </button>
      </div>
    </Modal>
  )
}
