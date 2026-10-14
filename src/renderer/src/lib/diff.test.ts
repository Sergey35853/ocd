import { describe, expect, it } from "vitest"
import type { MessageContent, MessageInfo } from "@shared/types"
import {
  callKey,
  changeTotals,
  diffLines,
  diffStats,
  parsePatch,
  patchDocument,
  sessionChanges,
  stepsOf,
  toPatch,
  toolName,
} from "./diff"

/** A tool block shaped the way the server reports an `edit` call. */
function edit(input: Record<string, unknown>, status = "completed"): MessageContent {
  return { type: "tool", tool: "edit", callID: `c${Math.random()}`, state: { status, input } }
}

function turn(content: MessageContent[], created: number): MessageInfo {
  return { id: `m${created}`, type: "assistant", time: { created }, content }
}

describe("diffLines", () => {
  it("reports a single changed line", () => {
    const lines = diffLines("one\ntwo\nthree", "one\ntwo and a half\nthree")
    expect(lines.filter((line) => line.kind === "del").map((line) => line.text)).toEqual([
      "two",
    ])
    expect(lines.filter((line) => line.kind === "add").map((line) => line.text)).toEqual([
      "two and a half",
    ])
    expect(diffStats(lines)).toEqual({ added: 1, removed: 1 })
  })

  it("numbers the unchanged lines so both sides line up", () => {
    const lines = diffLines("a\nb\nc", "a\nB\nc")
    const removed = lines.find((line) => line.kind === "del")
    const added = lines.find((line) => line.kind === "add")
    expect(removed?.oldNo).toBe(2)
    expect(removed?.newNo).toBeNull()
    expect(added?.newNo).toBe(2)
    expect(added?.oldNo).toBeNull()
  })

  it("keeps the common prefix and suffix out of the change count", () => {
    const before = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n")
    const after = before.replace("line 100", "line 100 changed")
    const stats = diffStats(diffLines(before, after))
    expect(stats).toEqual({ added: 1, removed: 1 })
  })

  it("treats everything as added for an empty before", () => {
    const stats = diffStats(diffLines("", "a\nb"))
    expect(stats).toEqual({ added: 2, removed: 0 })
  })

  it("treats everything as removed for an empty after", () => {
    expect(diffStats(diffLines("a\nb", ""))).toEqual({ added: 0, removed: 2 })
  })

  it("does not invent a last line for a trailing newline", () => {
    // "a\n" and "a" are the same file, so there is nothing to report.
    expect(diffStats(diffLines("a\n", "a"))).toEqual({ added: 0, removed: 0 })
    expect(diffStats(diffLines("a\n", "a\nb\n"))).toEqual({ added: 1, removed: 0 })
  })

  it("survives a change too large to align exactly", () => {
    const before = Array.from({ length: 4000 }, (_, i) => `a${i}`).join("\n")
    const after = Array.from({ length: 4000 }, (_, i) => `b${i}`).join("\n")
    const stats = diffStats(diffLines(before, after))
    expect(stats.added + stats.removed).toBe(8000)
  })
})

