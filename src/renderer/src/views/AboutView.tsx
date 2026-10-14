import { useCallback, useEffect, useState } from "react"
import { useStore } from "../lib/store"
import { Switch } from "../components/ui"
import { IconCheck, IconDownload, IconRefresh, IconAlert } from "../components/Icon"
import { ViewBack } from "../components/ViewBack"
import { useT } from "../i18n"

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

  useEffect(() => {
    void window.ocd.app.version().then(setVersions)
    void window.ocd.configFile.path().then(setConfigPath)
  }, [])

  /**
   * Check, and say what came back here rather than in a toast.
   *
   * The check is the one place where "nothing" is a real answer: a person who
   * opened this screen wants to see that the app looked, not to have it say so
   * and then vanish.
   */
  const check = useCallback(async () => {
    setBusy(true)
    try {
      const result = await window.ocd.app.checkForUpdates()
      setUpdateCheck(result)
      store.toast(result.message, result.ok ? "info" : "error")
    } catch (err) {
      store.toast(err instanceof Error ? err.message : String(err), "error")
    } finally {
      setBusy(false)
    }
  }, [store])

  useEffect(() => {
    // Open the screen and look: the whole point of the button is not having to
    // wonder whether the build is current.
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
    </div>
  )
}