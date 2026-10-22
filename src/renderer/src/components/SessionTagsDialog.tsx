import { useState } from "react"
import { addTag, removeTag, useAllTags, useSessionTags } from "../lib/tags"
import { useT } from "../i18n"
import { IconClose } from "./Icon"
import { Field, Modal } from "./ui"

/**
 * The labels of one conversation.
 *
 * Tags are local to OCD and invisible to the server, so the edit is instant:
 * there is nothing to save and no round-trip to wait for. The dialog only puts
 * a name on a conversation and takes it off again, and offers the tags that
 * already exist elsewhere as one-tap suggestions so the same word is spelled
 * the same way twice.
 */
export function SessionTagsDialog({
  sessionId,
  onClose,
}: {
  sessionId: string
  onClose(): void
}) {
  const t = useT()
  const tags = useSessionTags(sessionId)
  const known = useAllTags()
  const [draft, setDraft] = useState("")

  const commit = () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    addTag(sessionId, trimmed)
    setDraft("")
  }

  const suggestions = known.filter((tag) => !tags.includes(tag))

  return (
    <Modal
      title={t("session.tags")}
      onClose={onClose}
      actions={
        <button type="button" className="btn primary" onClick={onClose}>
          {t("common.done")}
        </button>
      }
    >
      <div style={{ color: "var(--text-faint)", fontSize: 12, marginBottom: 10 }}>
        {t("session.tagsHint")}
      </div>

      {tags.length === 0 ? (
        <p style={{ color: "var(--text-faint)" }}>{t("session.tagsEmpty")}</p>
      ) : (
        <div className="tag-row">
          {tags.map((tag) => (
            <span key={tag} className="tag-chip">
              {tag}
              <button
                type="button"
                className="tag-x"
                title={t("session.tagsRemove", { tag })}
                onClick={() => removeTag(sessionId, tag)}
              >
                <IconClose size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      <Field label={t("session.tagsNew")}>
        <input
          className="input"
          value={draft}
          placeholder={t("session.tagsPlaceholder")}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit()
          }}
        />
      </Field>
      <div className="hstack" style={{ justifyContent: "flex-end", marginTop: 10 }}>
        <button type="button" className="btn" onClick={commit} disabled={!draft.trim()}>
          {t("session.tagsAdd")}
        </button>
      </div>

      {suggestions.length ? (
        <>
          <div className="sub" style={{ marginTop: 16, marginBottom: 6 }}>
            {t("session.tagsSuggestions")}
          </div>
          <div className="tag-row">
            {suggestions.map((tag) => (
              <button
                key={tag}
                type="button"
                className="tag-chip pick"
                onClick={() => {
                  addTag(sessionId, tag)
                }}
              >
                + {tag}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </Modal>
  )
}
