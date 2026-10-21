import { useState } from "react"
import type { FileDiffInfo } from "@shared/types"
import { useT } from "../i18n"
import { Modal } from "./ui"

/**
 * What a rewind would cost, before it happens.
 *
 * The server stages the rewind and answers with the files it would put back.
 * A blind "undo" can restore a file to the state it had an hour ago, and the
 * person who asked for the undo cannot see that. Here they can: the files are
 * listed, and the rewind is applied only when they say so.
 */
export function RevertPreview({
  files,
  onApply,
  onDiscard,
  onClose,
}: {
  files: FileDiffInfo[]
  onApply(): void
  onDiscard(): void
  onClose(): void
}) {
  const t = useT()
  const [busy, setBusy] = useState(false)

  return (
    <Modal
      title={t("revert.title")}
      onClose={onClose}
      actions={
        <>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              onDiscard()
            }}
          >
            {t("revert.discard")}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              onApply()
            }}
          >
            {t("revert.apply")}
          </button>
        </>
      }
    >
      <p className="desc" style={{ marginTop: 0 }}>
        {t("revert.hint")}
      </p>
      {files.length === 0 ? (
        <p style={{ color: "var(--text-faint)" }}>{t("revert.noFiles")}</p>
      ) : (
        <ul className="rule-list">
          {files.map((file) => (
            <li key={file.file}>
              <div className="rule-main">
                <span className="rule-action mono">{file.file}</span>
                <span className="mono rule-resource">
                  +{file.additions ?? 0} −{file.deletions ?? 0}
                </span>
              </div>
              <span className="badge">{file.status ?? "modified"}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
