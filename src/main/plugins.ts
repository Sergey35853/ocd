import { existsSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"
import { readConfig, configPlugins, addPlugin, removePlugin } from "./configFile"
import { packageInfo } from "./npm"
import { service } from "./service"
import type { ManagedPlugin, NpmPluginHit, PluginEntry, PluginSourceKind } from "@shared/types"

function classify(entry: string): { kind: PluginSourceKind; path: string | null } {
  if (entry.startsWith("file://")) {
    return { kind: "local", path: entry.slice("file://".length) }
  }
  if (isAbsolute(entry) || entry.startsWith("./") || entry.startsWith("../") || /^[A-Za-z]:[\\/]/.test(entry)) {
    return { kind: "local", path: resolve(entry) }
  }
  return { kind: "npm", path: null }
}

/**
 * Managed plugin list = union of
 *   - entries in opencode.jsonc "plugins" (enabled/disabled intent)
 *   - plugins the running server reports (runtime truth)
 */
export async function listPlugins(): Promise<ManagedPlugin[]> {
  const config = readConfig()
  const entries = configPlugins(config.text)

  let runtime: PluginEntry[] = []
  try {
    const body = (await service.get<{ data?: PluginEntry[] } | PluginEntry[]>("/api/plugin")) as
      | { data?: PluginEntry[] }
      | PluginEntry[]
    runtime = Array.isArray(body) ? body : (body.data ?? [])
  } catch {
    runtime = []
  }

  const runtimeById = new Map(runtime.map((item) => [item.id, item]))
  const out: ManagedPlugin[] = []

  for (const entry of entries) {
    const { kind, path } = classify(entry)
    const match =
      runtimeById.get(entry) ??
      (kind === "local" ? runtime.find((item) => item.source?.path === path) : undefined)
    out.push({
      id: entry,
      kind,
      path,
      enabled: true,
      runtime: match ?? null,
      meta: kind === "npm" ? await packageInfo(entry) : null,
      error:
        kind === "local" && path && !existsSync(path)
          ? "Directory not found"
          : match?.state?.status === "error"
            ? String(match.state.error ?? "Plugin failed to load")
            : undefined,
    })
  }

  // Runtime-only plugins (built-ins and anything loaded outside config).
  for (const item of runtime) {
    const alreadyListed = out.some(
      (entry) => entry.id === item.id || (entry.path && entry.path === item.source?.path),
    )
    if (alreadyListed) continue
    const type = item.source?.type
    const kind: PluginSourceKind = type === "local" ? "local" : type === "npm" ? "npm" : "builtin"
    out.push({
      id: item.id,
      kind,
      path: item.source?.path ?? null,
      enabled: item.state?.status === "active",
      runtime: item,
      meta: null,
      error: item.state?.status === "error" ? String(item.state.error ?? "Plugin failed to load") : undefined,
    })
  }

  return out
}

export async function installPlugin(spec: string): Promise<{ ok: boolean; error?: string }> {
  const name = spec.trim()
  if (!name) return { ok: false, error: "Empty package name" }

  // Local directory shortcut: "C:\path\to\plugin" or file:// URL.
  if (name.startsWith("file://") || isAbsolute(name)) {
    return addLocalPlugin(name)
  }
  if (name.startsWith(".") || name.startsWith("/")) {
    return { ok: false, error: "Relative paths must be absolute" }
  }
  if (name.includes("\\") || /^[A-Za-z]:/.test(name)) {
    return addLocalPlugin(name)
  }

  const info = await packageInfo(name)
  if (!info) return { ok: false, error: `Package "${name}" not found on npm` }
  return addPlugin(name)
}

export async function addLocalPlugin(dir: string): Promise<{ ok: boolean; error?: string }> {
  const raw = dir.startsWith("file://") ? dir.slice("file://".length) : dir
  const path = resolve(raw)
  if (!existsSync(path)) return { ok: false, error: `Directory not found: ${path}` }
  return addPlugin(`file://${path.replace(/\\/g, "/")}`)
}

export async function uninstallPlugin(id: string): Promise<{ ok: boolean; error?: string }> {
  const { kind } = classify(id)
  if (kind === "builtin") {
    return { ok: false, error: "Built-in plugins cannot be removed" }
  }
  return removePlugin(id)
}

export type { NpmPluginHit }