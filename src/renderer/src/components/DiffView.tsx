import { useMemo, useState } from "react"
import { cx } from "../lib/format"
import { diffStats, type DiffLine } from "../lib/diff"
import { useT } from "../i18n"

/**
 * A diff, rendered the way one reads it: a line per row, old and new numbers
 * in their own columns, additions green and removals red.
 *
 * The line numbers come from CSS counters rather than from markup, for the same
 * reason the code blocks do it that way: a whole-file write is thousands of
 * rows, and one span per row is thousands of nodes for two numbers.
 */
export function DiffView({
  lines,
  /** Rows shown before the rest is folded away; 0 shows everything. */
  limit = 260,
  onCopyPatch,
}: {
  lines: DiffLine[]
  limit?: number
  /** Offered as a header button when given. */
  onCopyPatch?: () => void
}) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const stats = useMemo(() => diffStats(lines), [lines])
  const shown = expanded || limit <= 0 ? lines : lines.slice(0, limit)
  const hidden = lines.length - shown.length

  // An edit that replaced text with itself leaves context rows and nothing else.
  // Rendering them would fill the block with the code the user already has,
  // under a header that reports +0 −0.
  if (stats.added === 0 && stats.removed === 0) {
    return <div className="diff diff-empty">{t("diff.noChange")}</div>
  }

  return (
    <div className="diff">
      <div className="diff-head">
        <span className="diff-stat add">+{stats.added}</span>
        <span className="diff-stat del">−{stats.removed}</span>
        <span className="spacer" />
        {onCopyPatch ? (
          <button type="button" className="code-act" onClick={onCopyPatch}>
            {t("diff.copyPatch")}
          </button>
        ) : null}
      </div>
      <div className="diff-body" tabIndex={0}>
        {shown.map((line, index) => (
          <div key={`${index}-${line.kind}`} className={cx("diff-line", line.kind)}>
            <span className="diff-text">{line.text || " "}</span>
          </div>
        ))}
        {hidden > 0 ? (
          <button type="button" className="diff-more" onClick={() => setExpanded(true)}>
            {t("diff.more", { n: hidden })}
          </button>
        ) : null}
      </div>
    </div>
  )
}