import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { existsSync, readFileSync } from "node:fs"
import { networkInterfaces } from "node:os"
import { extname, join, normalize } from "node:path"
import { randomBytes } from "node:crypto"
import { service } from "./service"
import { getSettings, setSettings } from "./settings"
import { log } from "./log"

/**
 * The phone gateway: a small HTTP server that puts the same OpenCode server in
 * front of a phone on the same private network.
 *
 * The phone is not a copy of anything. The OpenCode server already holds the
 * sessions, the messages and the event stream, so a second client reading from
 * it stays in step with the desktop for free — anything that synchronised two
 * copies here would only be a second thing to fall behind.
 *
 * Three decisions shape this file, and all three are about what the gateway
 * will *not* do:
 *
 *  1. It listens on the Tailscale address only. Tailscale hands out addresses
 *     in 100.64.0.0/10; binding there puts the phone on a private network where
 *     nothing is published to the internet, which is the only reason this can
 *     be allowed to exist at all.
 *  2. Every request carries a token generated at startup. Without it, anything
 *     that could reach the machine over that network would be able to ask the
 *     OpenCode server to run tools.
 *  3. Paths are matched against an allowlist. The server behind it can execute
 *     shell commands — `/api/session/{id}/shell` is a real route — so a proxy
 *     that forwarded everything would hand a phone the keys to the machine.
 *     Read and send only, which is what was asked for.
 */

/** Read and send. Nothing here can reach a shell, a file or a config. */
const ALLOWED: Array<{ method: string; pattern: RegExp }> = [
  { method: "GET", pattern: /^\/api\/info$/ },
  { method: "GET", pattern: /^\/api\/session$/ },
  { method: "POST", pattern: /^\/api\/session$/ },
  { method: "GET", pattern: /^\/api\/session\/[A-Za-z0-9_-]+$/ },
  { method: "GET", pattern: /^\/api\/session\/[A-Za-z0-9_-]+\/message$/ },
  { method: "POST", pattern: /^\/api\/session\/[A-Za-z0-9_-]+\/prompt$/ },
  { method: "POST", pattern: /^\/api\/session\/[A-Za-z0-9_-]+\/interrupt$/ },
  { method: "GET", pattern: /^\/api\/session\/[A-Za-z0-9_-]+\/inbox$/ },
  { method: "GET", pattern: /^\/api\/model$/ },
]

function allowed(method: string, path: string): boolean {
  return ALLOWED.some((route) => route.method === method && route.pattern.test(path))
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
}

/**
 * The Tailscale address of this machine.
 *
 * Identified by the range rather than by the adapter's name: the adapter has
 * been called "Tailscale", "Tailscale Tunnel" and "Tailscale WireGuard" across
 * versions, but 100.64.0.0/10 is CGNAT space that Tailscale always uses and
 * nothing else on a normal network does.
 */
function tailscaleAddress(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const entry of addresses ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue
      const [a, b] = entry.address.split(".").map(Number)
      if (a === 100 && b >= 64 && b <= 127) return entry.address
    }
  }
  return null
}

export interface MobileGateway {
  /** Full address to type on the phone, token included. */
  url: string
  token: string
  stop(): void
}

let server: Server | null = null

export function startMobileGateway(): MobileGateway | null {
  if (server) return { url: "", token: "", stop: () => undefined }

  const address = tailscaleAddress()
  if (!address) {
    log.warn("no Tailscale address found; the phone gateway stays off")
    return null
  }

  // Both are kept rather than made fresh per launch: the phone bookmark has to
  // survive a restart of the app, and a token that changed every time would
  // turn the whole thing into something to reconfigure by hand each morning.
  const settings = getSettings()
  const token = settings.mobileToken || randomBytes(16).toString("hex")
  if (!settings.mobileToken) setSettings({ mobileToken: token })
  const wanted = settings.mobilePort || 4777

  const root = join(__dirname, "../renderer")
  const clients = new Set<ServerResponse>()

  const send = (res: ServerResponse, status: number, body: unknown): void => {
    const payload = typeof body === "string" ? body : JSON.stringify(body)
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    })
    res.end(payload)
  }

  const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
      let raw = ""
      req.on("data", (part) => {
        raw += part
        // A prompt is a sentence; anything past this is not one, and letting it
        // accumulate would be a way to make this process hold memory.
        if (raw.length > 2 * 1024 * 1024) {
          reject(new Error("Body too large"))
          req.destroy()
        }
      })
      req.on("end", () => resolve(raw))
      req.on("error", reject)
    })

  const instance = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", `http://${address}`)
        const path = url.pathname

        // The live stream, kept as its own long-lived response rather than a
        // proxied one: the server's own stream is already parsed here, so
        // re-serialising is cheaper than tunnelling the bytes.
        if (path === "/events") {
          if (url.searchParams.get("token") !== token) return send(res, 403, { error: "bad token" })
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          })
          clients.add(res)
          req.on("close", () => clients.delete(res))
          return
        }

        // The client itself, served from the built renderer. `token` in the
        // query is what the page hands straight back on every call, so a reload
        // works without retyping it.
        if (!path.startsWith("/api/")) {
          const file = path === "/" || path === "" ? "mobile.html" : path.slice(1)
          const target = normalize(join(root, file))
          // A path that climbs out of the renderer folder is a request for a
          // file outside it.
          if (!target.startsWith(root) || !existsSync(target)) return send(res, 404, { error: "not found" })
          res.writeHead(200, { "content-type": MIME[extname(target)] ?? "application/octet-stream" })
          return void res.end(readFileSync(target))
        }

        if (url.searchParams.get("token") !== token) {
          return send(res, 403, { error: "bad token" })
        }

        const method = req.method ?? "GET"
        if (!allowed(method, path)) {
          log.warn(`mobile gateway refused ${method} ${path}`)
          return send(res, 403, { error: "not allowed" })
        }

        const query: Record<string, string> = {}
        for (const [key, value] of url.searchParams) {
          if (key !== "token") query[key] = value
        }

        const options: { query?: Record<string, string>; body?: unknown } = { query }
        if (method !== "GET") {
          const raw = await readBody(req)
          if (raw) options.body = JSON.parse(raw)
        }

        const result = await service.request(method, path, options)
        send(res, 200, result)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        send(res, 502, { error: message })
      }
    })()
  })

  server = instance
  // Forward what the server says rather than a byte stream: the phone gets the
  // same events the desktop does, parsed once.
  const forward = (event: Record<string, unknown>): void => {
    const frame = `data: ${JSON.stringify(event)}\n\n`
    for (const client of clients) client.write(frame)
  }
  service.on("event", forward)

  const url = `http://${address}:${wanted}/?token=${token}`
  instance.on("error", (err) => {
    log.error("phone gateway could not listen", err)
    // The usual reason is the port already taken by something else, which is
    // not worth failing over: any free port will do, the phone reads it here.
    if ((err as { code?: string }).code === "EADDRINUSE") {
      server = null
      service.off("event", forward)
      startMobileGateway()
      return
    }
  })
  instance.listen(wanted, address)

  return {
    url,
    token,
    stop: () => {
      service.off("event", forward)
      instance.close()
      server = null
    },
  }
}

/** Whether this machine is on a Tailscale network at all. */
export function hasTailscale(): boolean {
  return tailscaleAddress() !== null
}
