import { EventEmitter } from "node:events"
import type { BrowserWindow } from "electron"
import { watch, type FSWatcher } from "node:fs"

/** What a change in a watched folder reports. */
export interface FsChange {
  /** The folder that was watched. */
  directory: string
  /** A few of the paths that moved, for the message the user reads. */
  files: string[]
}

/**
 * One project folder, watched for the moment it changes.
 *
 * The point of watch-mode is to notice that the code moved — the agent finished
 * and someone is editing in another window, or a build wrote its output — and
 * let the app react. Node's own `fs.watch` (recursive, native on Windows) is
 * enough; there is no need for a watching library.
 *
 * A single folder at a time is a deliberate limit: the app has one "current"
 * project in focus, and two watchers would only double the events without a
 * second place to put them. Starting a watch replaces the previous one.
 *
 * Bursts are coalesced. A single save can touch a dozen files, and a build can
 * touch hundreds; the caller wants one "the project changed" answer a moment
 * after things settle, not a stream of them. Build output and dependencies are
 * ignored outright — watching `node_modules` would fire on every install.
 */
export const fsWatchEvents = new EventEmitter()

let watcher: FSWatcher | null = null
let watching: string | null = null
let pending: string[] = []
let timer: NodeJS.Timeout | null = null

/** Folders whose churn is never "the project changed". */
const IGNORE = /(^|[\\/])(node_modules|\.git|dist|build|out|\.next|coverage|\.ocd)([\\/]|$)/

/** Quiet time before a burst is reported as one change. */
const FLUSH_MS = 1200

/** Most paths remembered for one report — enough to say what moved. */
const FILE_CAP = 50

function flush(): void {
  timer = null
  const directory = watching
  if (!directory || !pending.length) {
    pending = []
    return
  }
  const files = pending.slice(0, FILE_CAP)
  pending = []
  fsWatchEvents.emit("changed", { directory, files } satisfies FsChange)
}

/**
 * Start watching a folder. Replaces any previous watch.
 *
 * Returns whether it actually attached: a folder that no longer exists (or that
 * `fs.watch` refuses) reports `watching: false` so the caller can say so rather
 * than believe it is watching when it is not.
 */
export function startWatch(directory: string): { watching: boolean } {
  if (watching === directory && watcher) return { watching: true }
  stopWatch()
  try {
    watcher = watch(directory, { recursive: true }, (_event, filename) => {
      const name = filename ? filename.toString() : ""
      if (name && IGNORE.test(name)) return
      if (name) {
        if (!pending.includes(name)) pending.push(name)
      } else if (!pending.includes("")) {
        // Some platforms report no name at all; a change still happened.
        pending.push("")
      }
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, FLUSH_MS)
    })
  } catch {
    watcher = null
    watching = null
    return { watching: false }
  }
  watching = directory
  return { watching: true }
}

/** Stop watching. Safe to call when nothing is watched. */
export function stopWatch(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  pending = []
  if (watcher) {
    try {
      watcher.close()
    } catch {
      /* already closed */
    }
  }
  watcher = null
  watching = null
}

/** The folder being watched, or null when idle. */
export function watchedDirectory(): string | null {
  return watching
}

/**
 * Forward folder changes to every open window.
 *
 * The renderer listens on the same `ocd:event` channel the server's own events
 * arrive on, so a change reaches the store's switch as a normal event of type
 * `ocd.fsChanged` — no second subscription path to keep in step.
 */
export function broadcastFsEvents(getWindows: () => BrowserWindow[]): () => void {
  const onChange = (change: FsChange) => {
    for (const win of getWindows()) {
      if (!win.isDestroyed()) win.webContents.send("ocd:event", { type: "ocd.fsChanged", data: change })
    }
  }
  fsWatchEvents.on("changed", onChange)
  return () => {
    fsWatchEvents.off("changed", onChange)
  }
}
