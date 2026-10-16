import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OpenCodeService } from "./service"

/**
 * The server moves, and the window has to move with it.
 *
 * `opencode serve` writes a fresh registration on every restart and takes a
 * fresh port with it. Before this, the remembered address was probed again and
 * again — so a restarted server left OCD talking to a dead port for the rest of
 * the session, with `status()` still reporting `connected` and every request
 * failing. On screen that read as deleted history: the session list came back
 * empty, nothing said why.
 *
 * The test stands a server up, points a registration at it, then replaces it
 * with one on another port and asks for the session list again — the exact
 * sequence that emptied the sidebar.
 */

interface FakeServer {
  url: string
  stop: () => Promise<void>
}

function standUp(): Promise<FakeServer> {
  const server: Server = createServer((req, res) => {
    const send = (body: unknown) => {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify(body))
    }
    if (req.url?.startsWith("/api/info")) return send({ version: "9.9.9" })
    if (req.url?.startsWith("/api/session")) return send({ data: [{ id: "ses_one" }] })
    res.writeHead(404)
    res.end()
  })
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${port}`,
        stop: async () => {
          server.closeAllConnections()
          await new Promise<void>((done) => server.close(() => done()))
        },
      })
    })
  })
}

describe("OpenCodeService", () => {
  let stateHome: string
  let saved: string | undefined
  const running: FakeServer[] = []

  const register = (url: string, password: string) => {
    const dir = join(stateHome, "opencode")
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, "service.json"),
      JSON.stringify({ id: "reg", version: "9.9.9", url, pid: 1, password }),
    )
  }

  beforeEach(() => {
    stateHome = mkdtempSync(join(tmpdir(), "ocd-service-"))
    saved = process.env.XDG_STATE_HOME
    process.env.XDG_STATE_HOME = stateHome
  })

  afterEach(async () => {
    if (saved === undefined) delete process.env.XDG_STATE_HOME
    else process.env.XDG_STATE_HOME = saved
    await Promise.all(running.splice(0).map((server) => server.stop()))
    rmSync(stateHome, { recursive: true, force: true })
  })

  it("follows the server onto the port it restarted on", async () => {
    const first = await standUp()
    running.push(first)
    register(first.url, "first-password")

    const service = new OpenCodeService()
    expect((await service.connect()).connected).toBe(true)
    expect(service.status().url).toBe(first.url)

    await first.stop()
    running.pop()

    const second = await standUp()
    running.push(second)
    register(second.url, "second-password")

    const sessions = await service.get<Array<{ id: string }>>("/api/session")
    expect(sessions).toEqual([{ id: "ses_one" }])
    expect(service.status().url).toBe(second.url)
  })

  it("reports the failure instead of pretending the session list is empty", async () => {
    const first = await standUp()
    running.push(first)
    register(first.url, "first-password")

    const service = new OpenCodeService()
    await service.connect()
    await first.stop()
    running.pop()

    // Nothing re-registers: the address is right, the server is simply gone.
    await expect(service.get("/api/session")).rejects.toThrow()
  })
})