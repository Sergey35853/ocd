import type { NpmPluginHit } from "@shared/types"

const REGISTRY = "https://registry.npmjs.org"

/** Keywords that mark an npm package as an OpenCode plugin candidate. */
const PLUGIN_HINTS = [
  "opencode",
  "opencode-plugin",
  "opencode-plugin-",
  "ocd-plugin",
]

function isPluginName(name: string, keywords: string[] = []): boolean {
  const hay = `${name} ${keywords.join(" ")}`.toLowerCase()
  return PLUGIN_HINTS.some((hint) => hay.includes(hint))
}

export async function searchPlugins(query: string, limit = 40): Promise<NpmPluginHit[]> {
  const term = query.trim() || "opencode-plugin"
  const url = `${REGISTRY}/-/v1/search?text=${encodeURIComponent(term)}&size=${limit}`
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`npm search failed: HTTP ${res.status}`)
  const body = (await res.json()) as {
    objects?: Array<{
      package: {
        name: string
        version: string
        description?: string
        author?: string | { name?: string }
        keywords?: string[]
        date?: string
        links?: { npm?: string; homepage?: string; repository?: string }
      }
    }>
  }
  const hits: NpmPluginHit[] = []
  for (const entry of body.objects ?? []) {
    const pkg = entry.package
    const author = typeof pkg.author === "string" ? pkg.author : pkg.author?.name
    hits.push({
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      author,
      keywords: pkg.keywords,
      date: pkg.date,
      links: pkg.links,
    })
  }
  // Exact plugin names first, then most relevant-looking ones.
  return hits.sort((a, b) => {
    const score = (hit: NpmPluginHit) =>
      (isPluginName(hit.name, hit.keywords) ? 0 : 1) + (hit.name.startsWith("opencode-plugin") ? -0.5 : 0)
    return score(a) - score(b)
  })
}

export async function packageInfo(name: string): Promise<NpmPluginHit | null> {
  try {
    const res = await fetch(`${REGISTRY}/${name.replace("/", "%2F")}/latest`, {
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return null
    const pkg = (await res.json()) as {
      name: string
      version: string
      description?: string
      author?: string | { name?: string }
      keywords?: string[]
      links?: { npm?: string; homepage?: string; repository?: string }
    }
    return {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      author: typeof pkg.author === "string" ? pkg.author : pkg.author?.name,
      keywords: pkg.keywords,
      links: pkg.links,
    }
  } catch {
    return null
  }
}