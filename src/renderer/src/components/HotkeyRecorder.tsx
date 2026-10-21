import { useEffect, useRef, useState } from "react"
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

  /**
   * What the listeners below read.
   *
   * The draft, the saved value and the callback live in refs on purpose: the
   * window listeners used to depend on the draft, so every key pressed tore
   * the subscription down and built it up again — and the commit listener
   * read a draft that was one keystroke behind.
   */
  const draftRef = useRef(value)
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    valueRef.current = value
    onChangeRef.current = onChange
  }, [value, onChange])

  /** Set the draft, and keep the ref that the listeners read in step. */
  const setDraftValue = (next: string) => {
    draftRef.current = next
    setDraft(next)
  }

  useEffect(() => {
    if (!recording) {
      draftRef.current = value
      setDraft(value)
    }
  }, [value, recording])

  useEffect(() => {
    if (!recording) return

    const onKey = (event: KeyboardEvent) => {
      // While recording the browser's own shortcuts are all noise.
      event.preventDefault()
      event.stopPropagation()

      if (event.key === "Escape") {
        setRecording(false)
        setDraftValue(valueRef.current)
        return
      }
      if (event.key === "Enter" && draftRef.current) {
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
      setDraftValue([...mods, key].join("+"))
    }

    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [recording])

  // Commit as soon as the user leaves the control.
  useEffect(() => {
    if (!recording) return
    const commit = () => {
      setRecording(false)
      void onChangeRef.current(draftRef.current).then((result) =>
        setStatus(result.ok ? "ok" : "taken"),
      )
    }
    window.addEventListener("pointerdown", commit)
    return () => window.removeEventListener("pointerdown", commit)
  }, [recording])

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
            setDraftValue("")
            setStatus("idle")
            void onChange("").catch(() => setStatus("taken"))
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