// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest"
import { applyLocalData, backupJson, collectLocalData } from "../lib/localBackup"

/**
 * Carrying local artifacts between machines.
 *
 * The file has to hold what a person wrote and nothing that only means
 * something here: a backup that swept up the open tabs would resurrect them
 * against conversations that do not exist on the new machine. And a file that
 * is not one of ours must be refused outright rather than half-applied.
 */
beforeEach(() => {
  localStorage.clear()
})

describe("the local-data backup", () => {
  it("carries what a person wrote and leaves machine-local state behind", () => {
    localStorage.setItem("ocd.tags.v1", JSON.stringify({ ses_1: ["важно"] }))
    localStorage.setItem("ocd.pins.v1:", JSON.stringify({ ses_1: [{ id: "p", text: "пин", at: 1 }] }))
    localStorage.setItem("ocd.templates.v1", JSON.stringify([{ id: "t", name: "T", text: "x" }]))
    localStorage.setItem("ocd.tabs.v1", JSON.stringify({ tabs: ["ses_1"], active: "ses_1" }))
    localStorage.setItem("ocd.view.v1", "chat")

    const items = collectLocalData()
    expect(items["ocd.tags.v1"]).toBeTruthy()
    expect(items["ocd.pins.v1:"]).toBeTruthy()
    expect(items["ocd.templates.v1"]).toBeTruthy()
    // Open tabs and the current view describe this machine, not the data.
    expect(items["ocd.tabs.v1"]).toBeUndefined()
    expect(items["ocd.view.v1"]).toBeUndefined()
  })

  it("round-trips through the file", () => {
    localStorage.setItem("ocd.note.v1:ses_1", "важная заметка")
    const file = backupJson(123)
    const parsed = JSON.parse(file) as { version: number; savedAt: number; items: unknown }
    expect(parsed.version).toBe(1)
    expect(parsed.savedAt).toBe(123)

    localStorage.clear()
    expect(collectLocalData()["ocd.note.v1:ses_1"]).toBeUndefined()

    expect(applyLocalData(parsed)).toBe(1)
    expect(localStorage.getItem("ocd.note.v1:ses_1")).toBe("важная заметка")
  })

  it("refuses anything that is not one of its own backups", () => {
    expect(applyLocalData(null)).toBe(0)
    expect(applyLocalData({})).toBe(0)
    expect(applyLocalData({ items: "nope" })).toBe(0)
    expect(applyLocalData({ items: [] })).toBe(0)
    // Even inside a well-shaped file, only the keys the app owns are written.
    expect(applyLocalData({ items: { "random.key": "v", "ocd.tags.v1": "{}" } })).toBe(1)
    expect(localStorage.getItem("random.key")).toBeNull()
    expect(localStorage.getItem("ocd.tags.v1")).toBe("{}")
  })
})
