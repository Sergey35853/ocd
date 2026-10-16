import { app } from "electron"
import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { release as osRelease, type as osType } from "node:os"
import type { FeedbackKind } from "@shared/types"
import { log } from "./log"

/**
 * Two things leave the machine, and both of them are opt-in by the person who
 * shipped this build.
 *
 * The first is a mark saying "this version is installed here" — once per
 * version, not once per launch. The second is what someone typed into the
 * feedback card in About. Everything else about the machine stays where it is:
 * no paths, no file names, no user name, no window titles, no conversations.
 * The install event carries a version, an OS and a random id, and the id is
 * what makes a reinstall of the same machine look like one machine rather than
 * several.
 *
 * GitHub Releases could not answer the first question: its counters count the
 * requests the updater makes on its own, so they mostly measured the author
 * testing his own build.
 */

/**
 * Where both go: a Google Apps Script web app that appends to a Sheet.
 *
 * The exact URL comes from deploying `scripts/feedback-endpoint/Code.gs` — see
 * the README next to it. Empty means the app is built without a backend: the
 * install mark is skipped silently and the feedback card says so instead of
 * pretending to send something.
 */
export const BACKEND_URL = ""

/** Enough for a slow phone connection to finish, short enough not to hang the UI. */
const REQUEST_TIMEOUT_MS = 10_000

/** What one sheet row can hold comfortably. */
const MAX_MESSAGE = 4000
const MAX_CONTACT = 200
const MAX_LOG = 20_000

/** How many version marks to remember; an install that updates for years is still one file. */
const MAX_REPORTED = 50

export type { FeedbackKind }

const KINDS: readonly FeedbackKind[] = ["wish", "complaint", "problem", "other"]

export interface FeedbackInput {
  kind: FeedbackKind
  message: string
  /** Where to answer, if the sender wants to be answered. Never required. */
  contact?: string
  /** Attach the version and OS. Off means the text arrives on its own. */
  tech?: boolean
  /** The app's own log, only ever sent together with `tech`. */
  log?: string
}

/** What this machine says about itself, gathered once per event. */
export interface Facts {
  installId: string
  version: string
  os: string
  arch: string
  electron: string
  locale: string
}

type Payload = Record<string, unknown>

/**
 * Whether this version still has to be reported.
 *
 * One report per version is the whole rule, and it is why the counter is worth
 * reading: a machine that updates from 0.1.1 to 0.1.13 is one install that grew,
 * not thirteen installs. An id that has not been seen is a new machine.
 */
export function shouldReport(reported: readonly string[], version: string): boolean {
  return !reported.includes(version)
}

/**
 * Text as it will be stored.
 *
 * Trimmed so a field left with a stray space reads as filled, and capped so one
 * pasted file cannot fill a sheet column: truncation is silent on purpose,
 * because the alternative — a rejected send — loses the whole message.
 */
export function normalizeText(text: string | undefined, limit: number): string {
  return (text ?? "").trim().slice(0, limit)
}

/** The install mark: what is running, and where, and nothing else. */
export function installEvent(facts: Facts, at: Date): Payload {
  return {
    app: "OCD",
    event: "install",
    at: at.toISOString(),
    ...facts,
  }
}

/** What someone wrote, plus the build it was written about. */
export function feedbackEvent(facts: Facts, input: FeedbackInput, at: Date): Payload {
  const kind = KINDS.includes(input.kind) ? input.kind : "other"
  const event: Payload = {
    app: "OCD",
    event: "feedback",
    at: at.toISOString(),
    kind,
    message: normalizeText(input.message, MAX_MESSAGE),
    ...facts,
  }
  const contact = normalizeText(input.contact, MAX_CONTACT)
  if (contact) event.contact = contact
  // The log holds paths, the model name and window titles. It goes only when
  // the sender ticked the box, and never without it.
  if (input.tech) {
    const attached = normalizeText(input.log, MAX_LOG)
    if (attached) event.log = attached
  }
  return event
}

