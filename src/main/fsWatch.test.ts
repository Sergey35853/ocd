import { describe, expect, it, vi } from "vitest"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fsWatchEvents, startWatch, stopWatch, watchedDirectory } from "./fsWatch"

/**
 * The watcher behind watch-mode.
 *
 * These drive real `fs.watch` on a real temp folder — the same call the app
 * makes — because the two things worth trusting are that a change is reported
 * (once, after things settle) and that the folders nobody means ("node_modules")
 * are not. A watch that never fires looks exactly like one that works, until
 * the moment the user is relying on it.
 */
async function untilTrue(check: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms
  while (!check() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

let n = 0
function tempDir(): string {
  return join(tmpdir(), `ocd-fswatch-${Date.now()}-${n++}`)
}

describe("fsWatch", () => {
  it("remembers the folder it is watching, and forgets it on stop", () => {
    const dir = tempDir()
    mkdirSync(dir, { recursive: true })
    try {
      expect(startWatch(dir).watching).toBe(true)
      expect(watchedDirectory()).toBe(dir)
      stopWatch()
      expect(watchedDirectory()).toBeNull()
    } finally {
      stopWatch()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("reports it could not attach to a folder that is not there", () => {
    const dir = join(tempDir(), "missing-child")
    try {
      expect(startWatch(dir).watching).toBe(false)
      expect(watchedDirectory()).toBeNull()
    } finally {
      stopWatch()
    }
  })

  it("reports a change once, after the burst settles", async () => {
    const dir = tempDir()
    mkdirSync(dir, { recursive: true })
    const spy = vi.fn()
    fsWatchEvents.on("changed", spy)
    try {
      expect(startWatch(dir).watching).toBe(true)
      // Two writes in a row: one save, two events on disk, one report.
      writeFileSync(join(dir, "a.ts"), "export const a = 1\n")
      writeFileSync(join(dir, "b.ts"), "export const b = 2\n")

      await untilTrue(() => spy.mock.calls.length > 0, 4000)
      expect(spy).toHaveBeenCalledTimes(1)

      const change = spy.mock.calls[0][0] as { directory: string; files: string[] }
      expect(change.directory).toBe(dir)
      expect(change.files.length).toBeGreaterThan(0)
    } finally {
      fsWatchEvents.off("changed", spy)
      stopWatch()
      rmSync(dir, { recursive: true, force: true })
    }
  }, 10_000)

  it("keeps dependency churn quiet", async () => {
    const dir = tempDir()
    mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true })
    const spy = vi.fn()
    fsWatchEvents.on("changed", spy)
    try {
      expect(startWatch(dir).watching).toBe(true)
      writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "module.exports = {}\n")

      // Long enough for any event to have been flushed, had one been queued.
      await new Promise((resolve) => setTimeout(resolve, 2000))
      expect(spy).not.toHaveBeenCalled()
    } finally {
      fsWatchEvents.off("changed", spy)
      stopWatch()
      rmSync(dir, { recursive: true, force: true })
    }
  }, 10_000)

  it("replaces a previous watch when a new folder is watched", () => {
    const first = tempDir()
    const second = tempDir()
    mkdirSync(first, { recursive: true })
    mkdirSync(second, { recursive: true })
    try {
      startWatch(first)
      startWatch(second)
      expect(watchedDirectory()).toBe(second)
      stopWatch()
      expect(watchedDirectory()).toBeNull()
    } finally {
      stopWatch()
      rmSync(first, { recursive: true, force: true })
      rmSync(second, { recursive: true, force: true })
    }
  })
})
