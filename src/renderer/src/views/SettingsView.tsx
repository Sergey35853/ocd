import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useStore } from "../lib/store"
import { cx } from "../lib/format"
import { Field, Modal, Switch } from "../components/ui"
import { IconFolder, IconPanel, IconRefresh, IconTerminal } from "../components/Icon"
import { BusyAnimation } from "../components/BusyAnimation"
import { ViewBack } from "../components/ViewBack"
import { HotkeyRecorder } from "../components/HotkeyRecorder"
import { LANGUAGES, useT } from "../i18n"
import type {
  BusyAnimationKind,
  BusyAnimationSettings,
  ReplyLanguage,
  UiLanguage,
} from "@shared/types"

const THEME_PRESETS: Record<string, { tint: string; opacity: number }> = {
  // Light: a thin veil, so the Mica behind the window stays visible.
  // Dark: a dense veil, because the Mica behind it is a light surface.
  light: { tint: "#eef3fa", opacity: 0.45 },
  dark: { tint: "#202020", opacity: 0.85 },
}

function MicPicker() {
  const store = useStore()
  const t = useT()
  const [devices, setDevices] = useState<Array<{ index: number; name: string }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void window.ocd.voice
      .devices()
      .then((result) => {
        if (cancelled) return
        setDevices(result.devices)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const value = store.settings?.micDevice ?? ""

  return (
    <select
      className="select"
      value={value}
      disabled={loading}
      onChange={(event) => void store.updateSettings({ micDevice: event.target.value })}
    >
      <option value="">{t("set.micDefault")}</option>
      {devices.map((device) => (
        <option key={device.index} value={String(device.index)}>
          {device.name}
        </option>
      ))}
    </select>
  )
}

/**
 * One section of the page: a name, a line saying what it is for, and the cards.
 *
 * The note is the part that was missing. A list of toggles tells you what can be
 * changed but not which of them you actually wanted, and the answer was to read
 * every label twice.
 */
function SectionIntro({ title, note }: { title: string; note: string }) {
  return (
    <div className="settings-intro">
      <h2>{title}</h2>
      <p>{note}</p>
    </div>
  )
}

/**
 * The model a new session starts with.
 *
 * A list rather than two text fields. Model names carry a provider on one side
 * and a version on the other, they are easy to mistype, and a typo fails
 * quietly: the next session opens and simply refuses to answer. The names come
 * from the server's own catalog, which can be fetched again on demand, because
 * models are added and retired there and anything spelled out here ages within
 * a week.
 *
 * A native select, like the agent field below it, and not the searchable popup
 * used in the chat header: those live in cards, and a card clips its content,
 * so the popup's menu would be cut off at the card's edge.
 */
function DefaultModelField() {
  const store = useStore()
  const t = useT()
  const [busy, setBusy] = useState(false)

  const provider = store.settings?.defaultProvider ?? ""
  const model = store.settings?.defaultModel ?? ""
  const currentKey = provider && model ? `${provider}/${model}` : ""

  const groups = useMemo(() => {
    const byProvider = new Map<string, { name: string; entries: Array<{ key: string; label: string }> }>()
    for (const entry of store.models) {
      const id = entry.providerID ?? ""
      const group = byProvider.get(id) ?? {
        name: store.providers.find((item) => item.id === id)?.name ?? id,
        entries: [],
      }
      group.entries.push({ key: `${id}/${entry.id}`, label: entry.name || entry.id })
      byProvider.set(id, group)
    }
    return [...byProvider.entries()].map(([id, group]) => ({ id, ...group }))
  }, [store.models, store.providers])

  // The set model can be missing from the catalog: retired on the server, or
  // typed into the settings file by hand. Leaving it in the list means the
  // field keeps showing what sessions are actually using rather than falling
  // back to a label that reads like nothing had been chosen.
  const known = groups.some((group) => group.entries.some((entry) => entry.key === currentKey))

  const refresh = async () => {
    setBusy(true)
    try {
      await store.refreshCatalog()
      store.toast(t("set.modelRefreshed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Field label={t("set.defaultModel")} hint={t("set.defaultModelHint")}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select
          className="select"
          style={{ flex: 1, minWidth: 0 }}
          value={currentKey}
          onChange={(event) => {
            const key = event.target.value
            const at = key.indexOf("/")
            const providerID = key.slice(0, at)
            const id = key.slice(at + 1)
            void store.setModel(providerID, id).then(() => {
              store.toast(t("toast.modelDefault", { provider: providerID, model: id }))
            })
          }}
        >
          {currentKey && !known ? <option value={currentKey}>{model}</option> : null}
          {!currentKey ? <option value="">{t("set.pickModel")}</option> : null}
          {groups.map((group) => (
            <optgroup key={group.id} label={group.name}>
              {group.entries.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          disabled={busy}
          title={t("set.modelRefreshHint")}
          onClick={() => void refresh()}
        >
          <IconRefresh size={14} /> {t("common.refresh")}
        </button>
        {groups.length === 0 ? (
          <span style={{ color: "var(--text-faint)", fontSize: 12 }}>{t("set.modelEmpty")}</span>
        ) : null}
      </div>
    </Field>
  )
}

export function SettingsView({ onBack }: { onBack: () => void }) {
  const store = useStore()
  const t = useT()
  const settings = store.settings
  const [editorOpen, setEditorOpen] = useState(false)
  const [draft, setDraft] = useState("")
  const [configPath, setConfigPath] = useState("")
  const [section, setSection] = useState("look")

  // Remote (SSH) block state. Kept local: it is a connection the user opens
  // by hand, not a preference to persist.
  const [remoteHost, setRemoteHost] = useState("")
  const [remotePort, setRemotePort] = useState("4096")
  const [remoteBusy, setRemoteBusy] = useState(false)
  const [remoteError, setRemoteError] = useState("")
  const [remote, setRemote] = useState<{ active: boolean; url: string | null }>({
    active: false,
    url: null,
  })

  useEffect(() => {
    void window.ocd.remote
      .status()
      .then(setRemote)
      .catch(() => undefined)
  }, [])

  const connectRemote = async () => {
    setRemoteBusy(true)
    setRemoteError("")
    try {
      const result = await window.ocd.remote.connect({
        host: remoteHost.trim(),
        remotePort: Number(remotePort) || 4096,
      })
      setRemote({ active: true, url: result.url })
      await store.refreshSessions()
    } catch (err) {
      setRemoteError(err instanceof Error ? err.message : String(err))
      setRemote({ active: false, url: null })
    } finally {
      setRemoteBusy(false)
    }
  }

  const busy: BusyAnimationSettings = settings?.busyAnimation ?? {
    kind: "matrix",
    opacity: 0.22,
    speed: 1,
    hue: 145,
    density: 16,
  }

  // Sliders fire on every step, so keep the local copy responsive and
  // push the whole object up in one go.
  const patchBusy = (patch: Partial<BusyAnimationSettings>) => {
    void store.updateSettings({ busyAnimation: { ...busy, ...patch } })
  }

  useEffect(() => {
    void window.ocd.configFile.path().then(setConfigPath)
  }, [])

  useEffect(() => {
    setSection("look")
  }, [settings])

  if (!settings) return <div className="view" />

  const openEditor = async () => {
    try {
      const info = await window.ocd.configFile.read()
      setDraft(info.text)
      setConfigPath(info.path)
      setEditorOpen(true)
    } catch (err) {
      store.toast(err instanceof Error ? err.message : String(err), "error")
    }
  }

  const saveEditor = async () => {
    try {
      const result = await window.ocd.configFile.write(draft)
      if (!result.ok) {
        store.toast(result.error ?? t("set.saveFailed"), "error")
        return
      }
      setEditorOpen(false)
      store.toast(t("set.configSaved"))
      await window.ocd.configFile.reload().catch(() => {})
      await store.refreshCatalog()
    } catch (err) {
      store.toast(err instanceof Error ? err.message : String(err), "error")
    }
  }

  const testVoice = () =>
    void window.ocd.voice
      .speak(t("set.voiceSample"))
      .then((result) => {
        if (!result.ok) store.toast(result.error ?? t("set.failed"), "error")
        else store.toast(t("set.spokenAs", { voice: result.voice ?? result.engine ?? "" }))
      })
      .catch((err: unknown) => store.toast(err instanceof Error ? err.message : String(err), "error"))

  const testMic = async () => {
    const found = await window.ocd.voice.devices()
    if (found.error) return store.toast(found.error, "error")
    store.toast(
      found.devices.length
        ? t("set.devicesCount", { n: found.devices.length })
        : t("set.noMics"),
    )
  }

  const exportSettings = async () => {
    try {
      const path = await window.ocd.settings.export()
      if (path) store.toast(t("set.exportDone", { path }), "info")
    } catch (err) {
      store.toast(
        t("set.transferFailed", {
          error: err instanceof Error ? err.message : String(err),
        }),
        "error",
      )
    }
  }

  const importSettings = async () => {
    try {
      await window.ocd.settings.import()
      store.toast(t("set.importDone"), "info")
    } catch (err) {
      store.toast(
        t("set.transferFailed", {
          error: err instanceof Error ? err.message : String(err),
        }),
        "error",
      )
    }
  }

  /**
   * The page, as a list of topics rather than one long column.
   *
   * `render` rather than the markup itself: only the section on screen is
   * built, so the eight others cost nothing but a label. Splitting the old
   * "Поведение" card is the point — it held window, tray, hotkey, HUD, usage
   * meters, sending, backup and notifications in one flat list, which is three
   * unrelated questions wearing one heading.
   */
  const sections: Array<{ id: string; label: string; note: string; render: () => ReactNode }> = [
    {
      id: "look",
      label: t("set.appearance"),
      note: t("set.noteLook"),
      render: () => (
        <div className="card">
          <Field label={t("set.theme")} hint={t("set.themeHint")}>
            <select
              className="select"
              value={settings.theme}
              onChange={(event) => {
                const theme = event.target.value
                const preset = THEME_PRESETS[theme]
                void store.updateSettings(
                  preset
                    ? { theme, acrylicTint: preset.tint, acrylicOpacity: preset.opacity }
                    : { theme },
                )
              }}
            >
              <option value="auto">{t("set.themeAuto")}</option>
              <option value="light">{t("set.themeLight")}</option>
              <option value="dark">{t("set.themeDark")}</option>
            </select>
          </Field>

          <Field label={t("set.blur")} hint={t("set.blurHint")}>
            <Switch
              on={settings.blurBehind}
              onChange={(value) => void store.updateSettings({ blurBehind: value })}
            />
          </Field>

          <Field label={t("set.backdrop")} hint={t("set.backdropHint")}>
            <select
              className="select"
              value={settings.backdrop}
              onChange={(event) =>
                void store.updateSettings({ backdrop: event.target.value })
              }
            >
              <option value="micaAlt">{t("set.backdropMica")}</option>
              <option value="acrylic">{t("set.backdropAcrylic")}</option>
            </select>
          </Field>

          <Field
            label={t("set.backdropDensity")}
            hint={`${Math.round(settings.acrylicOpacity * 100)}% · ${t("set.backdropDensityHint")}`}
          >
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.02}
              value={settings.acrylicOpacity}
              onChange={(event) =>
                void store.updateSettings({ acrylicOpacity: Number(event.target.value) })
              }
            />
          </Field>

          <Field label={t("set.tintBackdrop")} hint={t("set.tintBackdropHint")}>
            <input
              type="color"
              value={settings.acrylicTint}
              onChange={(event) => void store.updateSettings({ acrylicTint: event.target.value })}
            />
          </Field>

          <Field label={t("set.accent")} hint={t("set.accentHint")}>
            <input
              type="color"
              value={settings.accentColor}
              onChange={(event) =>
                void store.updateSettings({ accentColor: event.target.value })
              }
            />
          </Field>

          <Field
            label={t("set.fontScale")}
            hint={`${Math.round(settings.fontScale * 100)}% · ${t("set.fontScaleHint")}`}
          >
            <input
              type="range"
              min={0.85}
              max={1.35}
              step={0.05}
              value={settings.fontScale}
              onChange={(event) =>
                void store.updateSettings({ fontScale: Number(event.target.value) })
              }
            />
          </Field>
        </div>
      ),
    },
    {
      id: "window",
      label: t("set.secWindow"),
      note: t("set.noteWindow"),
      render: () => (
        <div className="card">
          <Field label={t("set.alwaysOnTop")} hint={t("set.alwaysOnTopHint")}>
            <Switch
              on={settings.alwaysOnTop}
              onChange={(value) => void store.updateSettings({ alwaysOnTop: value })}
            />
          </Field>

          <Field label={t("set.closeToTray")} hint={t("set.closeToTrayHint")}>
            <Switch
              on={settings.closeToTray}
              onChange={(value) => void store.updateSettings({ closeToTray: value })}
            />
          </Field>

          <Field label={t("set.startMinimized")} hint={t("set.startMinimizedHint")}>
            <Switch
              on={settings.startMinimized}
              onChange={(value) => void store.updateSettings({ startMinimized: value })}
            />
          </Field>

          <Field label={t("set.hotkey")} hint={t("set.hotkeyHint")}>
            <HotkeyRecorder
              value={settings.globalHotkey}
              onChange={async (accelerator) => {
                const result = await window.ocd.app.setGlobalHotkey(accelerator)
                // Main writes the setting only on success, so a taken key does
                // not get persisted and retried on every launch.
                if (result.ok) await store.updateSettings({ globalHotkey: accelerator })
                return result
              }}
            />
          </Field>

          <Field label={t("set.hud")} hint={t("set.hudHint")}>
            <button type="button" className="btn" onClick={() => void window.ocd.hud.toggle()}>
              <IconPanel size={14} />
              {t("set.hudToggle")}
            </button>
          </Field>
        </div>
      ),
    },
    {
      id: "chat",
      label: t("set.secChat"),
      note: t("set.noteChat"),
      render: () => (
        <div className="card">
          <Field label={t("set.showUsage")} hint={t("set.showUsageHint")}>
            <Switch
              on={settings.showUsage}
              onChange={(value) => void store.updateSettings({ showUsage: value })}
            />
          </Field>

          <Field label={t("set.showLimits")} hint={t("set.showLimitsHint")}>
            <Switch
              on={settings.showLimits !== false}
              onChange={(value) => void store.updateSettings({ showLimits: value })}
            />
          </Field>

          <Field label={t("set.showThinking")} hint={t("set.showThinkingHint")}>
            <Switch
              on={settings.showThinking}
              onChange={(value) => void store.updateSettings({ showThinking: value })}
            />
          </Field>

          <Field label={t("set.sendOnEnter")} hint={t("set.sendOnEnterHint")}>
            <Switch
              on={settings.sendOnEnter}
              onChange={(value) => void store.updateSettings({ sendOnEnter: value })}
            />
          </Field>

          <Field label={t("set.busySend")} hint={t("set.busySendHint")}>
            <select
              className="select"
              value={settings.busySendMode ?? "steer"}
              onChange={(event) =>
                void store.updateSettings({
                  busySendMode: event.target.value as "steer" | "queue",
                })
              }
            >
              <option value="steer">{t("set.busySteer")}</option>
              <option value="queue">{t("set.busyQueue")}</option>
            </select>
          </Field>

          <Field label={t("set.notify")} hint={t("set.notifyHint")}>
            <Switch
              on={settings.notifyOnFinish}
              onChange={(value) => void store.updateSettings({ notifyOnFinish: value })}
            />
          </Field>
        </div>
      ),
    },
    {
      id: "voice",
      label: t("set.voiceTitle"),
      note: t("set.noteVoice"),
      render: () => (
        <>
          <div className="card">
            <div className="card-head">
              {t("set.ttsTitle")}
              <div className="spacer" />
              <button type="button" className="btn" onClick={testVoice}>
                {t("set.testVoice")}
              </button>
            </div>

            <Field label={t("set.speakReplies")} hint={t("set.speakRepliesHint")}>
              <Switch
                on={settings.speakReplies}
                onChange={(value) => void store.updateSettings({ speakReplies: value })}
              />
            </Field>

            <Field label={t("set.ttsEngine")} hint={t("set.ttsEngineHint")}>
              <select
                className="select"
                value={settings.ttsEngine}
                onChange={(event) => void store.updateSettings({ ttsEngine: event.target.value })}
              >
                <option value="auto">{t("set.ttsAuto")}</option>
                <option value="edge">{t("set.ttsEdge")}</option>
                <option value="sapi">{t("set.ttsSapi")}</option>
              </select>
            </Field>

            <Field label={t("set.ttsVoice")} hint={t("set.ttsVoiceHint")}>
              <select
                className="select"
                value={settings.ttsVoice}
                onChange={(event) => void store.updateSettings({ ttsVoice: event.target.value })}
              >
                <option value="ru-RU-SvetlanaNeural">{t("set.voiceSvetlana")}</option>
                <option value="ru-RU-DmitryNeural">{t("set.voiceDmitry")}</option>
                <option value="en-US-JennyNeural">{t("set.voiceJenny")}</option>
                <option value="en-US-AriaNeural">{t("set.voiceAria")}</option>
              </select>
            </Field>

            <Field label={t("set.ttsRate")} hint={settings.ttsRate}>
              <input
                type="range"
                min={-30}
                max={40}
                step={2}
                value={Number(settings.ttsRate.replace("%", "")) || 0}
                onChange={(event) =>
                  void store.updateSettings({ ttsRate: `${event.target.value}%` })
                }
              />
            </Field>

            <Field label={t("set.ttsPitch")} hint={settings.ttsPitch}>
              <input
                type="range"
                min={-20}
                max={20}
                step={2}
                value={Number(settings.ttsPitch.replace("Hz", "")) || 0}
                onChange={(event) =>
                  void store.updateSettings({ ttsPitch: `${event.target.value}Hz` })
                }
              />
            </Field>

            <Field label={t("set.playbackVolume")} hint={`${settings.playbackVolume}%`}>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={settings.playbackVolume}
                onChange={(event) =>
                  void store.updateSettings({ playbackVolume: Number(event.target.value) })
                }
              />
            </Field>

            <Field
              label={t("set.ttsMaxChars")}
              hint={t("set.ttsMaxCharsHint", { n: settings.ttsMaxChars })}
            >
              <input
                type="range"
                min={120}
                max={1500}
                step={20}
                value={settings.ttsMaxChars}
                onChange={(event) =>
                  void store.updateSettings({ ttsMaxChars: Number(event.target.value) })
                }
              />
            </Field>
          </div>

          <div className="card">
            <div className="card-head">
              {t("set.dictationTitle")}
              <div className="spacer" />
              <button type="button" className="btn" onClick={() => void testMic()}>
                {t("set.testMic")}
              </button>
            </div>

            <Field label={t("set.sttModel")} hint={t("set.sttHint")}>
              <select
                className="select"
                value={settings.sttModel}
                onChange={(event) => void store.updateSettings({ sttModel: event.target.value })}
              >
                <option value="tiny">{t("set.sttTiny")}</option>
                <option value="base">base</option>
                <option value="small">{t("set.sttSmall")}</option>
                <option value="medium">{t("set.sttMedium")}</option>
              </select>
            </Field>

            <Field label={t("set.sttLanguage")}>
              <select
                className="select"
                value={settings.sttLanguage}
                onChange={(event) => void store.updateSettings({ sttLanguage: event.target.value })}
              >
                <option value="auto">{t("set.auto")}</option>
                <option value="ru">{t("set.replyRu")}</option>
                <option value="en">{t("set.replyEn")}</option>
              </select>
            </Field>

            <Field label={t("set.mic")} hint={t("set.micHint")}>
              <MicPicker />
            </Field>

            <Field label={t("set.dictateDeliver")} hint={t("set.dictateDeliverHint")}>
              <select
                className="select"
                value={settings.dictateDeliver}
                onChange={(event) =>
                  void store.updateSettings({
                    dictateDeliver: event.target.value as "insert" | "send",
                  })
                }
              >
                <option value="insert">{t("set.dictateInsert")}</option>
                <option value="send">{t("set.dictateSendNow")}</option>
              </select>
            </Field>
          </div>
        </>
      ),
    },
    {
      id: "anim",
      label: t("anim.title"),
      note: t("set.noteAnim"),
      render: () => (
        <div className="card">
          <Field label={t("anim.kind")} hint={t("anim.kindHint")}>
            <select
              className="select"
              value={busy.kind}
              onChange={(event) => patchBusy({ kind: event.target.value as BusyAnimationKind })}
            >
              <option value="off">{t("anim.off")}</option>
              <option value="matrix">{t("anim.matrix")}</option>
              <option value="aurora">{t("anim.aurora")}</option>
              <option value="scanlines">{t("anim.scanlines")}</option>
              <option value="pulse">{t("anim.pulse")}</option>
              <option value="dots">{t("anim.dots")}</option>
            </select>
          </Field>

          <Field label={t("anim.opacity", { n: Math.round(busy.opacity * 100) })}>
            <input
              className="range"
              type="range"
              min={0.05}
              max={0.7}
              step={0.01}
              value={busy.opacity}
              onChange={(event) => patchBusy({ opacity: Number(event.target.value) })}
            />
          </Field>

          <Field label={t("anim.speed", { n: busy.speed.toFixed(2) })}>
            <input
              className="range"
              type="range"
              min={0.3}
              max={2.5}
              step={0.05}
              value={busy.speed}
              onChange={(event) => patchBusy({ speed: Number(event.target.value) })}
            />
          </Field>

          <Field label={t("anim.hue", { n: busy.hue })} hint={t("anim.hueHint")}>
            <input
              className="range"
              type="range"
              min={0}
              max={360}
              step={1}
              value={busy.hue}
              onChange={(event) => patchBusy({ hue: Number(event.target.value) })}
            />
          </Field>

          <Field label={t("anim.density", { n: busy.density })} hint={t("anim.densityHint")}>
            <input
              className="range"
              type="range"
              min={8}
              max={28}
              step={1}
              value={busy.density}
              onChange={(event) => patchBusy({ density: Number(event.target.value) })}
            />
          </Field>

          <div className="ba-preview">
            <BusyAnimation settings={busy} />
            <span className="ba-preview-label">
              {busy.kind === "off" ? t("anim.previewOff") : t("anim.preview")}
            </span>
          </div>
        </div>
      ),
    },
    {
      id: "opencode",
      label: t("set.opencode"),
      note: t("set.noteOpencode"),
      render: () => (
        <div className="card">
          <Field label={t("set.directory")} hint={store.directory || t("set.directoryNone")}>
            <button
              type="button"
              className="btn"
              onClick={async () => {
                const picked = await window.ocd.app.pickDirectory()
                if (picked) await store.setDirectory(picked)
              }}
            >
              <IconFolder size={14} /> {t("set.choose")}
            </button>
          </Field>

          <DefaultModelField />

          <Field label={t("set.defaultAgent")} hint={t("set.defaultAgentHint")}>
            <select
              className="select"
              value={settings.defaultAgent}
              onChange={(event) => void store.updateSettings({ defaultAgent: event.target.value })}
            >
              {store.agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name || agent.id}
                </option>
              ))}
              <option value="build">build</option>
              <option value="plan">plan</option>
            </select>
          </Field>

          <Field label={t("set.serverUrl")} hint={t("set.serverUrlHint")}>
            <input
              className="input"
              placeholder="http://127.0.0.1:4096"
              value={settings.serverUrlOverride}
              onChange={(event) => void store.updateSettings({ serverUrlOverride: event.target.value })}
            />
          </Field>

          <Field label={t("set.restartServer")} hint={t("set.restartServerHint")}>
            <button type="button" className="btn" onClick={() => void store.restartService()}>
              <IconRefresh size={14} /> {t("set.restart")}
            </button>
          </Field>
        </div>
      ),
    },
    {
      id: "language",
      label: t("set.languageTitle"),
      note: t("set.noteLanguage"),
      render: () => (
        <div className="card">
          <Field label={t("set.language")} hint={t("set.languageHint")}>
            <select
              className="select"
              value={settings.uiLanguage}
              onChange={(event) =>
                void store.updateSettings({ uiLanguage: event.target.value as UiLanguage })
              }
            >
              {LANGUAGES.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("set.replyLanguage")} hint={t("set.replyLanguageHint")}>
            <select
              className="select"
              value={settings.replyLanguage}
              onChange={(event) => {
                const lang = event.target.value as ReplyLanguage
                void store.updateSettings({ replyLanguage: lang })
                void window.ocd.configFile.setReplyLanguage(lang).then((result) => {
                  if (!result.ok) store.toast(result.error ?? t("set.writeFailed"), "error")
                })
              }}
            >
              <option value="ru">{t("set.replyRu")}</option>
              <option value="en">{t("set.replyEn")}</option>
              <option value="auto">{t("set.replyAuto")}</option>
            </select>
          </Field>
        </div>
      ),
    },
    {
      id: "remote",
      label: t("set.remoteTitle"),
      note: t("set.noteRemote"),
      render: () => (
        <div className="card">
          <Field label={t("set.remoteHost")} hint={t("set.remoteHostHint")}>
            <div className="hstack">
              <input
                className="input"
                placeholder="user@host"
                value={remoteHost}
                onChange={(event) => setRemoteHost(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void connectRemote()
                }}
              />
              <input
                className="input port"
                inputMode="numeric"
                placeholder="4096"
                value={remotePort}
                onChange={(event) => setRemotePort(event.target.value.replace(/\D/g, ""))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void connectRemote()
                }}
              />
              <button
                type="button"
                className="btn"
                disabled={remoteBusy || !remoteHost.trim()}
                onClick={() => void connectRemote()}
              >
                {remoteBusy ? t("set.remoteConnecting") : t("set.remoteConnect")}
              </button>
              {remote.active ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => void window.ocd.remote.disconnect()}
                >
                  {t("set.remoteDisconnect")}
                </button>
              ) : null}
            </div>
          </Field>

          {remoteError ? <div className="field-note warn">{remoteError}</div> : null}
          {remote.active ? (
            <div className="field-note">{t("set.remoteActive", { url: remote.url ?? "" })}</div>
          ) : null}
        </div>
      ),
    },
    {
      id: "data",
      label: t("set.secData"),
      note: t("set.noteData"),
      render: () => (
        <div className="card">
          <Field label={t("set.transfer")} hint={t("set.transferHint")}>
            <div className="row">
              <button type="button" className="btn" onClick={() => void exportSettings()}>
                {t("set.export")}
              </button>
              <button type="button" className="btn" onClick={() => void importSettings()}>
                {t("set.import")}
              </button>
            </div>
          </Field>
        </div>
      ),
    },
  ]

  const active = sections.find((item) => item.id === section) ?? sections[0]

  return (
    <div className="view">
      <div className="view-head">
        <ViewBack onClick={onBack} />
        <h1>{t("set.title")}</h1>
        <div className="spacer" />
        <button type="button" className="btn" onClick={() => void openEditor()}>
          <IconTerminal size={14} /> {t("set.editConfig")}
        </button>
      </div>

      <div className="settings">
        <nav className="settings-nav" aria-label={t("set.title")}>
          {sections.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cx("settings-nav-item", item.id === active.id && "active")}
              aria-current={item.id === active.id}
              onClick={() => setSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="settings-body">
          <SectionIntro title={active.label} note={active.note} />
          {active.render()}
        </div>
      </div>

      {editorOpen ? (
        <Modal
          title="opencode.jsonc"
          onClose={() => setEditorOpen(false)}
          actions={
            <button type="button" className="btn primary" onClick={() => void saveEditor()}>
              {t("common.save")}
            </button>
          }
        >
          <div
            style={{
              color: "var(--text-faint)",
              fontSize: 12,
              marginBottom: 8,
              wordBreak: "break-all",
            }}
          >
            {configPath}
          </div>
          <textarea
            className={cx("editor")}
            value={draft}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div style={{ color: "var(--text-faint)", fontSize: 12, marginTop: 8 }}>
            {t("set.backupNote")}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}