import { useCallback, useEffect, useRef, useState } from "react"
import type { FeedbackKind } from "@shared/types"
import { useStore } from "../lib/store"
import { Switch } from "../components/ui"
import { IconCheck, IconDownload, IconLink, IconRefresh, IconSend, IconAlert } from "../components/Icon"
import { ViewBack } from "../components/ViewBack"
import { useT } from "../i18n"

/** Where a person goes when the app has nowhere to send a note. */
const AUTHOR_URL = "https://github.com/Sergey35853"

/** The same door by a second road, for the people who do not use GitHub. */
const AUTHOR_TELEGRAM = "https://t.me/Link_Ser"

/** Matches the caps in main/feedback.ts, so a pasted wall of text is cut, not refused. */
const MAX_MESSAGE = 4000
const MAX_CONTACT = 200

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
    void window.ocd.app.version().then(setVersions)
    void window.ocd.configFile.path().then(setConfigPath)
    void window.ocd.feedback.configured().then(setCanSend).catch(() => setCanSend(false))
  }, [])

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