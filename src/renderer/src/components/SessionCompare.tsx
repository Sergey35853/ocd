import { useCallback, useMemo, useState } from "react"
import type { MessageInfo, SessionInfo } from "@shared/types"
import { diffLines } from "../lib/diff"
import { textOf } from "../lib/format"
import { useT } from "../i18n"
import { DiffView } from "./DiffView"
import { Modal } from "./ui"

/**
 * Two conversations, side by side.
 *
 * The same task done twice — twice by the model, twice by a colleague, twice
 * after a fork — leaves two transcripts that differ in a few places, and the
 * places they differ in are the answer to "what changed between them".
 *
 * The comparison is a line diff of the two transcripts: the same machinery
 * that shows what a patch changed, pointed at two conversations instead of one
 * file. A message that is in both is not interesting; a message that is in
 * only one of them is.
 */
export function SessionCompare({
  sessions,
  onClose,
}: {
  /** The conversations there are to choose from. */
  sessions: SessionInfo[]
  onClose(): void
}) {
  const t = useT()
  const [left, setLeft] = useState("")
  const [right, setRight] = useState("")
  const [texts, setTexts] = useState<{ left: string; right: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * The transcript as text, one message per line.
   *
   * A line is a message: the role and the words. The diff works on lines, and
   * a conversation read as lines is two conversations that can be compared.
   */
  const toText = useCallback((messages: MessageInfo[]) => {
    const lines: string[] = []
    for (const message of messages) {
      const body = textOf(message.content ?? []).trim()
      if (!body) continue
      const role = message.type === "user" ? t("cmp.roleUser") : t("cmp.roleModel")
      for (const line of body.split("\n")) lines.push(`${role}: ${line}`)
    }
    return lines.join("\n")
  }, [t])

  const compare = useCallback(async () => {
    if (!left || !right) return
    setBusy(true)
    setError(null)
    try {
      const [a, b] = await Promise.all([
        window.ocd.api.sessionMessages(left),
        window.ocd.api.sessionMessages(right),
      ])
      setTexts({ left: toText(a), right: toText(b) })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [left, right, toText])

  const lines = useMemo(() => {
    if (!texts) return []
    return diffLines(texts.left, texts.right)
  }, [texts])

  return (
    <Modal title={t("cmp.title")} onClose={onClose}>
      <div className="hstack" style={{ marginBottom: 8 }}>
        <select
          className="select grow"
          value={left}
          onChange={(event) => setLeft(event.target.value)}
        >
          <option value="">{t("cmp.pickFirst")}</option>
          {sessions.map((session) => (
            <option key={session.id} value={session.id}>
              {session.title || session.id}
            </option>
          ))}
        </select>
        <select
          className="select grow"
          value={right}
          onChange={(event) => setRight(event.target.value)}
        >
          <option value="">{t("cmp.pickSecond")}</option>
          {sessions.map((session) => (
            <option key={session.id} value={session.id}>
              {session.title || session.id}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn primary"
          disabled={busy || !left || !right}
          onClick={() => void compare()}
        >
          {busy ? t("cmp.working") : t("cmp.compare")}
        </button>
      </div>

      {error ? <div className="err-note">{error}</div> : null}

      {texts ? (
        <div className="cmp-result">
          <div className="diff-note">{t("cmp.hint")}</div>
          <DiffView lines={lines} limit={400} />
        </div>
      ) : (
        <div className="desc">{t("cmp.empty")}</div>
      )}
    </Modal>
  )
}
