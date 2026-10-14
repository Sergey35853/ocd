import { cx } from "../lib/format"
import { useT } from "../i18n"
import { IconChevron } from "./Icon"

/**
 * "Back to the conversations" affordance for the non-chat views.
 *
 * Settings, Providers, Plugins and Capabilities are leaves: without an obvious
 * way out, the burger menu is the only escape, and people read a settings screen
 * as the new home of the app. The chevron is rotated because the icon set has
 * no left arrow of its own.
 */
export function ViewBack({ onClick }: { onClick: () => void }) {
  const t = useT()
  return (
    <button
      type="button"
      className={cx("iconbtn", "view-back")}
      title={t("nav.backToChat")}
      aria-label={t("nav.backToChat")}
      onClick={onClick}
    >
      <IconChevron size={16} className="flip" />
    </button>
  )
}