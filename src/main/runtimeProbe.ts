import type { LocalRuntimeStatus } from "@shared/types"

/** Long enough for a busy laptop, short enough not to hold up the list. */
const TIMEOUT_MS = 2500

/**
 * Ask a local runtime what it has.
 *
 * Every runtime worth supporting speaks the OpenAI list-models route, so one
 * probe covers Ollama, LM Studio, llama.cpp and Jan alike. The failure is
 * returned rather than thrown: an engine that is simply not running is the
 * normal case, and it should read as "offline", not as an error.
 *
 * Runs in main because a renderer request to 127.0.0.1 is cross-origin: the page
 * would either refuse it or hang until its own timeout, and a hung list is
 * worse than a wrong answer.
 */
export async function probeRuntime(baseURL: string): Promise<LocalRuntimeStatus> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(`${baseURL.replace(/\/+$/, "")}/models`, {
      signal: controller.signal,
    })
    if (!response.ok) return { online: false, error: `HTTP ${response.status}` }

    const body = (await response.json()) as { data?: Array<{ id?: string }> }
    const models = Array.isArray(body.data) ? body.data : []
    const ids = models
      .map((model) => model?.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
    return { online: true, models: ids.length, sample: ids.slice(0, 5) }
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError"
    return { online: false, error: aborted ? "таймаут" : "нет ответа" }
  } finally {
    clearTimeout(timer)
  }
}
