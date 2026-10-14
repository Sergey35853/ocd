import type { PermissionDecision } from "@shared/types"
import { useStore } from "../lib/store"
import { useT } from "../i18n"
import { IconAlert, IconClose } from "./Icon"

/**
 * Ask the user to confirm a tool call.
 *
 * Without this the server simply waits: it has asked its question, the answer
 * has nowhere to go, and the chat shows a spinner that never resolves. So this
 * is not a nicety — it is the only thing standing between "the model asked to
 * touch a file outside the project" and a turn that hangs for good.
 *
 * Rendered one at a time even if several arrive, because approving several
 * actions at once is exactly the reflex these dialogs exist to prevent.
 */
export function PermissionPrompt() {
  const store = useStore()
  const t = useT()
  const request = store.pendingPermissions[0]

  if (!request) return null

  const answer = (decision: PermissionDecision) =>
    void store.answerPermission(request, decision)

  const resources = (request.resources ?? []).filter(Boolean)

  return (
    <div className="perm-back" onPointerDown={() => answer("reject")}>
      <div
        className="perm"
        role="dialog"
        aria-modal="true"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="perm-head">
          <IconAlert size={15} />
          <span>{t("perm.title")}</span>
          {store.pendingPermissions.length > 1 ? (
            <span className="perm-more">+{store.pendingPermissions.length - 1}</span>
          ) : null}
          <button
            type="button"
            className="iconbtn"
            title={t("perm.reject")}
            aria-label={t("perm.reject")}
            onClick={() => answer("reject")}
          >
            <IconClose size={14} />
          </button>
        </header>

        <div className="perm-body">
          <p className="perm-lead">{t("perm.lead")}</p>

          <div className="perm-row">
            <span className="perm-key">{t("perm.action")}</span>
            <span className="perm-val mono">{request.action ?? t("perm.unknownAction")}</span>
          </div>
          {request.agent ? (
            <div className="perm-row">
              <span className="perm-key">{t("perm.agent")}</span>
              <span className="perm-val mono">{request.agent}</span>
            </div>
          ) : null}

          {resources.length ? (
            <div className="perm-row">
              <span className="perm-key">{t("perm.resources")}</span>
              <ul className="perm-resources">
                {resources.slice(0, 6).map((item) => (
                  <li key={item} className="mono">
                    {item}
                  </li>
                ))}
                {resources.length > 6 ? (
                  <li className="perm-more-list">+{resources.length - 6}</li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </div>

        <footer className="perm-actions">
          <button type="button" className="btn" onClick={() => answer("reject")}>
            {t("perm.reject")}
          </button>
          <button type="button" className="btn" onClick={() => answer("always")}>
            {t("perm.always")}
          </button>
          <button
            type="button"
            className="btn primary"
            autoFocus
            onClick={() => answer("once")}
          >
            {t("perm.once")}
          </button>
        </footer>
      </div>
    </div>
  )
}