interface LocalState {
  installId: string
  /** Versions already marked; see shouldReport. */
  reported: string[]
}

function stateFile(): string {
  return join(app.getPath("userData"), "ocd-feedback.json")
}

/**
 * The local half of the counter.
 *
 * A machine's id is minted here and written straight away, rather than left to
 * whatever the next write happens to be: minted lazily, two events belonging to
 * one machine would carry two different ids and it would be counted twice -
 * which is the one number this exists to get right.
 *
 * An unreadable file is not worth a dialog: it costs one extra mark for the
 * version that is running, and nothing else.
 */
function readState(): LocalState {
  let parsed: Partial<LocalState> | null = null
  try {
    parsed = JSON.parse(readFileSync(stateFile(), "utf8")) as Partial<LocalState>
  } catch {
    parsed = null
  }
  if (typeof parsed?.installId !== "string" || !Array.isArray(parsed.reported)) {
    const fresh: LocalState = { installId: randomUUID(), reported: [] }
    writeState(fresh)
    return fresh
  }
  return {
    installId: parsed.installId,
    reported: parsed.reported.filter((item): item is string => typeof item === "string"),
  }
}

function writeState(state: LocalState): void {
  const file = stateFile()
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(state, null, 2), "utf8")
  } catch (err) {
    log.warn(`could not write the feedback state: ${String(err)}`)
  }
}

function facts(state: LocalState): Facts {
  return {
    installId: state.installId,
    version: app.getVersion(),
    os: `${osType()} ${osRelease()}`,
    arch: process.arch,
    electron: process.versions.electron,
    locale: app.getLocale(),
  }
}

/**
 * POST one event.
 *
 * A non-2xx is a failure rather than a silent success, and the body is not read:
 * the endpoint answers `ok`, and a row that was not written is better reported
 * as an error than shown to someone as delivered.
 */
async function post(payload: Payload): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(BACKEND_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Mark this version as installed, once.
 *
 * Called on every launch and silent about almost all of them. The reasons it
 * does nothing are normal rather than errors: no backend in this build, a dev
 * run, and the version already reported — the third being the case that keeps
 * this from becoming a launch counter.
 */
export async function reportInstall(): Promise<void> {
  if (!BACKEND_URL) return
  if (!app.isPackaged) return

  const state = readState()
  if (!shouldReport(state.reported, app.getVersion())) return

  try {
    await post(installEvent(facts(state), new Date()))
  } catch (err) {
    // No dialog, no retry: the next launch is the retry, and a user who cannot
    // reach the backend has not been broken by anything.
    log.warn(`install mark not sent: ${err instanceof Error ? err.message : String(err)}`)
    return
  }

  state.reported = [...state.reported, app.getVersion()].slice(-MAX_REPORTED)
  writeState(state)
  log.info(`install marked: ${app.getVersion()}`)
}

/** Whether this build can send anything at all; the About card asks once. */
export function backendConfigured(): boolean {
  return BACKEND_URL !== ""
}

/**
 * Send what someone wrote.
 *
 * Rejects with a sentence meant to be shown, because the two ways it can fail
 * need different advice: no backend means the build is the problem, a refused
 * request means the network is.
 */
export async function sendFeedback(input: FeedbackInput): Promise<void> {
  if (!backendConfigured()) {
    throw new Error("В этой сборке отправка отзывов не настроена")
  }

  const message = normalizeText(input.message, MAX_MESSAGE)
  if (!message) throw new Error("Сообщение пустое")

  const state = readState()
  try {
    await post(feedbackEvent(facts(state), { ...input, message }, new Date()))
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    log.warn(`feedback not sent: ${reason}`)
    throw new Error(`Отзыв не отправлен: ${reason}`)
  }
  log.info(`feedback sent: ${input.kind}, ${message.length} chars, version ${app.getVersion()}`)
}