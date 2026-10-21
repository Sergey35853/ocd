import { useEffect, useRef, useState } from "react"
import type { PermissionRule } from "@shared/types"
import { useStore } from "../lib/store"
import { useT } from "../i18n"
import { Modal } from "./ui"

/**
 * The permission answers the server remembers.
 *
 * Choosing "always" in the permission dialog leaves a trace on the server, and
 * until now nothing in the app could show it: the answer was given once and
 * then was invisible. A rule that cannot be seen cannot be taken back either,
 * so this lists them and lets each one be forgotten.
 */
export function PermissionRules({
  projectID,
  onClose,
}: {
  projectID?: string
  onClose: () => void
}) {
  const store = useStore()
  const t = useT()
  const [rules, setRules] = useState<PermissionRule[]>([])

  /**
   * The store, in a ref.
   *
   * The store is a new object on every tick of a running turn, so an effect
   * that depends on it asks the server for the rules again, once a second,
   * for as long as the model writes.
   */
  const storeRef = useRef(store)
  storeRef.current = store

  const load = () => {
    void storeRef.current.permissionRules(projectID).then(setRules)
  }

  useEffect(load, [projectID])

  return (
    <Modal title={t("perm.rulesTitle")} onClose={onClose}>
      {rules.length === 0 ? (
        <p style={{ color: "var(--text-faint)" }}>{t("perm.rulesEmpty")}</p>
      ) : (
        <ul className="rule-list">
          {rules.map((rule) => (
            <li key={rule.id}>
              <div className="rule-main">
                <span className="rule-action">{rule.action}</span>
                <span className="mono rule-resource">{rule.resource}</span>
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void store.deletePermissionRule(rule.id).then(load)
                }}
              >
                {t("perm.rulesForget")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
