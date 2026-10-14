import { useEffect, useState } from "react"
import { useT } from "../i18n"

/** Keys Electron's accelerator format never wants, whatever the combination. */
const DEAD = new Set([
  "Control",
  "Shift",
  "Alt",
  "Meta",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "Dead",
  "AltGraph",
  "ContextMenu",
  "Escape",
])

function pretty(accelerator: string): string {
  return accelerator
    .split("+")
    .map((part) =>
      part === "CommandOrControl" ? "Ctrl" : part === "Plus" ? "+" : part.length === 1 ? part.toUpperCase() : part,
    )
    .join("+")
}

/**
 * Global hotkey recorder.
 *
 * Listening for real `keydown` events is the only way to get a combination
 * the user actually holds — including Shift-digits and Alt-letter, which a
 * hand-written picker gets wrong. The live preview is committed by clicking
 * outside or pressing Enter, so a mis-key can be abandoned with Escape.
 */
export function HotkeyRecorder({
  value,
  onChange,
}: {
  value: string
  onChange: (accelerator: string) => Promise<{ ok: boolean; error?: string }>
}) {
  const t = useT()
  const [recording, setRecording] = useState(false)
  const [draft, setDraft] = useState(value)
  const [status, setStatus] = useState<"idle" | "ok" | "taken">("idle")

  useEffect(() => {
    if (!recording) setDraft(value)
  }, [value, recording])

  useEffect(() => {
    if (!recording) return

    const onKey = (event: KeyboardEvent) => {
      // While recording the browser's own shortcuts are all noise.
      event.preventDefault()
      event.stopPropagation()

      if (event.key === "Escape") {
        setRecording(false)
        setDraft(value)
        return
      }
      if (event.key === "Enter" && draft) {
        event.preventDefault()
        setRecording(false)
        return
      }
      if (DEAD.has(event.key)) return

      const mods: string[] = []
      if (event.ctrlKey) mods.push("Control")
      if (event.altKey) mods.push("Alt")
      if (event.shiftKey) mods.push("Shift")
      if (event.metaKey) mods.push("Super")

      // A bare modifier press produces a key like "Shift" — already filtered
      // above — but a function-key row (F5..F12) arrives without modifiers
      // and is still a usable accelerator.
      const key = event.key.length === 1 ? event.key.toUpperCase() : event.key
      if (!key) return
      setDraft([...mods, key].join("+"))
    }

    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [recording, draft, value])

  // Commit as soon as the user leaves the control.
  useEffect(() => {
    if (!recording) return
    const commit = () => {
      setRecording(false)
      void onChange(draft).then((result) => setStatus(result.ok ? "ok" : "taken"))
    }
    window.addEventListener("pointerdown", commit)
    return () => window.removeEventListener("pointerdown", commit)
  }, [recording, draft, onChange])

  return (
    <div className="hotkey-recorder">
      <button
        type="button"
        className={recording ? "hotkey recording" : "hotkey"}
        onClick={() => {
          setStatus("idle")
          setRecording(true)
        }}
      >
        {recording ? (
          <span className="hotkey-draft">{draft || t("set.hotkeyRecord")}</span>
        ) : (
          <span className="hotkey-value">{draft ? pretty(draft) : "—"}</span>
        )}
      </button>
      {draft ? (
        <button
          type="button"
          className="linkbtn"
          onClick={() => {
            setRecording(false)
            setDraft("")
            setStatus("idle")
            void onChange("")
          }}
        >
          {t("set.hotkeyClear")}
        </button>
      ) : null}
      {status === "taken" ? <span className="field-note warn">{t("set.hotkeyTaken")}</span> : null}
      {status === "ok" && draft ? <span className="field-note">{t("set.hotkeyOk")}</span> : null}
    </div>
  )
}