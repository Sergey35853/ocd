import { useT } from "../i18n"
import { clock, remainingEstimate } from "../lib/timing"

/**
 * How long the running turn has taken, and how much longer it is expected to.
 *
 * Two numbers, and the second is only shown when it can be defended: the
 * estimate comes from the durations of this conversation's own past turns, so
 * with nothing to learn from it stays hidden instead of inventing a figure.
 * Once a turn outruns its own estimate the countdown drops away and the elapsed
 * clock keeps counting — a timer stuck at zero is worse than no timer.
 */
export function TurnTimer({
  startedAt,
  samples,
  now,
  compact = false,
}: {
  startedAt: number
  /** Durations of past turns in this conversation, in ms. */
  samples: number[]
  now: number
  /** Tab style: elapsed only, no label. */
  compact?: boolean
}) {
  const t = useT()
  const elapsed = Math.max(0, now - startedAt)
  const remaining = remainingEstimate(samples, elapsed)

  if (compact) {
    return (
      <span className="tmt tmt-tab" title={t("time.elapsedTitle", { time: clock(elapsed) })}>
        {clock(elapsed)}
      </span>
    )
  }

  return (
    <span
      className="tmt"
      role="status"
      title={
        remaining === null
          ? t("time.elapsedOnly", { time: clock(elapsed) })
          : remaining === 0
            ? t("time.over", { time: clock(elapsed) })
            : t("time.both", { elapsed: clock(elapsed), left: clock(remaining) })
      }
    >
      <span className="tmt-elapsed">{clock(elapsed)}</span>
      {remaining !== null && remaining > 0 ? (
        <>
          <span className="tmt-sep">·</span>
          <span className="tmt-left">{t("time.left", { time: clock(remaining) })}</span>
        </>
      ) : null}
    </span>
  )
}
