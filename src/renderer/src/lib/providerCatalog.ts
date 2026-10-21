import type {
  ConnectionInfo,
  IntegrationInfo,
  IntegrationMethod,
  LocalRuntimeStatus,
} from "@shared/types"

/**
 * One integration as the Providers view shows it.
 *
 * Flattened from the server's shape so the list can be sorted and filtered
 * without every consumer walking methods and connections.
 */
export interface CatalogEntry {
  id: string
  name: string
  /** Cloud services need a key; local runtimes need only a reachable port. */
  kind: "cloud" | "local"
  /** Ways this integration can be connected, in the server's order. */
  methods: IntegrationMethod[]
  /** Already-established credentials, so the view can say "connected". */
  connections: ConnectionInfo[]
  /**
   * Well-known local endpoints, matched by id.
   *
   * The server's catalog is cloud-only: it lists 229 hosted providers and no
   * local runtime at all, so the four presets we know the ports of live here.
   */
  runtime?: { baseURL: string; port: number }
  /** Live answer from the last probe, when this is a local runtime. */
  status?: LocalRuntimeStatus
}

/** The local runtimes we know how to reach. */
const LOCAL_RUNTIMES: Record<string, { baseURL: string; port: number }> = {
  ollama: { baseURL: "http://127.0.0.1:11434/v1", port: 11434 },
  lmstudio: { baseURL: "http://127.0.0.1:1234/v1", port: 1234 },
  llamacpp: { baseURL: "http://127.0.0.1:8080/v1", port: 8080 },
  jan: { baseURL: "http://127.0.0.1:1337/v1", port: 1337 },
  "llama-cpp": { baseURL: "http://127.0.0.1:8080/v1", port: 8080 },
}

/**
 * Ids we probe even though the server does not list them.
 *
 * Ollama is the one people actually run locally, and it is missing from the
 * server catalog, so it is added rather than left out.
 */
const EXTRA_LOCAL = [
  { id: "ollama", name: "Ollama" },
  { id: "lmstudio", name: "LM Studio" },
  { id: "llamacpp", name: "llama.cpp" },
  { id: "jan", name: "Jan" },
]

export function buildCatalog(
  integrations: IntegrationInfo[],
  statuses: Record<string, LocalRuntimeStatus>,
): CatalogEntry[] {
  const entries = new Map<string, CatalogEntry>()

  for (const item of integrations) {
    const runtime = LOCAL_RUNTIMES[item.id]
    entries.set(item.id, {
      id: item.id,
      name: item.name,
      // Anything with a known port is local even if the server files it as a
      // hosted service: `llama` and `lmstudio` appear in both lists.
      kind: runtime ? "local" : "cloud",
      methods: item.methods ?? [],
      connections: item.connections ?? [],
      runtime,
      status: runtime ? statuses[item.id] : undefined,
    })
  }

  for (const extra of EXTRA_LOCAL) {
    if (entries.has(extra.id)) continue
    const runtime = LOCAL_RUNTIMES[extra.id]
    entries.set(extra.id, {
      id: extra.id,
      name: extra.name,
      kind: "local",
      methods: [],
      connections: [],
      runtime,
      status: statuses[extra.id],
    })
  }

  return sortCatalog([...entries.values()])
}

/** Local runtimes first, then alphabetical; that is how anyone looks for one. */
export function sortCatalog(entries: CatalogEntry[]): CatalogEntry[] {
  // A copy: sorting in place would reorder the caller's own list, which is
  // the server's list of integrations and is used as it was given.
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "local" ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  })
}

export interface CatalogFilter {
  query: string
  kind: "all" | "cloud" | "local"
  /** Hide entries that already have a credential. */
  hideConnected: boolean
}

export function filterCatalog(entries: CatalogEntry[], filter: CatalogFilter): CatalogEntry[] {
  const q = filter.query.trim().toLowerCase()
  return entries.filter((entry) => {
    if (filter.kind !== "all" && entry.kind !== filter.kind) return false
    if (filter.hideConnected && isConnected(entry)) return false
    if (!q) return true
    return (
      entry.id.toLowerCase().includes(q) ||
      entry.name.toLowerCase().includes(q) ||
      // Method labels are searchable: someone typing "github" should find
      // Copilot, and someone typing "device" should find every OAuth option.
      entry.methods.some((method) => (method.label ?? "").toLowerCase().includes(q))
    )
  })
}

/**
 * Whether an integration has a credential the server can use.
 *
 * The presence of a connection entry is not enough: the server also reports
 * `needs_auth` with a message and a URL for a key that has expired or been
 * revoked, and calling that "connected" is exactly the kind of quiet wrongness
 * this view exists to remove.
 */
export function isConnected(entry: CatalogEntry): boolean {
  return entry.connections.some((connection) => connection.status !== "needs_auth")
}

/** Integrations holding a credential that no longer works. */
export function staleConnections(entry: CatalogEntry): ConnectionInfo[] {
  return entry.connections.filter((connection) => connection.status === "needs_auth")
}

/** Every runtime id worth probing, deduplicated. */
export function probeTargets(entries: CatalogEntry[]): Array<{ id: string; baseURL: string }> {
  const targets = new Map<string, string>()
  for (const entry of entries) {
    if (entry.runtime) targets.set(entry.id, entry.runtime.baseURL)
  }
  return [...targets].map(([id, baseURL]) => ({ id, baseURL }))
}
