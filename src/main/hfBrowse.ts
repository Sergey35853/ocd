/**
 * Search Hugging Face for models this app can download and run.
 *
 * The two endpoints are public and need no token: a model search, and a file
 * tree with per-file sizes. Sizes are the whole point — a fit verdict has to
 * exist before anything is downloaded, and the only number available without the
 * file is the one in this listing.
 */

const HF = "https://huggingface.co"

/** A repository that ships GGUF weights. */
export interface RepoHit {
  repo: string
  downloads: number
  likes: number
  updated: string
  /** Gated repos need a token, so they cannot be fetched anonymously. */
  gated: boolean
}

/** One servable weight file, with split parts collapsed into a single entry. */
export interface FileGroup {
  label: string
  paths: string[]
  totalBytes: number
}

/**
 * Matches a quantization tag in a filename: `Q4_K_M`, `q8_0`, `IQ3_XXS`, `BF16`.
 *
 * The label is shown instead of the raw filename because a user picks a build by
 * its quality class, and `Q4_K_M` says that where `qwen-32b-q4_k_m.gguf` does
 * not.
 *
 * The whole token has to be captured, not a prefix: `Q4_K` and `Q4_K_M` are
 * different builds, and a label stopping early offers a quantisation that does
 * not exist — which the engine rejects outright, so the download fails with a
 * complaint about a tag rather than about a file.
 *
 * The lookarounds are what keep a longer name from being cut in half: without
 * them `q4_k_m` would match as `q4` and be rejected.
 */
const QUANT =
  /(?<![a-z0-9])(iq[1-4](?:_?(?:xxs|xs|s|m|l))?|q\d(?:_\d|_k(?:_(?:s|m|l))?)|(?:bf|f|fp)(?:16|32))(?![a-z0-9])/i

/** A split weight file: `model-00002-of-00005.gguf`. */
const SPLIT = /-(\d{5})-of-(\d{5})\.gguf$/i

/**
 * Names of weights rather than companion files.
 *
 * Not everything ending in `.gguf` is a model. A repository can ship a vision
 * projector, a draft for speculative decoding, a tensor split across several
 * files by hand, or an "imatrix" recalibration — and all of them end the same
 * way. Offering them next to the real weights is what makes a list look
 * confusing and produce downloads that cannot be served, so they are filtered
 * by what is in the name.
 *
 * The rules are deliberately narrow: each one must not throw away a plausible
 * model, so anything unrecognised is kept.
 */
const NOT_WEIGHTS = [
  // Vision projectors and draft models are loaded alongside weights, not instead.
  /vision[-_]?encoder|mmproj|draft[-_]?model/i,
  // An importance-matrix recalibration of a quantised file, not a model.
  /imatrix|[-_]imat\b/i,
  // Hand-split tensor dumps: "Layers00-30", "output", "other-expert-layers".
  /\blayers?\d|[-_]output\b|expert[-_]layers?/i,
  // Support files for a specific speculative-decoding scheme.
  //
  // `compressor` and `indexer` are deliberately absent: those words appear
  // inside real weight filenames as MXFP4 component names (F16Compressor,
  // F16Indexer), and matching them here threw away genuine models.
  /dspark|[-_]mtp\b/i,
]

/**
 * Files that are companions to the weights rather than weights themselves.
 */
function isCompanion(filename: string): boolean {
  const name = filename.toLowerCase()
  if (name.startsWith("mmproj")) return true
  return NOT_WEIGHTS.some((pattern) => pattern.test(name))
}

/** Search GGUF repositories, most downloaded first. */
export async function searchRepos(query: string, limit = 20): Promise<RepoHit[]> {
  const q = query.trim()
  if (!q) return []
  const url =
    `${HF}/api/models?search=${encodeURIComponent(q)}` +
    `&filter=gguf&sort=downloads&direction=-1&limit=${Math.max(1, Math.min(limit, 50))}`

  const body = await getJson<Array<Record<string, unknown>>>(url)
  return body.map((model) => ({
    repo: String(model["id"] ?? ""),
    downloads: Number(model["downloads"] ?? 0),
    likes: Number(model["likes"] ?? 0),
    updated: String(model["lastModified"] ?? ""),
    gated: model["gated"] === true || typeof model["gated"] === "string",
  }))
}

