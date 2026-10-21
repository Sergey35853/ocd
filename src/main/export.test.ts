import { describe, expect, it, vi } from "vitest"

// The module asks electron for a save dialog; the test asks it for nothing.
vi.mock("electron", () => ({
  BrowserWindow: class {},
  dialog: { showSaveDialog: async () => ({ canceled: true, filePath: "" }) },
}))

import { jsonlDocument, type ExportPayload } from "./export"

/**
 * The conversation as JSONL.
 *
 * The format is a promise about the shape of the file: one JSON object per
 * line, and nothing else in it. A reader that was promised JSONL reads it
 * line by line, so a title above the first record — or a blank line between
 * the records — is not JSONL, and the promise is broken in a way that only
 * shows up in someone else's tool.
 */
function payload(records: ExportPayload["records"]): ExportPayload {
  return {
    sessionId: "ses_1",
    title: "Разговор",
    markdown: "",
    format: "jsonl",
    messages: records?.length ?? 0,
    records,
  }
}

describe("the JSONL export", () => {
  it("writes one object per line", () => {
    const text = jsonlDocument(
      payload([
        { role: "user", content: "привет" },
        { role: "assistant", content: "здравствуй" },
      ]),
    )
    const lines = text.trim().split("\n")
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0])).toEqual({ role: "user", content: "привет" })
    expect(JSON.parse(lines[1])).toEqual({ role: "assistant", content: "здравствуй" })
  })

  it("keeps the tool's name on its line", () => {
    const text = jsonlDocument(
      payload([{ role: "tool", name: "bash", content: "completed" }]),
    )
    expect(JSON.parse(text.trim())).toEqual({ role: "tool", content: "completed", name: "bash" })
  })

  it("survives a text with a quote and a newline in it", () => {
    const text = jsonlDocument(payload([{ role: "user", content: 'он сказал "нет"\nи ушёл' }]))
    // The line is one line: the newline inside the message is escaped, not
    // printed.
    expect(text.trim().split("\n")).toHaveLength(1)
    expect(JSON.parse(text.trim()).content).toBe('он сказал "нет"\nи ушёл')
  })

  it("writes nothing for an empty conversation", () => {
    expect(jsonlDocument(payload([]))).toBe("")
  })
})
