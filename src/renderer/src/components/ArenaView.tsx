import { useEffect, useMemo, useState } from "react"
import { useStore } from "../lib/store"
import { useMarkdown } from "../lib/markdown"
import { errorText, textOf } from "../lib/format"
import { useT } from "../i18n"
import { Modal } from "./ui"

/** How many answers may run at once — more than this is a wall, not a comparison. */
const MAX_MODELS = 4

/**
 * The same question asked of several models at once, answers side by side.
 *
 * A benchmark is only useful when the question, the folder and the moment are
 * the same — so one prompt is written, N conversations are opened against the
 * same directory, each pinned to a different model, and the prompt is sent to
 * all of them at once. The server runs them concurrently; this is just the
 * scoreboard.
 *
 * Nothing here reuses `newSession`: that pins the default model and steals the
 * active tab, both wrong for an arena. Sessions are opened straight through the
 * API so the current conversation is never disturbed, and they are kept
 * afterwards — if one answer was good, the thread it came from is worth having.
 */
export function ArenaView({ onClose }: { onClose(): void }) {
  const store = useStore()
  const t = useT()
  const md = useMarkdown()

  const [prompt, setPrompt] = useState("")
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [columns, setColumns] = useState<Column[]>([])
  const [running, setRunning] = useState(false)

  /** What each model ref points at, for labels and for the pinned creation. */
  const byRef = useMemo(() => {
    const map = new Map<string, { providerID: string; id: string; label: string }>()
    for (const model of store.models) {
      const ref = model.ref ?? `${model.providerID ?? ""}/${model.id}`
      map.set(ref, { providerID: model.providerID ?? "", id: model.id, label: model.name || model.id })
    }
    return map
  }, [store.models])

  const refs = useMemo(() => [...byRef.keys()].sort((a, b) => a.localeCompare(b)), [byRef])

  const toggle = (ref: string) => {
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(ref)) next.delete(ref)
      else if (next.size < MAX_MODELS) next.add(ref)
      return next
    })
  }

  const run = async () => {
    const chosen = [...picked]
    if (!prompt.trim() || chosen.length < 2 || running) return
    setRunning(true)
    setColumns([])

    // Open one conversation per model, each pinned to its own model.
    const made: Column[] = []
    for (const ref of chosen) {
      const info = byRef.get(ref)
      if (!info) continue
      try {
        const session = await window.ocd.api.createSession({
          directory: store.directory || undefined,
          title: `${t("arena.title")} — ${info.label}`,
          model: { providerID: info.providerID, id: info.id },
        })
        made.push({
          key: session.id,
          providerID: info.providerID,
          modelID: info.id,
          label: info.label,
          sessionId: session.id,
          state: "queued",
          answer: "",
        })
      } catch (err) {
        made.push({
          key: `x-${ref}`,
          providerID: info.providerID,
          modelID: info.id,
          label: info.label,
          sessionId: "",
          state: "failed",
          answer: "",
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    setColumns(made)

    // Send the one prompt to every conversation that opened. A session does not
    // need to be the active tab: busy, live text and the SSE stream are all
    // keyed by id, so these run side by side in the background.
    let anyRunning = false
    for (const col of made) {
      if (!col.sessionId) continue
      const ok = await store.send(col.sessionId, prompt)
      if (ok) anyRunning = true
      setColumns((current) =>
        current.map((item) =>
          item.key === col.key
            ? { ...item, state: ok ? "running" : "failed", error: ok ? undefined : t("arena.sendFailed") }
            : item,
        ),
      )
    }
    if (!anyRunning) setRunning(false)
  }

  // A column is finished the moment its own busy flag drops to false; each is
  // then read back from the transcript, which is where the persisted answer is.
  useEffect(() => {
    if (!running) return
    const finishing = columns.filter((col) => col.state === "running" && store.busy[col.sessionId] === false)
    if (!finishing.length) {
      // Stop only once there is a board and nothing left in flight on it. An
      // empty board is the reset between two runs, not a finished one — treating
      // it as finished would drop the flag before the first turn ever started.
      if (columns.length > 0 && !columns.some((col) => col.state === "running" || col.state === "queued")) {
        setRunning(false)
      }
      return
    }
    let alive = true
    void (async () => {
      for (const col of finishing) {
        const result = await finalize(col.sessionId)
        if (!alive) return
        setColumns((current) =>
          current.map((item) =>
            item.key === col.key
              ? { ...item, state: result.ok ? "done" : "failed", answer: result.answer, error: result.error }
              : item,
          ),
        )
      }
    })()
    return () => {
      alive = false
    }
  }, [store.busy, columns, running])

  const canRun = prompt.trim().length > 0 && picked.size >= 2 && !running

  return (
    <Modal
      title={t("arena.title")}
      onClose={onClose}
      actions={
        <button type="button" className="btn primary" disabled={!canRun} onClick={() => void run()}>
          {running ? t("arena.running") : t("arena.run")}
        </button>
      }
    >
      <p className="about-hint">{t("arena.hint")}</p>

      <textarea
        className="input arena-prompt"
        rows={3}
        placeholder={t("arena.placeholder")}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
      />

      <div className="arena-picker">
        {refs.map((ref) => {
          const info = byRef.get(ref)
          const on = picked.has(ref)
          return (
            <button
              key={ref}
              type="button"
              className={`arena-chip${on ? " on" : ""}`}
              title={ref}
              onClick={() => toggle(ref)}
            >
              {info?.label ?? ref}
            </button>
          )
        })}
      </div>
      <p className="about-hint">{t("arena.pick", { n: MAX_MODELS })}</p>

      {columns.length ? (
        <div className="arena-grid">
          {columns.map((col) => {
            const live = col.state === "running" ? (store.live[col.sessionId]?.text ?? "") : ""
            const body = col.state === "running" ? live : col.answer
            return (
              <div className="arena-col" key={col.key}>
                <div className="arena-col-head">
                  <span className="arena-name">{col.label}</span>
                  <span className={`arena-badge ${col.state}`}>
                    {col.state === "running"
                      ? t("arena.stateRunning")
                      : col.state === "queued"
                        ? t("arena.stateQueued")
                        : col.state === "done"
                          ? t("arena.stateDone")
                          : t("arena.stateFailed")}
                  </span>
                </div>
                {col.state === "failed" ? (
                  <p className="arena-error">{col.error || t("arena.empty")}</p>
                ) : body ? (
                  <div className="md" dangerouslySetInnerHTML={{ __html: md.render(body) }} />
                ) : (
                  <p className="about-hint">{t("arena.waiting")}</p>
                )}
              </div>
            )
          })}
        </div>
      ) : null}
    </Modal>
  )
}

type ColumnState = "queued" | "running" | "done" | "failed"

interface Column {
  key: string
  providerID: string
  modelID: string
  label: string
  /** Empty when the conversation could not be opened at all. */
  sessionId: string
  state: ColumnState
  answer: string
  error?: string
}

/**
 * Read one conversation's final answer back from the transcript.
 *
 * A failing turn is still an answer worth showing: the exit-style error text
 * says what happened, which is more useful than a blank column. Only "nothing
 * came back at all" counts as empty.
 */
async function finalize(sessionId: string): Promise<{ ok: boolean; answer: string; error: string }> {
  try {
    const messages = await window.ocd.api.sessionMessages(sessionId)
    const last = [...messages].reverse().find((message) => message.type === "assistant")
    if (last?.error) return { ok: false, answer: "", error: errorText(last.error) }
    const answer = last ? textOf(last.content) : ""
    if (!answer) return { ok: false, answer: "", error: "" }
    return { ok: true, answer, error: "" }
  } catch (err) {
    return { ok: false, answer: "", error: err instanceof Error ? err.message : String(err) }
  }
}