/**
 * The servable weight files in one repository.
 *
 * Split files are collapsed: llama.cpp loads the first part and finds the rest
 * beside it, so offering three parts of one model as three choices would triple
 * what looks available and offer nothing that can be loaded.
 */
export async function repoFiles(repo: string): Promise<FileGroup[]> {
  // Each segment is encoded separately: encoding the whole id turns the slash
  // into %2F, which this route answers 400 for.
  const url = `${HF}/api/models/${repo.split("/").map(encodeURIComponent).join("/")}/tree/main?recursive=true`
  const body = await getJson<Array<Record<string, unknown>>>(url)

  const singles: Array<{ path: string; size: number }> = []
  const splits = new Map<string, Array<{ index: number; path: string; size: number }>>()

  for (const entry of body) {
    const path = String(entry["path"] ?? "")
    if (!path.toLowerCase().endsWith(".gguf")) continue
    const filename = path.split("/").pop() ?? path
    if (isCompanion(filename)) continue

    const size = Number(entry["size"] ?? 0)
    const match = SPLIT.exec(path)
    if (match) {
      const stem = path.slice(0, match.index)
      const list = splits.get(stem) ?? []
      list.push({ index: Number(match[1]), path, size })
      splits.set(stem, list)
    } else {
      singles.push({ path, size })
    }
  }

  const groups: FileGroup[] = singles.map((entry) => ({
    label: quantLabel(entry.path),
    paths: [entry.path],
    totalBytes: entry.size,
  }))

  for (const [stem, parts] of splits) {
    parts.sort((a, b) => a.index - b.index)
    groups.push({
      label: quantLabel(stem),
      paths: parts.map((part) => part.path),
      totalBytes: parts.reduce((sum, part) => sum + part.size, 0),
    })
  }

  // Largest first: the biggest build is the one people are usually after, and the
  // small ones follow it down the list.
  groups.sort((a, b) => b.totalBytes - a.totalBytes)
  return groups
}

/**
 * The name Ollama knows this file by.
 *
 * Ollama pulls a Hugging Face repository directly, addressing one quantisation
 * as `hf.co/owner/repo:Q4_K_M`. Turning the repo and the quant label into that
 * string is what lets a model found on the web be downloaded with the engine the
 * user already has, instead of only by an engine this app would have to host.
 */
export function ollamaRef(repo: string, label: string): string {
  const quant = label.toLowerCase().replace(/[^a-z0-9]+/g, "_")
  return `hf.co/${repo}:${quant}`
}

/**
 * Direct link to one file, for an engine that fetches weights itself.
 *
 * Both halves are escaped a segment at a time. Escaping the repository as a
 * whole would turn its slash into %2F, which this route answers 400 for; not
 * escaping it at all leaves a raw space in the URL for any repository whose
 * name has one.
 */
export function fileUrl(repo: string, path: string): string {
  const owner = repo.split("/").map(encodeURIComponent).join("/")
  return `${HF}/${owner}/resolve/main/${path.split("/").map(encodeURIComponent).join("/")}`
}

/**
 * The quantisation a file name declares, for display and for the engine's
 * reference.
 *
 * Exported because this is the piece that was wrong once already: a name cut
 * short here offers a quantisation that does not exist, and Ollama rejects
 * such a tag outright, so the download fails complaining about a tag rather
 * than about a file.
 */
export function quantLabel(path: string): string {
  const filename = path.split("/").pop() ?? path
  const match = QUANT.exec(filename)
  return match ? match[0].toUpperCase() : filename
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`Hugging Face ответил ${response.status}`)
  return (await response.json()) as T
}
