import { EventEmitter } from "node:events"
import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { ServiceStatus } from "@shared/types"
import { log } from "./log"

/**
 * Registration file written by `opencode serve --service`.
 * Mirrors @opencode/client/service: $XDG_STATE_HOME/opencode/service.json
 */
function registrationFile(): string {
  const state = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state")
  return join(state, "opencode", "service.json")
}

interface Registration {
  id: string
  version: string
  url: string
  pid: number
  password?: string
}

interface Endpoint {
  url: string
  auth?: { type: "basic"; username: string; password: string }
}

/**
 * Ceiling on one unterminated SSE frame.
 *
 * Frames are normally a few kilobytes; this is the point past which the
 * stream is not delivering frames but a body with no terminator in it.
 */
const MAX_FRAME_BYTES = 8 * 1024 * 1024

function authHeader(endpoint: Endpoint): Record<string, string> {
  if (!endpoint.auth) return {}
  const raw = `${endpoint.auth.username}:${endpoint.auth.password}`
  return { authorization: `Basic ${Buffer.from(raw).toString("base64")}` }
}

/**
 * Most endpoints answer with a thin envelope such as { data: ... }.
 * Unwrap it when `data` is the payload and nothing meaningful sits beside it.
 */
function unwrapEnvelope(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body
  const keys = Object.keys(body as Record<string, unknown>)
  if (keys.includes("data") && keys.length <= 2) {
    return (body as Record<string, unknown>).data
  }
  return body
}

function readRegistration(): Registration | null {
  const file = registrationFile()
  try {
    if (!existsSync(file)) return null
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<Registration>
    if (typeof parsed.url !== "string" || typeof parsed.pid !== "number") return null
    return {
      id: parsed.id ?? "",
      version: parsed.version ?? "",
      url: parsed.url,
      pid: parsed.pid,
      password: parsed.password,
    }
  } catch {
    return null
  }
}

/** Candidate opencode binaries: PATH first, then the Desktop sidecar install. */
function candidateBinaries(): string[] {
  const found: string[] = []
  const pathDir = process.env.PATH ?? ""
  for (const dir of pathDir.split(";")) {
    if (!dir.trim()) continue
    const exe = join(dir.trim(), "opencode.exe")
    if (existsSync(exe)) found.push(exe)
    const unix = join(dir.trim(), "opencode")
    if (existsSync(unix)) found.push(unix)
  }
  const roaming = process.env.APPDATA
  if (roaming) {
    const cliRoot = join(roaming, "ai.opencode.desktop", "cli")
    try {
      const { readdirSync } = require("node:fs") as typeof import("node:fs")
      for (const version of readdirSync(cliRoot)) {
        const exe = join(cliRoot, version, "opencode-cli.exe")
        if (existsSync(exe)) found.push(exe)
      }
    } catch {
      /* sidecar layout not present */
    }
  }
  return found
}

export class OpenCodeService extends EventEmitter {
  private endpoint: Endpoint | null = null
  private version: string | null = null
  private lastError: string | null = null
  private overrideUrl: string | null = null

  private streamAbort: AbortController | null = null
  private streamTask: Promise<void> | null = null
  private reconnectDelay = 500

  constructor() {
    super()
    this.setMaxListeners(50)
  }

  status(): ServiceStatus {
    return {
      connected: this.endpoint !== null,
      url: this.endpoint?.url ?? null,
      version: this.version,
      pid: this.endpoint ? this.readPid() : null,
      error: this.endpoint ? null : this.lastError,
      registrationFile: registrationFile(),
    }
  }

  private readPid(): number | null {
    const reg = readRegistration()
    return reg?.pid ?? null
  }

  setOverride(url: string | null): void {
    this.overrideUrl = url && url.trim() ? url.trim().replace(/\/+$/, "") : null
    this.endpoint = null
    this.version = null
  }

