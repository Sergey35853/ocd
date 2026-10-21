import { app } from "electron"
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs"
import { dirname, join } from "node:path"

/**
 * The app's own log file.
 *
 * A crash that kills the process leaves nothing useful behind: stderr goes to a
 * console nobody is watching, and Windows only ever names the faulting module.
 * So the things that matter on the way down — an uncaught throw, a renderer
 * that ran out of memory, a request that failed — are written here, where they
 * survive the exit.
 *
 * Plain text, one entry per line, oldest first, at
 * `%APPDATA%/OCD/logs/ocd.log`. The file is capped and rotated, because an
 * unbounded log on a machine that restarts a lot is its own kind of problem.
 */

/** Rotate past this, so a long-lived install cannot fill the disk. */
const MAX_BYTES = 2 * 1024 * 1024
/** Previous files kept: ocd.log, ocd.1.log, ocd.2.log. */
const KEEP = 2

let target: string | null = null
/** Set once writing has failed: a logger that cannot log must not throw. */
let broken = false

function resolve(): string | null {
  try {
    const dir = join(app.getPath("userData"), "logs")
    mkdirSync(dir, { recursive: true })
    return join(dir, "ocd.log")
  } catch {
    // Not fatal and not permanent: before `ready` the path can be unavailable,
    // and giving up here would silence the log precisely when its first entries
    // — a crash during startup — matter most. The next call tries again.
    return null
  }
}

/** Shift ocd.1.log upward one step and make room for a fresh ocd.log. */
function rotate(file: string): void {
  const dir = dirname(file)
  try {
    rmSync(join(dir, `ocd.${KEEP}.log`), { force: true })
    for (let n = KEEP - 1; n >= 1; n--) {
      const from = join(dir, `ocd.${n}.log`)
      if (existsSync(from)) renameSync(from, join(dir, `ocd.${n + 1}.log`))
    }
    renameSync(file, join(dir, "ocd.1.log"))
  } catch {
    /* a log that cannot be rotated is still worth writing */
  }
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/** One entry, flattened onto one line so grep and tail stay honest. */
function format(level: string, message: string, detail?: unknown): string {
  const stamp = new Date().toISOString()
  let text = `[${stamp}] [${level}] ${message}`
  if (detail !== undefined) {
    const body = detail instanceof Error && detail.stack ? detail.stack : stringify(detail)
    text += ` — ${body}`
  }
  return `${text.replace(/\r?\n/g, " ⏎ ")}\n`
}

function emit(level: string, message: string, detail?: unknown): void {
  if (broken) return
  try {
    // Re-resolved until it works once; `resolved` keeps the lookup off the hot
    // path for the rest of the run.
    if (!target) target = resolve()
    if (!target) return
    if (existsSync(target) && statSync(target).size > MAX_BYTES) rotate(target)
    appendFileSync(target, format(level, message, detail), "utf8")
  } catch {
    // A log that cannot be written is not worth crashing the app over; one
    // failed write is enough to stop trying.
    broken = true
  }
}

export const log = {
  info: (message: string, detail?: unknown): void => emit("info", message, detail),
  warn: (message: string, detail?: unknown): void => emit("warn", message, detail),
  error: (message: string, detail?: unknown): void => emit("error", message, detail),
  /** Where the file ended up, once it has been resolved. */
  path: (): string | null => target,
}

/**
 * The tail of the log, newest last.
 *
 * The log is the only place where the app's failures are written down, and
 * until now the only way to read it was to find the file by hand. The app can
 * show it instead: the user asked for a problem, and the answer is here.
 */
export function readLogTail(lines = 400): string[] {
  const file = target
  if (!file) return []
  try {
    if (!existsSync(file)) return []
    // The file is capped at two megabytes; reading the whole of it is cheap,
    // and only the tail is kept.
    const text = readFileSync(file, "utf8")
    const all = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
    return all.slice(-Math.max(1, lines))
  } catch {
    return []
  }
}

/** The folder the log lives in, for the "open the folder" button. */
export function logFolder(): string | null {
  const file = target
  if (!file) return null
  return dirname(file)
}

/**
 * Write the header line, so a log opened cold says what build wrote it and
 * where to send it.
 */
export function initLog(): void {
  emit("info", `OCD ${app.getVersion()} started — ${process.platform} ${process.arch}, electron ${process.versions.electron}, node ${process.versions.node}`)
  emit("info", `log file: ${target ?? "unavailable"}`)
}
