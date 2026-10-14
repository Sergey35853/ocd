import { app } from "electron"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { LIMIT_WINDOWS, type LimitWindow, type RequestLimits } from "@shared/types"

/**
 * A local ledger of requests sent to models.
 *
 * The OpenCode server exposes token counts and money but nothing about how many
 * requests a provider will still accept — there is no such route in its
 * OpenAPI. So OCD counts what it sends itself: every `session.step.started`
 * event is one call to a model, and the times of those calls are what a rolling
 * limit is measured against.
 *
 * Two consequences worth stating plainly:
 * - The counts cover requests made *through OCD*. A turn started in another
 *   client is invisible, so the number is a floor, not the provider's counter.
 * - Limits are not read from anywhere either. The ones below are the published
 *   figures for OpenCode Zen's free tier as of writing; anything else is
 *   whatever the user typed. A remembered number is labelled as such rather
 *   than dressed up as live data.
 */

/** Request ceiling for OpenCode Zen's keyless free models. */
const ZEN_FREE_LIMITS: Array<{ window: LimitWindow; limit: number }> = [{ window: "5h", limit: 200 }]

/** How long a 429 is taken as binding before the meter stops counting it down. */
const COOLDOWN_MS = 5 * 60_000

interface ModelRecord {
  /** Epoch ms of every counted request, ascending. */
  stamps: number[]
  cooldownUntil: number | null
  /** Limits the user typed, per window. Empty = use the built-in ones. */
  user: Array<{ window: LimitWindow; limit: number }>
}

interface LedgerFile {
  version: 1
  models: Record<string, ModelRecord>
}

let cache: LedgerFile | null = null

function ledgerFile(): string {
  return join(app.getPath("userData"), "ocd-requests.json")
}

/** Nothing older than the widest window can ever still be counted. */
function horizon(now: number): number {
  const widest = LIMIT_WINDOWS[LIMIT_WINDOWS.length - 1]
  return now - widest.ms
}

function emptyFile(): LedgerFile {
  return { version: 1, models: {} }
}

function load(): LedgerFile {
  if (cache) return cache
  const file = ledgerFile()
  try {
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<LedgerFile>
      const models: Record<string, ModelRecord> = {}
      for (const [key, value] of Object.entries(parsed.models ?? {})) {
        const record = value as Partial<ModelRecord>
        if (!Array.isArray(record.stamps)) continue
        models[key] = {
          stamps: record.stamps.filter((stamp): stamp is number => typeof stamp === "number"),
          cooldownUntil: typeof record.cooldownUntil === "number" ? record.cooldownUntil : null,
          user: Array.isArray(record.user) ? (record.user as ModelRecord["user"]) : [],
        }
      }
      cache = { version: 1, models }
      return cache
    }
  } catch {
    /* a corrupt ledger is a counter starting over, not a broken app */
  }
  cache = emptyFile()
  return cache
}

function save(): void {
  if (!cache) return
  const file = ledgerFile()
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(cache), "utf8")
  } catch (err) {
    console.error("Failed to persist the request ledger:", err)
  }
}

function record(model: string): ModelRecord {
  const ledger = load()
  const existing = ledger.models[model]
  if (existing) return existing
  const created: ModelRecord = { stamps: [], cooldownUntil: null, user: [] }
  ledger.models[model] = created
  return created
}

/**
 * Count one request to a model.
 *
 * `at` is passed in rather than read from the clock so that a batch of events
 * replayed after a reconnect still lands in the right window.
 */
export function countRequest(model: string, at = Date.now()): void {
  const entry = record(model)
  entry.stamps.push(at)
  // Keep the file small: a month of timestamps per model is plenty and a
  // ledger nobody prunes turns into a multi-megabyte JSON on disk.
  const floor = horizon(at)
  if (entry.stamps.length > 512 || entry.stamps[0] < floor) {
    entry.stamps = entry.stamps.filter((stamp) => stamp >= floor)
  }
  save()
}

/**
 * Remember that a provider refused a request as a rate limit.
 *
 * A cooldown is only kept while it is still in the future: a stale one would
 * keep the meter red long after the provider started answering again.
 */
export function markRateLimited(model: string, at = Date.now()): void {
  const entry = record(model)
  entry.cooldownUntil = at + COOLDOWN_MS
  save()
}

function limitsFor(model: string, entry: ModelRecord | undefined) {
  if (entry?.user.length) return { list: entry.user, source: "user" as const }
  if (isZenFree(model)) return { list: ZEN_FREE_LIMITS, source: "builtin" as const }
  return { list: [] as Array<{ window: LimitWindow; limit: number }>, source: "none" as const }
}

/** Zen's keyless pool: no API key, base URL pointing at the Zen gateway. */
function isZenFree(model: string): boolean {
  const separator = model.indexOf("/")
  if (separator < 0) return false
  return model.slice(0, separator) === "opencode"
}

/** Everything the meter needs for one model, as of now. */
export function snapshot(model: string, now = Date.now()): RequestLimits {
  const entry = load().models[model]
  const { list, source } = limitsFor(model, entry)
  const stamps = (entry?.stamps ?? []).filter((stamp) => stamp >= horizon(now))

  const windows = LIMIT_WINDOWS.map(({ id, ms }) => {
    const floor = now - ms
    // The stamps are ascending, so the count inside the window ends where the
    // first one out of it sits.
    let count = 0
    while (count < stamps.length && stamps[count] < floor) count++
    const inside = stamps.slice(count)
    const limit = list.find((item) => item.window === id)?.limit ?? null
    return {
      window: id,
      used: inside.length,
      limit,
      resetAt: inside.length ? inside[0] + ms : null,
    }
  })

  const cooldown = entry?.cooldownUntil && entry.cooldownUntil > now ? entry.cooldownUntil : null
  return { model, windows, source, cooldownUntil: cooldown, updatedAt: now }
}

/** Set, change or clear the limit for one window. `null` removes it. */
export function setLimit(
  model: string,
  window: LimitWindow,
  limit: number | null,
): RequestLimits {
  const entry = record(model)
  entry.user = entry.user.filter((item) => item.window !== window)
  if (limit !== null && Number.isFinite(limit) && limit > 0) {
    entry.user.push({ window, limit: Math.round(limit) })
  }
  save()
  return snapshot(model)
}

/** Forget the counts for one model, or for all of them. */
export function clear(model?: string): void {
  const ledger = load()
  if (model) delete ledger.models[model]
  else ledger.models = {}
  save()
}