  /**
   * Connect to a running service, starting one when needed.
   * `manualUrl` bypasses registration discovery entirely.
   */
  async connect(manualUrl?: string): Promise<ServiceStatus> {
    if (manualUrl && manualUrl.trim()) {
      this.overrideUrl = manualUrl.trim().replace(/\/+$/, "")
    }

    const attempts: Endpoint[] = []

    if (this.overrideUrl) {
      // Password from the shared registration is reused for manual URLs.
      const password = readRegistration()?.password
      attempts.push({
        url: this.overrideUrl,
        auth: password
          ? { type: "basic", username: "opencode", password }
          : undefined,
      })
    } else {
      const reg = readRegistration()
      if (reg) {
        attempts.push({
          url: reg.url,
          auth: reg.password
            ? { type: "basic", username: "opencode", password: reg.password }
            : undefined,
        })
      }
      for (const attempt of attempts) {
        if (await this.probe(attempt)) return this.status()
      }
      const started = await this.startService()
      if (started && reg) {
        attempts.push({
          url: started.url,
          auth: started.password
            ? { type: "basic", username: "opencode", password: started.password }
            : undefined,
        })
      }
    }

    for (const attempt of attempts) {
      if (await this.probe(attempt)) return this.status()
    }

    this.endpoint = null
    this.version = null
    this.lastError = this.lastError ?? "OpenCode server not reachable"
    this.emit("status", this.status())
    return this.status()
  }