describe("stepsOf", () => {
  it("reads an edit into a diff", () => {
    const [step] = stepsOf(edit({ filePath: "src\\a.ts", oldString: "x", newString: "y" }))
    expect(step.path).toBe("src\\a.ts")
    expect(step.kind).toBe("edit")
    expect(diffStats(step.lines)).toEqual({ added: 1, removed: 1 })
  })

  it("reads a write as a whole-file addition", () => {
    const [step] = stepsOf(edit({ filePath: "a.ts", content: "one\ntwo" }))
    expect(step.kind).toBe("write")
    expect(diffStats(step.lines)).toEqual({ added: 2, removed: 0 })
  })

  it("reads several replacements out of one multi-edit call", () => {
    const [step, second] = stepsOf(
      edit({
        filePath: "a.ts",
        edits: [
          { oldString: "one", newString: "1" },
          { oldString: "two", newString: "2" },
        ],
      }),
    )
    expect(step.lines).toHaveLength(2)
    expect(second.path).toBe("a.ts")
  })

  it("takes the file name from the patch when the call has none", () => {
    const [step] = stepsOf(edit({ patch: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-x\n+y\n" }))
    expect(step.path).toBe("src/a.ts")
    expect(step.kind).toBe("patch")
    expect(diffStats(step.lines)).toEqual({ added: 1, removed: 1 })
  })

  it("ignores a call that failed", () => {
    expect(stepsOf(edit({ filePath: "a.ts", oldString: "x", newString: "y" }, "error"))).toEqual([])
  })

  it("ignores calls that only read", () => {
    expect(stepsOf(edit({ filePath: "a.ts" }))).toEqual([])
  })
})

describe("server patches", () => {
  /** A call as the server writes it: name/id, and the diff it computed. */
  const reported = (
    files: Array<{ file: string; patch: string; status?: string; additions?: number }>,
  ): MessageContent => ({
    type: "tool",
    name: "edit",
    id: "call_1",
    state: { status: "completed", input: { path: files[0]?.file }, metadata: { files } },
  })

  it("takes the patch the server computed, not the one rebuilt here", () => {
    const patch =
      "Index: C:/a/b.ts\n" +
      "=========\n" +
      "--- C:/a/b.ts\n" +
      "+++ C:/a/b.ts\n" +
      "@@ -1,3 +1,3 @@\n" +
      " one\n" +
      "-two\n" +
      "+TWO\n" +
      " three\n"
    const [step] = stepsOf(reported([{ file: "C:/a/b.ts", patch, status: "modified" }]))
    expect(step.kind).toBe("patch")
    expect(step.patch).toBe(patch)
    expect(step.status).toBe("modified")
    // The `Index:` header and the rule of `=` are not diff lines.
    expect(step.lines.map((line) => line.kind)).toEqual(["meta", "ctx", "del", "add", "ctx"])
  })

  it("counts the server's own additions and deletions", () => {
    const patch = "--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,2 @@\n-one\n+1\n two\n"
    const [change] = sessionChanges([turn([reported([{ file: "a.ts", patch }])], 1)])
    expect(change.authoritative).toBe(true)
    expect(change.stats).toEqual({ added: 1, removed: 1 })
    expect(change.whole).toBe(false)
  })

  it("shows the deletions of a file written whole", () => {
    // What a `write` never reports in its input, and what only the server saw.
    const patch =
      "--- a/new.ts\n+++ b/new.ts\n@@ -1,4 +1,2 @@\n-one\n-two\n-three\n+one line\n+two lines\n"
    const [change] = sessionChanges([turn([reported([{ file: "new.ts", patch }])], 1)])
    expect(change.whole).toBe(false)
    expect(change.stats).toEqual({ added: 2, removed: 3 })
    expect(change.lines.filter((line) => line.kind === "del").map((line) => line.text)).toEqual([
      "one",
      "two",
      "three",
    ])
  })

  it("keeps a whole-file write as-is when the server said nothing", () => {
    const [change] = sessionChanges([turn([edit({ filePath: "new.ts", content: "a\nb" })], 1)])
    expect(change.authoritative).toBe(false)
    expect(change.whole).toBe(true)
    expect(change.stats).toEqual({ added: 2, removed: 0 })
  })

  it("reports several files from one call", () => {
    const block = reported([
      { file: "a.ts", patch: "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n" },
      { file: "b.ts", patch: "--- a/b.ts\n+++ b/b.ts\n@@ -1 +1 @@\n-c\n+d\n" },
    ])
    const changes = sessionChanges([turn([block], 1)])
    expect(changes.map((change) => change.path)).toEqual(["a.ts", "b.ts"])
  })

  it("exports the server patch verbatim", () => {
    const patch = "Index: a.ts\n=========\n--- a.ts\n+++ a.ts\n@@ -1 +1 @@\n-a\n+b\n"
    const [change] = sessionChanges([turn([reported([{ file: "a.ts", patch }])], 1)])
    expect(toPatch(change)).toBe(patch)
  })

  it("lays several calls to one file end to end", () => {
    const first = reported([
      { file: "a.ts", patch: "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n" },
    ])
    const second: MessageContent = {
      ...reported([{ file: "a.ts", patch: "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-b\n+c\n" }]),
      id: "call_2",
    }
    const [change] = sessionChanges([turn([first], 1), turn([second], 2)])
    expect(change.edits).toBe(2)
    expect(change.exact).toBe(true)
    expect(change.stats).toEqual({ added: 2, removed: 2 })
    expect(toPatch(change)).toContain("-b\n+c")
  })

  it("falls back to the input when the server reported no files", () => {
    const block = reported([])
    block.state = { status: "completed", input: { filePath: "a.ts", oldString: "a", newString: "b" } }
    const [step] = stepsOf(block)
    expect(step.kind).toBe("edit")
    expect(diffStats(step.lines)).toEqual({ added: 1, removed: 1 })
  })
})

describe("tool identity", () => {
  it("reads the name and id from either spelling", () => {
    expect(toolName({ type: "tool", name: "edit" })).toBe("edit")
    expect(toolName({ type: "tool", tool: "bash" })).toBe("bash")
    expect(toolName({ type: "tool" })).toBe("")
    expect(callKey({ type: "tool", id: "call_1" })).toBe("call_1")
    expect(callKey({ type: "tool", callID: "call_2" })).toBe("call_2")
    expect(callKey({ type: "tool" })).toBeUndefined()
  })
})

describe("sessionChanges", () => {
  it("merges chained edits into one diff of the file", () => {
    const changes = sessionChanges([
      turn([edit({ filePath: "a.ts", oldString: "a", newString: "b" })], 1),
      turn([edit({ filePath: "a.ts", oldString: "b", newString: "c" })], 2),
    ])
    expect(changes).toHaveLength(1)
    expect(changes[0].edits).toBe(2)
    expect(changes[0].exact).toBe(true)
    // a -> c in one step, not two rounds of a -> b and b -> c.
    expect(diffStats(changes[0].lines)).toEqual({ added: 1, removed: 1 })
  })

  it("keeps edits separate when the chain breaks", () => {
    const changes = sessionChanges([
      turn([edit({ filePath: "a.ts", oldString: "a", newString: "b" })], 1),
      turn([edit({ filePath: "a.ts", oldString: "x", newString: "y" })], 2),
    ])
    expect(changes[0].exact).toBe(false)
    expect(changes[0].edits).toBe(2)
    // The totals still add up: each step reports its own lines.
    expect(diffStats(changes[0].steps.flatMap((step) => step.lines))).toEqual({
      added: 2,
      removed: 2,
    })
  })

  it("treats one file written under two spellings as one file", () => {
    const changes = sessionChanges([
      turn([edit({ filePath: "src\\A.ts", oldString: "a", newString: "b" })], 1),
      turn([edit({ filePath: "SRC\\a.ts", oldString: "b", newString: "c" })], 2),
    ])
    expect(changes).toHaveLength(1)
    expect(changes[0].path).toBe("src\\A.ts")
    expect(changes[0].exact).toBe(true)
  })

  it("marks a written file as whole, with nothing to compare against", () => {
    const changes = sessionChanges([turn([edit({ filePath: "new.ts", content: "a\nb" })], 1)])
    expect(changes[0].whole).toBe(true)
    expect(changes[0].stats).toEqual({ added: 2, removed: 0 })
  })

  it("orders files by the first time they were touched", () => {
    const changes = sessionChanges([
      turn([edit({ filePath: "b.ts", oldString: "a", newString: "b" })], 1),
      turn([edit({ filePath: "a.ts", oldString: "a", newString: "b" })], 2),
    ])
    expect(changes.map((change) => change.path)).toEqual(["b.ts", "a.ts"])
  })

  it("counts files and lines for the header", () => {
    const changes = sessionChanges([
      turn(
        [
          edit({ filePath: "a.ts", oldString: "a\nb", newString: "a\nc" }),
          edit({ filePath: "b.ts", oldString: "a", newString: "b" }),
        ],
        1,
      ),
    ])
    expect(changeTotals(changes)).toEqual({ files: 2, added: 2, removed: 2 })
  })
})

describe("parsePatch", () => {
  it("keeps the hunk headers and drops the file headers", () => {
    const lines = parsePatch(
      "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,3 +1,3 @@\n keep\n-old\n+new\n",
    )
    expect(lines[0].kind).toBe("meta")
    expect(lines.map((line) => line.kind)).toEqual(["meta", "ctx", "del", "add"])
  })
})

describe("toPatch", () => {
  it("writes a header and one hunk around the change", () => {
    const before = ["one", "two", "three"].join("\n")
    const after = ["one", "TWO", "three"].join("\n")
    const [change] = sessionChanges([turn([edit({ filePath: "a.ts", oldString: before, newString: after })], 1)])
    expect(toPatch(change)).toBe(
      "--- a/a.ts\n+++ b/a.ts\n@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n",
    )
  })

  it("keeps only the context around the change", () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n")
    const after = before.replace("line 20", "line twenty")
    const [change] = sessionChanges([turn([edit({ filePath: "a.ts", oldString: before, newString: after })], 1)])
    const patch = toPatch(change)
    expect(patch).toContain("@@ -18,7 +18,7 @@")
    expect(patch).not.toContain("line 0\n")
    expect(patch).not.toContain("line 39")
  })

  it("writes /dev/null for a file that was created", () => {
    const [change] = sessionChanges([turn([edit({ filePath: "new.ts", content: "one\ntwo" })], 1)])
    expect(toPatch(change)).toBe("--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,2 @@\n+one\n+two\n")
  })

  it("exports a broken chain as one block per call", () => {
    const changes = sessionChanges([
      turn([edit({ filePath: "a.ts", oldString: "a", newString: "b" })], 1),
      turn([edit({ filePath: "a.ts", oldString: "x", newString: "y" })], 2),
    ])
    const patch = patchDocument(changes)
    expect(patch.match(/--- a\/a\.ts/g)).toHaveLength(2)
  })
})