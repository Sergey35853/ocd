/** One step of a download, pushed to the renderer as it happens. */
export interface PullProgress {
  /** Opaque handle so several downloads can be watched at once. */
  id: string
  engine: string
  model: string
  /** Fraction 0..1, or null when the engine does not report one. */
  fraction: number | null
  /** Bytes, when known. */
  total?: number
  done?: number
  status: "running" | "done" | "error" | "cancelled"
  message?: string
}

/**
 * Local engines we can fetch models through.
 *
 * Every one of these speaks the same HTTP route, so one puller covers them
 * all. `label` is the command shown to the user when something goes wrong.
 */
export interface PullEngine {
  id: string
  label: string
  baseURL: string
  /** How to find the model list, which is the only thing needed to start. */
  modelsPath: string
  pullPath: string
  deletePath: (model: string) => string
  /** Whether the delete route expects the model in a body rather than a path. */
  deleteBody?: (model: string) => Record<string, string>
  /** Engine-specific wording for the size and count in the UI. */
  unitNote?: DictKeyLike
}

/** Kept structural so this module does not depend on the i18n runtime. */
type DictKeyLike = string

export const ENGINES: PullEngine[] = [
  {
    id: "ollama",
    label: "Ollama",
    baseURL: "http://127.0.0.1:11434",
    modelsPath: "/api/tags",
    pullPath: "/api/pull",
    // Ollama's delete takes a JSON body, not a query parameter: asking with
    // `?name=` answers 400 and deletes nothing, which looks exactly like success
    // if the list is not re-read afterwards.
    deletePath: () => "/api/delete",
    deleteBody: (model) => ({ model }),
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    baseURL: "http://127.0.0.1:1234",
    modelsPath: "/api/v0/models",
    pullPath: "/api/v1/models/load",
    deletePath: (model) => `/api/v0/models/${encodeURIComponent(model)}`,
  },
]

/** Running pulls, so they can be stopped. */
type Cancellable = { kill(): void }
const running = new Map<string, Cancellable>()

let counter = 0
function nextId(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now()}-${counter}`
}

/**
 * Ask an engine what models it holds.
 *
 * The shapes differ per engine, so each is read in its own terms rather than
 * through one hopeful guess at a common shape.
 */
export async function engineModels(engine: PullEngine): Promise<
  Array<{ name: string; size?: number; modified?: string }>
> {
  const response = await fetch(`${engine.baseURL}${engine.modelsPath}`, {
    signal: AbortSignal.timeout(4000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  if (engine.id === "ollama") {
    const body = (await response.json()) as {
      models?: Array<{ name: string; size?: number; modified_at?: string }>
    }
    return (body.models ?? []).map((model) => ({
      name: model.name,
      size: model.size,
      modified: model.modified_at,
    }))
  }

  const body = (await response.json()) as {
    data?: Array<{ id?: string; state?: string; size_bytes?: number }>
  }
  return (body.data ?? [])
    .filter((model) => model.state !== "not-loaded")
    .map((model) => ({
      name: model.id ?? "",
      size: model.size_bytes,
    }))
    .filter((model) => model.name)
}

/**
 * Download a model, reporting progress.
 *
 * Deliberately not silent and not automatic: the user asks for a model by name
 * from this app, and nothing is ever fetched because a provider happened to
 * appear in a catalog.
 */
export function pullModel(
  engine: PullEngine,
  model: string,
  onProgress: (progress: PullProgress) => void,
): string {
  const id = nextId("pull")
  const handle =
    engine.id === "ollama"
      ? spawnOllamaPull(engine, model, id, onProgress)
      : spawnLmStudioPull(engine, model, id, onProgress)
  // No close handler: completion arrives as a progress report from the stream
  // itself, and the handle returned here is a canceller rather than a real
  // process, so it has no events to attach to.
  void handle
  return id
}

/** Ollama streams newline-delimited JSON while it downloads. */
function spawnOllamaPull(
  engine: PullEngine,
  model: string,
  id: string,
  onProgress: (progress: PullProgress) => void,
): Cancellable {
  // No shell anywhere: the model name travels as a JSON body, so a name with
  // quotes or semicolons in it cannot become a second command.
  return streamPull(
    `${engine.baseURL}${engine.pullPath}`,
    { model, stream: true },
    id,
    engine,
    model,
    onProgress,
  )
}

/**
 * LM Studio downloads by loading a repo entry, not by streaming a manifest, so
 * there is nothing to report: it is started and then polled.
 */
function spawnLmStudioPull(
  engine: PullEngine,
  model: string,
  id: string,
  onProgress: (progress: PullProgress) => void,
): Cancellable {
  const controller = new AbortController()
  running.set(id, { kill: () => controller.abort() })

  void (async () => {
    try {
      await fetch(`${engine.baseURL}${engine.pullPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
        signal: controller.signal,
      })
      onProgress({ id, engine: engine.id, model, fraction: 1, status: "done" })
    } catch (err) {
      if (controller.signal.aborted) {
        onProgress({ id, engine: engine.id, model, fraction: null, status: "cancelled" })
        return
      }
      onProgress({
        id,
        engine: engine.id,
        model,
        fraction: null,
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      // The handle has served its purpose: the download is over and nobody can
      // cancel it any more. Keeping it would make the map grow for as long as
      // the app is open.
      running.delete(id)
    }
  })()

  return running.get(id) as Cancellable
}

