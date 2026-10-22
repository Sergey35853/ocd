import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { FeedbackKind, SessionStats } from "@shared/types"
import { useStore } from "../lib/store"
import { cx } from "../lib/format"
import { Switch } from "../components/ui"
import { BudgetCard } from "../components/BudgetCard"
import { IconCheck, IconDownload, IconLink, IconRefresh, IconSend, IconAlert } from "../components/Icon"
import { ViewBack } from "../components/ViewBack"
import { getLanguage, useT } from "../i18n"

/** Where a person goes when the app has nowhere to send a note. */
const AUTHOR_URL = "https://github.com/Sergey35853"

/** The same door by a second road, for the people who do not use GitHub. */
const AUTHOR_TELEGRAM = "https://t.me/Link_Ser"

/** Matches the caps in main/feedback.ts, so a pasted wall of text is cut, not refused. */
const MAX_MESSAGE = 4000
const MAX_CONTACT = 200

/**
 * The periods the statistics can be counted over.
 *
 * The length of each one is what the server is asked about, and it is the
 * server that counts: this list only says how far back the window reaches.
 * "All time" asks for no window at all, because the server counts everything
 * when no period is named.
 */
const STAT_PERIODS = [
  { id: "day", label: "stats.day", ms: 24 * 60 * 60_000 },
  { id: "week", label: "stats.week", ms: 7 * 24 * 60 * 60_000 },
  { id: "month", label: "stats.month", ms: 30 * 24 * 60 * 60_000 },
  { id: "all", label: "stats.all", ms: 0 },
] as const

type StatPeriod = (typeof STAT_PERIODS)[number]["id"]

/**
 * What this build is, and how to make it a newer one.
 *
 * A separate view rather than the last card of the settings: everything on this
 * screen answers "what am I running and what does it do", the settings screen
 * answers "how do I want it to behave". The update check came here for the same
 * reason - it is a fact about the build, not a preference.
 */
