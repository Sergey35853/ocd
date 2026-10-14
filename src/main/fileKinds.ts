import { extname } from "node:path"

/**
 * What kind of file this is, from its name alone.
 *
 * No Electron and no file system, so it can be reasoned about — and tested —
 * on its own. That matters here: everything that decides how a file is typed to
 * the model lives here, and a wrong answer is not visible until a model has
 * already been handed base64 where text was meant.
 */

/** Formats the chat can show a thumbnail for. */
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".avif"])

/**
 * Source and data files, which are what code and documents are made of.
 *
 * These are sent as `text/plain` on purpose. The server decodes a `text/*` part
 * before handing it to a model, so a Python file arrives as the Python file and
 * can be answered about. Left as `application/octet-stream` it arrives as
 * base64, which is a wall of noise and costs the whole file in tokens.
 */
const TEXT_EXT = new Set([
  // Code.
  ".py", ".pyi", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts",
  ".java", ".kt", ".kts", ".scala", ".go", ".rs", ".rb", ".php", ".pl", ".pm",
  ".lua", ".r", ".jl", ".dart", ".swift", ".m", ".mm", ".cs", ".fs", ".fsx",
  ".vb", ".hs", ".ml", ".mli", ".erl", ".ex", ".exs", ".clj", ".cljs", ".zig",
  ".nim", ".v", ".sol", ".sql", ".sh", ".bash", ".zsh", ".ps1", ".psm1", ".bat",
  ".cmd", ".fish", ".vue", ".svelte", ".astro", ".gradle", ".cmake", ".make",
  ".mk", ".dockerfile", ".tf", ".tfvars", ".hcl", ".proto", ".graphql", ".gql",
  // Markup, data, config.
  ".html", ".htm", ".xhtml", ".css", ".scss", ".sass", ".less", ".xml", ".xsl",
  ".json", ".jsonc", ".json5", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf",
  ".env", ".properties", ".csv", ".tsv", ".txt", ".md", ".mdx", ".rst", ".adoc",
  ".tex", ".bib", ".diff", ".patch", ".log", ".gitignore", ".editorconfig",
  // Notebooks, which are JSON but are read as code.
  ".ipynb",
])

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".heic": "image/heic",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".epub": "application/epub+zip",
  ".zip": "application/zip",
  ".7z": "application/x-7z-compressed",
  ".rar": "application/vnd.rar",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".exe": "application/vnd.microsoft.portable-executable",
  ".dll": "application/vnd.microsoft.portable-executable",
  ".lnk": "application/x-ms-shortcut",
  ".url": "application/x-ms-url",
}

/**
 * The MIME a file of this name should be described as.
 *
 * No extension at all is text far more often than not — Makefile, Dockerfile,
 * LICENSE, .gitignore. An extension nobody recognises is not: `data.bin` is
 * bytes, and calling it text hands the model a file full of replacement
 * characters.
 */
export function mimeOf(path: string): string {
  const ext = extname(path).toLowerCase()
  const known = MIME_BY_EXT[ext]
  if (known) return known
  if (TEXT_EXT.has(ext)) return "text/plain"
  return ext ? "application/octet-stream" : "text/plain"
}

export function isImage(path: string): boolean {
  return IMAGE_EXT.has(extname(path).toLowerCase())
}

/** Whether a dropped file is a pointer rather than a thing in itself. */
export function isShortcut(path: string): boolean {
  const ext = extname(path).toLowerCase()
  return ext === ".lnk" || ext === ".url"
}

/**
 * One spelling of a path, for comparing two of them.
 *
 * A dropped path arrives with whatever separators the drag gave it, while a
 * walk builds its own with `join`, so the same file can be written two ways.
 * Windows does not care about the difference; a `Set` lookup very much does.
 */
export function samePath(path: string): string {
  return path.replace(/\//g, "\\").toLowerCase()
}

/**
 * The file name to give something that arrived as bytes.
 *
 * An extension is invented only for an image, and only when the name has none:
 * a paste of a screenshot has nothing to go on, while a dropped file carries
 * its own and appending to that renames it and tells the model it is something
 * it is not. A dropped `Makefile` is text and must not come back as
 * `Makefile.png`.
 */
export function nameForBytes(nameHint: string, mime: string): string {
  if (extname(nameHint) !== "") return nameHint
  if (!mime.startsWith("image/")) return nameHint
  const ext = mime === "image/jpeg" ? ".jpg" : mime === "image/webp" ? ".webp" : ".png"
  return `${nameHint}${ext}`
}