/**
 * Follow Ollama's progress stream.
 *
 * Each line is `{status, digest, total, completed}`; `completed` rises as the
 * blobs arrive, and only the lines carrying both sizes can produce a fraction.
 */
function streamPull(
  url: string,
  body: Record<string, unknown>,
  id: string,
  engine: PullEngine,
  model: string,
  onProgress: (progress: PullProgress) => void,
): Cancellable {
  const controller = new AbortController()
  const fake: Cancellable = { kill: () => controller.abort() }
  running.set(id, fake)

  void (async () => {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!response.ok || !response.body) {
        onProgress({
          id,
          engine: engine.id,
          model,
          fraction: null,
          status: "error",
          message: `HTTP ${response.status}`,
        })
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let index = buffer.indexOf("\n")
        while (index >= 0) {
          const line = buffer.slice(0, index).trim()
          buffer = buffer.slice(index + 1)
          if (line) {
            const report = parseOllamaLine(line, id, engine, model)
            if (report) onProgress(report)
          }
          index = buffer.indexOf("\n")
        }
      }
      onProgress({ id, engine: engine.id, model, fraction: 1, status: "done" })
    } catch (err) {
      if (controller.signal.aborted) {
        onProgress({ id, engine: engine.id, model, fraction: null, status: "cancelled" })
        return
      }
      onProgress({
        id,
        engine: engine.id,
        model,
        fraction: null,
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      // The download is over, so the handle is dead weight: the map of
      // running pulls would otherwise keep every model ever pulled.
      running.delete(id)
    }
  })()

  return fake
}

function parseOllamaLine(
  line: string,
  id: string,
  engine: PullEngine,
  model: string,
): PullProgress | null {
  let parsed: { status?: string; total?: number; completed?: number; error?: string }
  try {
    parsed = JSON.parse(line) as typeof parsed
  } catch {
    return null
  }
  if (parsed.error) {
    return { id, engine: engine.id, model, fraction: null, status: "error", message: parsed.error }
  }
  const total = typeof parsed.total === "number" ? parsed.total : undefined
  const done = typeof parsed.completed === "number" ? parsed.completed : undefined
  return {
    id,
    engine: engine.id,
    model,
    // Only a line that carries both sizes can say how far along it is.
    fraction: total && done !== undefined ? Math.min(1, done / total) : null,
    total,
    done,
    status: "running",
    message: parsed.status,
  }
}

/** Stop a download in flight. */
export function cancelJob(id: string): boolean {
  const child = running.get(id)
  if (!child) return false
  child.kill()
  running.delete(id)
  return true
}

/** Remove a model an engine has downloaded. */
export async function deleteModel(engine: PullEngine, model: string): Promise<void> {
  const body = engine.deleteBody?.(model)
  const response = await fetch(`${engine.baseURL}${engine.deletePath(model)}`, {
    method: "DELETE",
    ...(body
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
    signal: AbortSignal.timeout(8000),
  })
  // 404 means it is already gone, which is the outcome that was asked for.
  if (!response.ok && response.status !== 404) {
    throw new Error(`HTTP ${response.status}`)
  }
}

export function engineById(id: string): PullEngine | undefined {
  return ENGINES.find((engine) => engine.id === id)
}
