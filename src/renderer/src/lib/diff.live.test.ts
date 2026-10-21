import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { MessageInfo } from "@shared/types"
import { patchDocument, sessionChanges } from "./diff"

/**
 * Checks the parser against a real session from the running service.
 *
 * Skipped unless the service is registered, so it never breaks a normal run;
 * `npm run test:live` runs it against whatever the machine has running.
 */
function service(): { url: string; password: string } | null {
  const path = join(process.env.USERPROFILE ?? "", ".local", "state", "opencode", "service.json")
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return null
  }
}

const svc = service()
const live = Boolean(svc)

async function get<T>(route: string): Promise<T> {
  const auth = "Basic " + Buffer.from(`opencode:${svc?.password}`).toString("base64")
  const res = await fetch(`${svc?.url}${route}`, { headers: { authorization: auth } })
  return (await res.json()) as T
}

describe.skipIf(!live)("live service", () => {
  it("parses the diffs the server actually sends", async () => {
    const sessions = await get<{ data: Array<{ id: string }> }>("/api/session")
    let checked = 0
    // Every change seen, not only the first session's: the sessions are
    // ordered by recency, and whether the newest one carries a server patch
    // or only a local guess is a matter of what the machine happened to be
    // doing. The point of the test is that *some* change came from the server.
    const seen: ReturnType<typeof sessionChanges> = []

    for (const session of sessions.data.slice(0, 25)) {
      const messages = await get<{ data: MessageInfo[] }>(`/api/session/${session.id}/message`)
      const changes = sessionChanges(messages.data)
      if (!changes.length) continue
      checked += 1
      seen.push(...changes)

      for (const change of changes) {
        expect(change.steps.length).toBeGreaterThan(0)
        expect(change.path.length).toBeGreaterThan(0)
        expect(change.stats.added + change.stats.removed).toBeGreaterThan(0)
      }
    }

    expect(checked).toBeGreaterThan(0)
    // At least one change in the whole run came from a server patch: that is
    // the path that has no fallback to hide behind.
    expect(seen.some((change) => change.authoritative)).toBe(true)
    expect(patchDocument(seen)).toContain("@@")
  })
})