export function AboutView({ onBack }: { onBack: () => void }) {
  const store = useStore()
  // The toast is a stable function of the store; taking it out here says so,
  // and lets an effect depend on it without depending on the whole store.
  const { toast } = store
  const t = useT()
  const [versions, setVersions] = useState<{ app?: string; electron?: string; node?: string; chrome?: string }>({})
  const [configPath, setConfigPath] = useState("")
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  /** What the last check said, kept on the card rather than in a toast. */
  const [updateCheck, setUpdateCheck] = useState<{ ok: boolean; message: string } | null>(null)
  /** null until main answers: a build without a backend has to say so itself. */
  const [canSend, setCanSend] = useState<boolean | null>(null)
  const [kind, setKind] = useState<FeedbackKind>("wish")
  const [message, setMessage] = useState("")
  const [contact, setContact] = useState("")
  const [tech, setTech] = useState(true)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    // The toast is a stable function of the store, so this effect runs once:
    // depending on the store itself would ask for the version again on every
    // tick of the conversation.
    const fail = (err: unknown) =>
      toast(err instanceof Error ? err.message : String(err), "error")
    void window.ocd.app.version().then(setVersions).catch(fail)
    void window.ocd.configFile.path().then(setConfigPath).catch(fail)
    void window.ocd.feedback.configured().then(setCanSend).catch(() => setCanSend(false))
  }, [toast])

  /**
   * Check, and say what came back here rather than in a toast.
   *
   * Nothing is toasted: the answer is on the card, and a toast says the same
   * thing a second time in a place that disappears.
   */
  const check = useCallback(async () => {
    setBusy(true)
    try {
      setUpdateCheck(await window.ocd.app.checkForUpdates())
    } catch (err) {
      setUpdateCheck({ ok: false, message: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }, [])

  /**
   * Check once, when the screen is opened.
   *
   * Not keyed on the store: adding a toast changes the store, which would
   * re-create this callback, which would run this effect again, which would add
   * another toast - the screen checked four times for one visit and filled the
   * corner with the same sentence.
   */
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current) return
    opened.current = true
    void check()
  }, [check])

  const download = async () => {
    setBusy(true)
    try {
      const result = await window.ocd.app.downloadUpdate()
      store.toast(result.message, result.ok ? "info" : "error")
      setReady(result.ok)
    } catch (err) {
      store.toast(err instanceof Error ? err.message : String(err), "error")
    } finally {
      setBusy(false)
    }
  }

  const install = async () => {
    const result = await window.ocd.app.installUpdate()
    store.toast(result.message, result.ok ? "info" : "error")
  }

  /**
   * Send what was typed, then clear it.
   *
   * The fields are emptied only after the send is answered, so a network that
   * said no leaves the text where it was: losing a paragraph to a toast that
   * said "не отправлено" would be the worst possible answer to "что-то не так".
   */
  const sendFeedback = async () => {
    if (!message.trim()) {
      store.toast(t("about.feedbackEmpty"), "error")
      return
    }
    setSending(true)
    try {
      await window.ocd.feedback.send({ kind, message, contact, tech })
      setSent(true)
      setMessage("")
      setContact("")
    } catch (err) {
      store.toast(err instanceof Error ? err.message : String(err), "error")
    } finally {
      setSending(false)
    }
  }

  const rows: Array<[string, string]> = [
    [t("about.electron"), versions.electron ?? "—"],
    [t("about.chromium"), versions.chrome ?? "—"],
    [t("about.node"), versions.node ?? "—"],
    [t("about.server"), store.status?.version ?? "—"],
    [t("about.serverUrl"), store.status?.url ?? "—"],
    [t("about.registration"), store.status?.registrationFile ?? "—"],
    [t("about.config"), configPath || "—"],
  ]

  return (
    <div className="view">
      <header className="view-head">
        <ViewBack onClick={onBack} />
        <h1>{t("nav.about")}</h1>
      </header>

      <div className="card">
        <div className="card-head">{t("about.build")}</div>
        <div className="card-body" style={{ display: "grid", gap: 10 }}>
          <div className="about-name">
            <span className="about-title">OCD</span>
            <span className="badge accent">v{versions.app ?? "—"}</span>
            <span className="about-tagline">{t("about.tagline")}</span>
          </div>

          <dl className="about-rows">
            {rows.map(([label, value]) => (
              <div className="about-row" key={label}>
                <dt>{label}</dt>
                <dd className="mono" title={value}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="hstack">
            <button type="button" className="btn" onClick={() => void store.connect()}>
              <IconRefresh size={14} /> {t("set.reconnect")}
            </button>
          </div>
        </div>
      </div>

      {/*
        The count of the work itself.

        It sits next to the build rather than in the settings: what has been
        done with this build is a fact about it, the same kind of thing the
        card above is about, and a person looking for it comes to this screen
        rather than to a list of preferences.
      */}
      <BudgetCard />
      <StatsCard />

      <div className="card">
        <div className="card-head">{t("about.updates")}</div>
        <div className="card-body" style={{ display: "grid", gap: 10 }}>
          <div className="about-row">
            <span className="about-label">{t("set.autoUpdate")}</span>
            <Switch
              on={Boolean(store.settings?.autoUpdate)}
              onChange={(value) => {
                void window.ocd.app.setAutoUpdate(value)
                void store.updateSettings({ autoUpdate: value })
              }}
            />
          </div>
          <p className="about-hint">{t("set.autoUpdateHint")}</p>

          {updateCheck ? (
            <p className={updateCheck.ok ? "about-check ok" : "about-check err"}>
              {updateCheck.ok ? <IconCheck size={14} /> : <IconAlert size={14} />}
              {updateCheck.message}
            </p>
          ) : null}

          <div className="hstack">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void check()}>
              <IconRefresh size={14} /> {t("set.checkUpdate")}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void download()}>
              <IconDownload size={14} /> {t("set.downloadUpdate")}
            </button>
            {ready ? (
              <button type="button" className="btn" onClick={() => void install()}>
                <IconCheck size={14} /> {t("set.installUpdate")}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/*
        The way back to whoever ships this.

        The card is on the About screen rather than in Settings because a note
        about the app is not a preference, and because the screen already holds
        the two facts a report is asked for: the build and the paths.
      */}
      <div className="card">
        <div className="card-head">{t("about.feedback")}</div>
        <div className="card-body" style={{ display: "grid", gap: 10 }}>
          <p className="about-hint">{t("about.feedbackHint")}</p>

          <div className="about-row">
            <span className="about-label">{t("about.author")}</span>
            <div className="hstack">
              <button
                type="button"
                className="btn"
                onClick={() => void window.ocd.app.openExternal(AUTHOR_URL)}
              >
                <IconLink size={14} /> {t("about.authorGitHub")}
              </button>
              {/* Not translated: a brand reads the same in every language here,
                  and five identical strings are five places to keep in step. */}
              <button
                type="button"
                className="btn"
                onClick={() => void window.ocd.app.openExternal(AUTHOR_TELEGRAM)}
              >
                <IconLink size={14} /> Telegram
              </button>
            </div>
          </div>

          {canSend === null ? null : canSend ? (
            <>
              <div className="fb-form">
                <label className="fb-field">
                  <span>{t("about.kind")}</span>
                  <select
                    className="select"
                    value={kind}
                    onChange={(event) => {
                      setKind(event.target.value as FeedbackKind)
                      setSent(false)
                    }}
                  >
                    <option value="wish">{t("about.kind.wish")}</option>
                    <option value="complaint">{t("about.kind.complaint")}</option>
                    <option value="problem">{t("about.kind.problem")}</option>
                    <option value="other">{t("about.kind.other")}</option>
                  </select>
                </label>

                <label className="fb-field">
                  <span>{t("about.message")}</span>
                  <textarea
                    className="fb-text"
                    rows={4}
                    maxLength={MAX_MESSAGE}
                    value={message}
                    placeholder={t("about.messagePlaceholder")}
                    onChange={(event) => {
                      setMessage(event.target.value)
                      setSent(false)
                    }}
                  />
                </label>

                <label className="fb-field">
                  <span>{t("about.contact")}</span>
                  <input
                    className="input"
                    maxLength={MAX_CONTACT}
                    value={contact}
                    placeholder={t("about.contactPlaceholder")}
                    onChange={(event) => setContact(event.target.value)}
                  />
                </label>

                {/*
                  The log holds paths and window titles, so it goes only when
                  this is ticked — and the label names what is attached, because
                  a box that says "больше данных" and a box that sends a log are
                  not the same promise.
                */}
                <label className="fb-check">
                  <input
                    type="checkbox"
                    checked={tech}
                    onChange={(event) => setTech(event.target.checked)}
                  />
                  <span>{t("about.attachTech", { version: versions.app ?? "—" })}</span>
                </label>
              </div>

              {sent ? (
                <p className="about-check ok">
                  <IconCheck size={14} /> {t("about.feedbackSent")}
                </p>
              ) : null}

              <div className="hstack">
                <button
                  type="button"
                  className="btn primary"
                  disabled={sending}
                  onClick={() => void sendFeedback()}
                >
                  <IconSend size={14} /> {t("about.send")}
                </button>
              </div>
            </>
          ) : (
            // Neutral rather than an error: nothing failed, this build simply
            // has nowhere to send to, and the link above is the way out.
            <p className="about-hint">{t("about.feedbackOff")}</p>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * What the server counted, over a period the reader picks.
 *
 * The numbers are the server's own: it is the only one that knows what
 * happened inside a conversation, and it keeps the count already. This screen
 * asks for a window and draws what came back — it counts nothing itself, so
 * the figures here are the same ones the server would answer with.
 */
function StatsCard() {
  const store = useStore()
  // The toast is a stable function of the store; taking it out here says so,
  // and lets an effect depend on it without depending on the whole store.
  const { toast } = store
  const t = useT()
  const [period, setPeriod] = useState<StatPeriod>("day")
  /** null until the server answers: a build without a count shows dashes. */
  const [stats, setStats] = useState<SessionStats | null>(null)

  /**
   * Ask again whenever the period changes.
   *
   * The period is part of the question, not a filter applied here: the server
   * counts over the window it is given, so a different period is a different
   * request and the old answer must not be reused. The answer that arrives
   * late is dropped — yesterday's window under today's label is worse than no
   * numbers at all.
   */
  useEffect(() => {
    let alive = true
    const span = STAT_PERIODS.find((option) => option.id === period)?.ms ?? 0
    const to = Date.now()
    const from = span > 0 ? to - span : undefined
    void window.ocd.api
      .sessionStats(from, span > 0 ? to : undefined)
      .then((next) => {
        if (alive) setStats(next)
      })
      .catch((err: unknown) => {
        // The card stays as it is. A server that cannot count is worth a
        // toast, not a screen that takes the rest of the page down with it.
        if (!alive) return
        toast(err instanceof Error ? err.message : String(err), "error")
      })
    return () => {
      alive = false
    }
  }, [period, toast])

  /**
   * The models, dearest first.
   *
   * Cost is the order that answers the question a person opens this screen
   * for: which model ate the money.
   */
  const models = useMemo(
    () => [...(stats?.models ?? [])].sort((a, b) => b.cost - a.cost),
    [stats],
  )

  /**
   * The days of work, oldest first, each with its bar.
   *
   * The bar is a share of the busiest day rather than an absolute height: a
   * quiet week and a busy year have to be readable with the same eyes.
   */
  const activity = useMemo(() => {
    const points = [...(stats?.activity ?? [])].sort((a, b) => a.date.localeCompare(b.date))
    const top = points.reduce((max, point) => Math.max(max, point.steps), 0)
    return points.map((point) => ({
      ...point,
      // A day with work must not disappear because another day had ten times
      // as much of it, so the smallest bar still shows.
      height: top > 0 && point.steps > 0 ? Math.max(6, Math.round((point.steps / top) * 100)) : 0,
    }))
  }, [stats])

  const locale = getLanguage()
  // The server may leave a field out; a missing number is a zero, not a crash.
  const num = (value: number) => (Number.isFinite(value) ? value.toLocaleString(locale) : "0")
  /** Money in dollars, to the cent: less than that is not a price. */
  const money = (value: number) => `$${(Number.isFinite(value) ? value : 0).toFixed(2)}`
  /** Tokens as one number: what was read and written, reasoning included. */
  const tokens = stats
    ? (stats.tokens?.input ?? 0) + (stats.tokens?.output ?? 0) + (stats.tokens?.reasoning ?? 0)
    : 0
  /** The cache is counted apart: it was read, not spent. */
  const cacheRead = stats?.tokens?.cache?.read ?? 0
  /** Nothing was written in this period: the card says so instead of zeros. */
  const empty = stats !== null && stats.sessions === 0 && stats.steps === 0

  const figures: Array<[string, string]> = [
    [t("stats.sessions"), stats ? num(stats.sessions) : "—"],
    [t("stats.prompts"), stats ? num(stats.prompts) : "—"],
    [t("stats.steps"), stats ? num(stats.steps) : "—"],
    [t("stats.tokens"), stats ? num(tokens) : "—"],
    [t("stats.cost"), stats ? money(stats.cost) : "—"],
    [t("stats.activeDays"), stats ? num(stats.activeDays) : "—"],
    [t("stats.streak"), stats ? num(stats.streak) : "—"],
  ]
  if (stats && cacheRead > 0) figures.push([t("usage.cacheRead"), num(cacheRead)])

  const tools = stats?.tools
  /** The per-tool breakdown, when the server counted that deep. */
  const toolUsage = tools?.mode === "detail" ? (tools.usage ?? []) : []
  /** The totals, when the server only summed them up. */
  const toolTotals = tools?.mode === "summary" ? (tools.totals ?? null) : null

  return (
    <div className="card">
      <div className="card-head">
        {t("stats.title")}
        <div className="spacer" />
        <div className="seg">
          {STAT_PERIODS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={cx(period === option.id && "on")}
              onClick={() => setPeriod(option.id)}
            >
              {t(option.label)}
            </button>
          ))}
        </div>
      </div>

      <div className="card-body" style={{ display: "grid", gap: 12 }}>
        <p className="about-hint">{t("stats.hint")}</p>

        {empty ? (
          <p className="about-hint">{t("stats.empty")}</p>
        ) : (
          <>
            <div className="stats-grid">
              {figures.map(([label, value]) => (
                <div className="stats-cell" key={label}>
                  <span className="stats-value">{value}</span>
                  <span className="stats-name">{label}</span>
                </div>
              ))}
            </div>

            {activity.length ? (
              <div className="stats-block">
                <div className="stats-section">{t("stats.day")}</div>
                <div className="stats-chart">
                  {activity.map((point) => (
                    <div
                      key={point.date}
                      className="stats-bar"
                      style={{ height: `${point.height}%` }}
                      title={`${point.date} · ${t("stats.steps")}: ${point.steps}`}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {models.length ? (
              <div className="stats-block">
                <div className="stats-section">{t("stats.models")}</div>
                <div className="stats-table">
                  <span />
                  <span className="stats-table-head">{t("stats.steps")}</span>
                  <span className="stats-table-head">{t("stats.tokens")}</span>
                  <span className="stats-table-head">{t("stats.cost")}</span>
                </div>
                {models.map((model) => (
                  <div
                    className="stats-table"
                    key={`${model.model.providerID ?? ""}/${model.model.id}`}
                  >
                    <span className="name mono">
                      {model.model.providerID
                        ? `${model.model.providerID}/${model.model.id}`
                        : model.model.id}
                    </span>
                    <span className="stats-num">{num(model.steps)}</span>
                    <span className="stats-num">
                      {num(
                        (model.tokens?.input ?? 0) +
                          (model.tokens?.output ?? 0) +
                          (model.tokens?.reasoning ?? 0),
                      )}
                    </span>
                    <span className="stats-num">{money(model.cost)}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {toolUsage.length || toolTotals ? (
              <div className="stats-block">
                <div className="stats-section">{t("stats.tools")}</div>
                {toolUsage.map((tool) => (
                  <div className="stats-tool" key={tool.name}>
                    <span className="name mono">{tool.name}</span>
                    {/* "×12" reads as "called twelve times"; the icons next to
                        it say what the other three numbers are. */}
                    <span className="stats-num">×{tool.calls}</span>
                    <span className="stats-mark ok" title={t("tool.done")}>
                      <IconCheck size={11} />
                      {tool.succeeded}
                    </span>
                    <span className="stats-mark err" title={t("tool.error")}>
                      <IconAlert size={11} />
                      {tool.failed}
                    </span>
                    <span className="stats-mark wait" title={t("tool.running")}>
                      {tool.unfinished}
                    </span>
                  </div>
                ))}
                {toolTotals
                  ? Object.entries(toolTotals).map(([name, value]) => (
                      <div className="stats-tool" key={name}>
                        <span className="name">{name}</span>
                        <span className="stats-num">{showValue(value, num)}</span>
                      </div>
                    ))
                  : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * One figure out of the server's totals, in whatever shape it came.
 *
 * The server counts tools differently depending on how deep it was asked to
 * look, so the totals may be numbers, words or a nested object. All of them
 * have to be readable.
 */
function showValue(value: unknown, num: (value: number) => string): string {
  if (typeof value === "number") return num(value)
  if (typeof value === "string") return value
  if (value === null || value === undefined) return "—"
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}