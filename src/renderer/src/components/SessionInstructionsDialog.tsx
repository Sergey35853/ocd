import { useCallback, useEffect, useRef, useState } from "react"
import type { InstructionEntry } from "@shared/types"
import { useStore } from "../lib/store"
import { useT } from "../i18n"
import { truncate } from "../lib/format"
import { IconTrash } from "./Icon"
import { Field, Modal } from "./ui"

/**
 * The instructions one conversation carries.
 *
 * Unlike the environment, these can be read back: the server answers with the
 * list, so the dialog shows the server's own state and writes one entry at a
 * time — there is no whole set to replace, and nothing to keep a copy of.
 */

/** The value is whatever the server keeps: a note, an object, a number. */
function valueText(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return truncate(JSON.stringify(value) ?? String(value), 200)
  } catch {
    return truncate(String(value), 200)
  }
}

export function SessionInstructionsDialog({
  sessionId,
  onClose,
}: {
  sessionId: string
  onClose(): void
}) {
  const store = useStore()
  const t = useT()
  const [entries, setEntries] = useState<InstructionEntry[]>([])
  const [key, setKey] = useState("")
  const [text, setText] = useState("")

  /**
   * The store, in a ref.
   *
   * The store is a new object on every tick of a running turn, so an effect
   * that depends on it asks the server for the instructions again, once a
   * second, for as long as the model writes.
   */
  const storeRef = useRef(store)
  storeRef.current = store

  const load = useCallback(() => {
    void window.ocd.api
      .sessionInstructions(sessionId)
      .then(setEntries)
      .catch((err: unknown) =>
        storeRef.current.toast(err instanceof Error ? err.message : String(err), "error"),
      )
  }, [sessionId])

  useEffect(load, [load])

  const put = async () => {
    const trimmed = key.trim()
    if (!trimmed) return
    try {
      await window.ocd.api.sessionInstructionPut(sessionId, trimmed, text)
      storeRef.current.toast(t("session.instructionsSaved"))
      setKey("")
      setText("")
      load()
    } catch (err) {
      storeRef.current.toast(err instanceof Error ? err.message : String(err), "error")
    }
  }

  const remove = async (name: string) => {
    try {
      await window.ocd.api.sessionInstructionRemove(sessionId, name)
      storeRef.current.toast(t("session.instructionsRemoved"))
      load()
    } catch (err) {
      storeRef.current.toast(err instanceof Error ? err.message : String(err), "error")
    }
  }

  return (
    <Modal title={t("session.instructions")} onClose={onClose}>
      <div style={{ color: "var(--text-faint)", fontSize: 12, marginBottom: 10 }}>
        {t("session.instructionsHint")}
      </div>

      {entries.length === 0 ? (
        <p style={{ color: "var(--text-faint)" }}>{t("session.instructionsEmpty")}</p>
      ) : (
        <ul className="rule-list">
          {entries.map((entry) => {
            const text = valueText(entry.value)
            return (
              <li key={entry.key}>
                <div className="rule-main">
                  <span className="rule-action" style={{ fontFamily: "var(--mono)" }}>
                    {entry.key}
                  </span>
                  <span className="rule-resource" title={text}>
                    {text}
                  </span>
                </div>
                <button
                  type="button"
                  className="iconbtn"
                  title={t("chat.removeAttachment")}
                  onClick={() => void remove(entry.key)}
                >
                  <IconTrash size={14} />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <Field label={t("session.instructionsKey")}>
        <input
          className="input"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void put()
          }}
        />
      </Field>
      <Field label={t("session.instructionsValue")}>
        <textarea
          className="input"
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </Field>
      <div className="hstack" style={{ justifyContent: "flex-end", marginTop: 10 }}>
        {/* An instruction without a key is nowhere to put, so the button waits
            for one instead of asking about it. */}
        <button
          type="button"
          className="btn"
          disabled={!key.trim()}
          onClick={() => void put()}
        >
          {t("common.add")}
        </button>
      </div>
    </Modal>
  )
}
