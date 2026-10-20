import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

/**
 * The folder has to reach the server whole.
 *
 * The server reads the location as a deep object — `location[directory]` — and
 * answers 400 for anything else. The app used to hand the query a plain
 * object, which became the string "[object Object]": every call with a folder
 * set (the models, the providers, the permission list) failed, and the failure
 * was swallowed into an empty list. Nothing looked broken; the lists were
 * simply empty.
 */
const here = dirname(fileURLToPath(import.meta.url))
const ipc = readFileSync(join(here, "ipc.ts"), "utf8")
const service = readFileSync(join(here, "service.ts"), "utf8")

describe("the location is sent the way the server reads it", () => {
  it("names the directory inside the location", () => {
    expect(ipc).toMatch(/"location\[directory\]": directory/)
  })

  it("never sends the location as a bare object", () => {
    // `{ location: directory }` is what turns into "[object Object]".
    expect(ipc).not.toMatch(/\{ location: directory \}/)
  })

  it("keeps an object in the query as JSON rather than as text", () => {
    expect(service).toMatch(/typeof value === "object" \? JSON\.stringify\(value\)/)
  })
})
