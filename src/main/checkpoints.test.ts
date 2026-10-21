import { describe, expect, it, vi, beforeEach } from "vitest"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * The snapshots of the changed files.
 *
 * The way back from a change the agent made wrongly is the copy that was made
 * before it. So the snapshot has to hold the file as it was — and the restore
 * has to put it back, byte for byte, through the same server that read it.
 */
const home = mkdtempSync(join(tmpdir(), "ocd-cp-"))

vi.mock("electron", () => ({
  app: { getPath: () => home },
}))

const written: Array<{ path: string; body: string }> = []

vi.mock("./service", () => ({
  service: {
    get: async (path: string) => {
      if (path === "/api/vcs/diff") {
        return { data: [{ file: "src/app.ts" }, { file: "README.md" }] }
      }
      if (path === "/api/vcs/branch") return { data: { current: "main" } }
      if (path.startsWith("/api/fs/read/")) {
        if (path.includes("README")) return "прочитать меня"
        return "исходный код"
      }
      return {}
    },
    post: async (path: string, body: unknown) => {
      written.push({ path, body: String(body) })
      return {}
    },
  },
}))

vi.mock("./log", () => ({ log: { warn: () => undefined, info: () => undefined, error: () => undefined } }))

const { deleteCheckpoint, listCheckpoints, restoreCheckpoint, saveCheckpoint } = await import(
  "./checkpoints"
)

beforeEach(() => {
  written.length = 0
  // The snapshots live in one folder, and one test must not see what another
  // left there.
  rmSync(join(home, "checkpoints"), { recursive: true, force: true })
})

describe("the checkpoints", () => {
  it("holds a copy of every changed file", async () => {
    const made = await saveCheckpoint("C:/proj")
    expect(made.files.map((file) => file.path)).toEqual(["src/app.ts", "README.md"])
    expect(made.branch).toBe("main")
    // The copy is on this machine, and it is the file as it was.
    const copy = readFileSync(
      join(home, "checkpoints", made.id, "files", "src", "app.ts"),
      "utf8",
    )
    expect(copy).toBe("исходный код")
  })

  it("lists the snapshots it holds, newest first", async () => {
    await saveCheckpoint("C:/proj")
    await saveCheckpoint("C:/proj")
    const list = listCheckpoints()
    expect(list).toHaveLength(2)
    expect(list[0].at).toBeGreaterThanOrEqual(list[1].at)
  })

  it("puts the files back through the server", async () => {
    const made = await saveCheckpoint("C:/proj")
    const result = await restoreCheckpoint(made.id)
    expect(result.restored).toBe(2)
    expect(written).toHaveLength(2)
    expect(written[0].body).toBe("исходный код")
    // The path goes in the query, and the body is the file as it was.
    expect(written[0].path).toContain("path=src%2Fapp.ts")
  })

  it("forgets a snapshot together with its copies", async () => {
    const made = await saveCheckpoint("C:/proj")
    expect(deleteCheckpoint(made.id)).toBe(true)
    expect(listCheckpoints()).toHaveLength(0)
  })

  it("says so when the snapshot is not there", async () => {
    await expect(restoreCheckpoint("cp-nothing")).rejects.toThrow()
  })
})
