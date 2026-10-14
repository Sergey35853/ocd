import { useCallback, useEffect, useState } from "react"
import { cx, truncate } from "../lib/format"
import { useT } from "../i18n"
import { IconClose, IconPin } from "./Icon"

/**
 * Pinned answers and a per-conversation note.
 *
 * Both are local to OCD on purpose. The server has no notion of either, and
 * storing them in the conversation would mean they get summarised by the next
 * turn and pushed through the model — a pin is a UI decision, and a note is
 * something the model should never read unless the user pastes it.
 */

interface Pin {
  /** Message id, so a pin can be removed when its turn scrolls away. */
  id: string
  /** Body text at the moment of pinning. */
  text: string
  at: number
}

const PIN_KEY = "ocd.pins.v1:"
const NOTE_KEY = "ocd.note.v1:"
const PIN_LIMIT = 20

type Store = Record<string, Pin[]>

function readAllPins(): Store {
  try {
    return JSON.parse(localStorage.getItem(PIN_KEY) ?? "{}") as Store
  } catch {
    return {}
  }
}

function readPins(sessionId: string): Pin[] {
  if (!sessionId) return []
  const store = readAllPins()
  return Array.isArray(store[sessionId]) ? store[sessionId] : []
}

function writePins(sessionId: string, pins: Pin[]): void {
  try {
    const store = readAllPins()
    if (pins.length) store[sessionId] = pins
    else delete store[sessionId]
    localStorage.setItem(PIN_KEY, JSON.stringify(store))
  } catch {
    /* storage unavailable: pins simply do not survive the restart */
  }
}

function readNote(sessionId: string): string {
  if (!sessionId) return ""
  try {
    return localStorage.getItem(NOTE_KEY + sessionId) ?? ""
  } catch {
    return ""
  }
}

function writeNote(sessionId: string, note: string): void {
  try {
    if (!note.trim()) localStorage.removeItem(NOTE_KEY + sessionId)
    else localStorage.setItem(NOTE_KEY + sessionId, note)
  } catch {
    /* storage unavailable */
  }
}

/** The pinned block and the note editor shown above the message stream. */
export function SessionBoard({
  sessionId,
  pinnedOpen,
  onTogglePinnedOpen,
  registerPin,
}: {
  sessionId: string
  /** Whether the pin list is expanded; only rendered when pins exist. */
  pinnedOpen: boolean
  onTogglePinnedOpen(): void
  /**
   * Lets a message's pin button add to this board. The board owns the storage,
   * so the writer has to live here rather than in the message — a pin added
   * from two places would need two copies of the same localStorage logic.
   */
  registerPin(add: (text: string) => void): void
}) {
  const t = useT()
  const [pins, setPins] = useState<Pin[]>([])
  const [note, setNote] = useState("")
  const [noteOpen, setNoteOpen] = useState(false)

  useEffect(() => {
    setPins(readPins(sessionId))
    setNote(readNote(sessionId))
  }, [sessionId])

  const add = useCallback(
    (text: string) => {
      const body = text.trim()
      if (!body || !sessionId) return
      const entry: Pin = { id: `${sessionId}:${Date.now()}`, text: body, at: Date.now() }
      setPins((current) => {
        const next = [entry, ...current].slice(0, PIN_LIMIT)
        writePins(sessionId, next)
        return next
      })
    },
    [sessionId],
  )

  // Hand the writer to whoever renders the messages.
  useEffect(() => {
    registerPin(add)
  }, [registerPin, add])

  const remove = useCallback(
    (id: string) => {
      setPins((current) => {
        const next = current.filter((pin) => pin.id !== id)
        writePins(sessionId, next)
        return next
      })
    },
    [sessionId],
  )

  if (!sessionId) return null

  return (
    <div className="board">
      {pins.length ? (
        <div className={cx("board-pins", pinnedOpen && "open")}>
          <button
            type="button"
            className="board-bar"
            onClick={onTogglePinnedOpen}
            aria-expanded={pinnedOpen}
          >
            <IconPin size={13} />
            <span>{t("board.pins", { n: pins.length })}</span>
          </button>
          {pinnedOpen ? (
            <ul className="board-list">
              {pins.map((pin) => (
                <li key={pin.id} className="board-item">
                  <span className="board-text">{pin.text}</span>
                  <button
                    type="button"
                    className="iconbtn tiny"
                    title={t("board.unpin")}
                    onClick={() => remove(pin.id)}
                  >
                    <IconClose size={12} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {noteOpen || note ? (
        <div className="board-note">
          <textarea
            className="board-note-input"
            placeholder={t("board.notePlaceholder")}
            value={note}
            onChange={(event) => {
              setNote(event.target.value)
              writeNote(sessionId, event.target.value)
            }}
          />
          {!note ? (
            <button
              type="button"
              className="linkbtn"
              onClick={() => setNoteOpen(false)}
            >
              {t("board.close")}
            </button>
          ) : null}
        </div>
      ) : (
        <button type="button" className="board-add" onClick={() => setNoteOpen(true)}>
          {t("board.addNote")}
        </button>
      )}
    </div>
  )
}

/** Pin button for one message; renders nothing when the turn has no body. */
export function PinButton({ text, onPin }: { text: string; onPin(text: string): void }) {
  const t = useT()
  if (!text.trim()) return null
  return (
    <button
      type="button"
      className="iconbtn"
      title={t("board.pin")}
      style={{ width: 24, height: 24 }}
      onClick={() => onPin(text)}
    >
      <IconPin size={13} />
    </button>
  )
}

/** Headline used in the pinned list, so a long answer is still identifiable. */
export function pinTitle(text: string): string {
  const firstLine = text.split("\n").find((line) => line.trim()) ?? ""
  return truncate(firstLine.replace(/^[#>*\-\s]+/, ""), 90)
}