  private async probe(endpoint: Endpoint): Promise<boolean> {
    try {
      const res = await fetch(new URL("/api/info", endpoint.url), {
        headers: authHeader(endpoint),
        signal: AbortSignal.timeout(4000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { version?: string }
      this.endpoint = endpoint
      this.version = body.version ?? null
      this.lastError = null
      this.reconnectDelay = 500
      this.emit("status", this.status())
      return true
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err)
      return false
    }
  }

  /**
   * Move onto whatever address the server is on now.
   *
   * The registration file is rewritten on every server restart and the server
   * picks a fresh port each time, so the address remembered at connect time
   * goes stale the moment OpenCode restarts — and a stale address looks exactly
   * like a healthy one, because nothing about the failure is visible from here:
   * `status()` keeps reporting `connected` while every request fails. Re-probing
   * the remembered address cannot fix that; the file is the only thing that
   * knows where the server went.
   */
  private async recover(): Promise<boolean> {
    if (!this.overrideUrl) {
      const reg = readRegistration()
      const stale = this.endpoint
      const moved =
        reg !== null &&
        (reg.url !== stale?.url ||
          (reg.password ?? "") !== (stale?.auth?.password ?? ""))
      if (moved) {
        log.info(`service moved: ${stale?.url ?? "nothing"} -> ${reg.url}`)
        this.endpoint = null
        this.version = null
        if (
          await this.probe({
            url: reg.url,
            auth: reg.password
              ? { type: "basic", username: "opencode", password: reg.password }
              : undefined,
          })
        ) {
          return true
        }
      }
    }
    // No move on record: the address is right and the failure was transient.
    return this.endpoint !== null && (await this.probe(this.endpoint))
  }

  /** Spawn `opencode serve --service` and wait for a fresh registration. */
  private async startService(): Promise<Registration | null> {
    const before = readRegistration()
    for (const binary of candidateBinaries()) {
      const ok = await this.spawnAndWait(binary, before)
      if (ok) return readRegistration()
    }
    return null
  }

  private spawnAndWait(binary: string, before: Registration | null): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false
      const done = (value: boolean) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      try {
        const child = spawn(binary, ["serve", "--service"], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        })
        child.unref()
        child.on("error", () => done(false))
      } catch {
        done(false)
        return
      }

      const deadline = Date.now() + 30_000
      const tick = setInterval(() => {
        const reg = readRegistration()
        const changed = reg !== null && (before === null || reg.id !== before.id || reg.pid !== before.pid)
        if (changed) {
          clearInterval(tick)
          done(true)
        } else if (Date.now() > deadline) {
          clearInterval(tick)
          done(false)
        }
      }, 400)
    })
  }

  async restart(): Promise<ServiceStatus> {
    const reg = readRegistration()
    if (reg) {
      try {
        process.kill(reg.pid, "SIGTERM")
      } catch {
        /* already gone */
      }
      await new Promise((r) => setTimeout(r, 1200))
    }
    this.endpoint = null
    this.version = null
    this.setOverride(this.overrideUrl)
    return this.connect()
  }

  private requireEndpoint(): Endpoint {
    if (!this.endpoint) throw new Error("Not connected to OpenCode")
    return this.endpoint
  }

  async request<T = unknown>(
    method: string,
    path: string,
    options: { query?: Record<string, string | number | undefined>; body?: unknown } = {},
  ): Promise<T> {
    // Two attempts at most. A fetch that fails on the connection is the one
    // error worth retrying, and only after the registration has been read
    // again: without that second look a moved server turns every request into
    // a failure and the window into an empty app.
    for (let attempt = 0; ; attempt++) {
      const endpoint = this.requireEndpoint()
      const url = new URL(path, endpoint.url)
      for (const [key, value] of Object.entries(options.query ?? {})) {
        if (value !== undefined) url.searchParams.set(key, String(value))
      }
      const init: RequestInit = {
        method,
        headers: {
          ...authHeader(endpoint),
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        },
        signal: AbortSignal.timeout(120_000),
      }
      if (options.body !== undefined) init.body = JSON.stringify(options.body)
      let res: Response
      try {
        res = await fetch(url, init)
      } catch (err) {
        if (attempt === 0 && (await this.recover())) continue
        throw err
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        throw new Error(`HTTP ${res.status} ${method} ${path}${text ? `: ${text.slice(0, 400)}` : ""}`)
      }
      if (res.status === 204) return undefined as T
      const type = res.headers.get("content-type") ?? ""
      if (type.includes("application/json")) {
        const body = await res.json()
        return unwrapEnvelope(body) as T
      }
      return (await res.text()) as unknown as T
    }
  }

  get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    return this.request<T>("GET", path, { query })
  }

  post<T>(path: string, body?: unknown, query?: Record<string, string | number | undefined>): Promise<T> {
    return this.request<T>("POST", path, { body, query })
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PATCH", path, { body })
  }

  del<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path)
  }

  /**
   * Keep a single live event subscription and forward parsed events.
   * Mirrors client docs: live-only, no replay, re-subscribe on failure.
   */
  startEventStream(): void {
    if (this.streamTask) return
    this.streamTask = this.runStream().finally(() => {
      this.streamTask = null
    })
  }

  private async runStream(): Promise<void> {
    while (this.endpoint) {
      // Held locally as well as on the field. `stopEventStream` clears the
      // field while the request is still in flight, and the handler below runs
      // *after* that — so asking the shared field whether it was aborted read
      // `.signal` off null and threw straight out of the catch, taking the
      // process with it. This is the crash that kept closing the app.
      const controller = new AbortController()
      this.streamAbort = controller
      try {
        const endpoint = this.endpoint
        const res = await fetch(new URL("/api/event", endpoint.url), {
          headers: { ...authHeader(endpoint), accept: "text/event-stream" },
          signal: controller.signal,
        })
        if (!res.ok || !res.body) throw new Error(`Event stream HTTP ${res.status}`)
        this.reconnectDelay = 500

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let sep: number
          while ((sep = buffer.indexOf("\n\n")) !== -1) {
            const chunk = buffer.slice(0, sep)
            buffer = buffer.slice(sep + 2)
            for (const line of chunk.split("\n")) {
              if (!line.startsWith("data:")) continue
              const payload = line.slice(5).trim()
              if (!payload) continue
              try {
                const parsed = JSON.parse(payload) as Record<string, unknown>
                this.emit("event", parsed)
                if (parsed.type === "server.connected") this.emit("status", this.status())
              } catch {
                /* ignore malformed frame */
              }
            }
          }
          // A frame that never sends its terminator would otherwise grow this
          // string until the process ran out of memory, and nothing in the
          // loop would notice. A frame split across reads is normal and stays
          // well under this; dropping the buffer costs one lost frame, while
          // running out of memory costs the app.
          if (buffer.length > MAX_FRAME_BYTES) {
            log.error(
              `event stream frame passed ${MAX_FRAME_BYTES} bytes without a terminator; dropped`,
            )
            buffer = ""
          }
        }
      } catch (err) {
        // The controller that ended this attempt, not whatever is in the field
        // now — by this point that may already belong to the next attempt.
        if (controller.signal.aborted) return
        this.lastError = err instanceof Error ? err.message : String(err)
        this.emit("status", this.status())
      }
      // Back off before re-subscribing so a dead server does not spin.
      await new Promise((r) => setTimeout(r, this.reconnectDelay))
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10_000)
      if (!this.endpoint) return
      // Not just the same address again: the server may have restarted onto a
      // new port since the last attempt, and that is the case this loop exists
      // for.
      await this.recover()
    }
  }

  stopEventStream(): void {
    this.streamAbort?.abort()
    this.streamAbort = null
  }
}

export const service = new OpenCodeService()