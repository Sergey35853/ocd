import { app, shell } from "electron"
import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { basename, extname, join } from "node:path"
import { promisify } from "node:util"
import { previewKind, previewRoute, type PreparedPreview } from "@shared/preview"

const run = promisify(execFile)

/** Schemes the preview pane may hand to the system browser. Everything else
 * (file:, javascript:, data:, custom app protocols) stays inside the pane. */
const EXTERNAL_SCHEMES = new Set(["http:", "https:"])

/** Staged previews are scratch files: keep a day of them, then drop them. */
const RETENTION_MS = 24 * 60 * 60 * 1000

/** Conversion is the slowest thing the pane can do; cap both converters. */
const CONVERT_TIMEOUT_MS = 90_000

function previewDir(): string {
  return join(app.getPath("userData"), "preview")
}

function toFileUrl(path: string): string {
  return `file:///${path.replace(/\\/g, "/")}`
}

/** Best-effort: a preview that cannot be cleaned up is not worth an error. */
function pruneOld(dir: string): void {
  const cutoff = Date.now() - RETENTION_MS
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.startsWith("preview-") || !entry.endsWith(".html")) continue
    const file = join(dir, entry)
    try {
      if (statSync(file).mtimeMs < cutoff) unlinkSync(file)
    } catch {
      /* in use or already gone */
    }
  }
}

/**
 * Stage assistant-authored HTML as a real file so the pane's <webview> can
 * load it over file://. A data: URL would be simpler but caps out well below
 * the size of a typical single-file dashboard.
 *
 * The name is random, so page content can never influence the path.
 */
export function writePreviewFile(html: string): string {
  const dir = previewDir()
  mkdirSync(dir, { recursive: true })
  pruneOld(dir)
  const name = `preview-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}.html`
  const file = join(dir, name)
  writeFileSync(file, html, "utf8")
  return file
}

/**
 * Open a URL the guest asked for in the system browser. The guest only ever
 * forwards a trusted click on an `_blank` anchor, but the scheme check lives
 * here anyway: it is the boundary that keeps `javascript:` and `file:` out of
 * the OS handler.
 */
export function openPreviewExternal(rawUrl: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (!EXTERNAL_SCHEMES.has(url.protocol)) return false
  void shell.openExternal(url.toString())
  return true
}

// ---------------------------------------------------------------------------
// Converters
// ---------------------------------------------------------------------------

const SOFFICE_CANDIDATES = [
  process.env["ProgramFiles"] && join(process.env["ProgramFiles"], "LibreOffice", "program", "soffice.exe"),
  process.env["ProgramFiles(x86)"] &&
    join(process.env["ProgramFiles(x86)"], "LibreOffice", "program", "soffice.exe"),
  process.env["LOCALAPPDATA"] &&
    join(process.env["LOCALAPPDATA"], "Programs", "LibreOffice", "program", "soffice.exe"),
].filter((p): p is string => Boolean(p))

const FFMPEG_CANDIDATES = [
  process.env["LOCALAPPDATA"] &&
    join(process.env["LOCALAPPDATA"], "Microsoft", "WinGet", "Links", "ffmpeg.exe"),
  process.env["ProgramFiles"] && join(process.env["ProgramFiles"], "ffmpeg", "bin", "ffmpeg.exe"),
  // Bare name: resolved through PATH, which is where a package manager puts it.
  "ffmpeg.exe",
].filter((candidate): candidate is string => Boolean(candidate))

/**
 * ImageMagick is the second rasteriser: ffmpeg has no HEIF demuxer in any of the
 * winget builds, while ImageMagick bundles libheif and reads HEIC/HEIF directly.
 * It also picks up a few formats ffmpeg would need a build flag for.
 */
const MAGICK_CANDIDATES = [
  process.env["ProgramFiles"] && join(process.env["ProgramFiles"], "ImageMagick-7.Q16-HDRI", "magick.exe"),
  process.env["ProgramFiles"] && join(process.env["ProgramFiles"], "ImageMagick-7.Q16", "magick.exe"),
  process.env["ProgramFiles"] &&
    join(process.env["ProgramFiles"], "ImageMagick-7.Q8", "magick.exe"),
  process.env["LOCALAPPDATA"] &&
    join(process.env["LOCALAPPDATA"], "Microsoft", "WinGet", "Links", "magick.exe"),
  // Bare name: resolved through PATH.
  "magick.exe",
].filter((candidate): candidate is string => Boolean(candidate))

/** Cached per run: probing the disk on every preview would be wasteful. */
const toolCache = new Map<string, string | null>()

async function resolveTool(candidates: string[], probe: (path: string) => Promise<boolean>): Promise<string | null> {
  for (const candidate of candidates) {
    const cached = toolCache.get(candidate)
    if (cached !== undefined) return cached
    let ok = false
    try {
      ok = await probe(candidate)
    } catch {
      ok = false
    }
    toolCache.set(candidate, ok ? candidate : null)
    if (ok) return candidate
  }
  return null
}

const findSoffice = () =>
  resolveTool(SOFFICE_CANDIDATES, async (path) => {
    if (!path.includes("\\") && !path.includes("/")) {
      // Bare name: let the OS resolve it through PATH.
      await run("where", [path], { timeout: 10_000, windowsHide: true })
      return true
    }
    return existsSync(path)
  })

const findFfmpeg = () =>
  resolveTool(FFMPEG_CANDIDATES, async (path) => {
    if (!path.includes("\\") && !path.includes("/")) {
      await run("where", [path], { timeout: 10_000, windowsHide: true })
      return true
    }
    return existsSync(path)
  })

const findMagick = () =>
  resolveTool(MAGICK_CANDIDATES, async (path) => {
    if (!path.includes("\\") && !path.includes("/")) {
      await run("where", [path], { timeout: 10_000, windowsHide: true })
      return true
    }
    return existsSync(path)
  })

// Same source, same output: skip a conversion that already happened.
const convertedCache = new Map<string, { mtimeMs: number; out: string }>()

function cachedOutput(path: string): string | null {
  const stamp = statSync(path).mtimeMs
  const hit = convertedCache.get(path)
  if (hit && hit.mtimeMs === stamp && existsSync(hit.out)) return hit.out
  return null
}

function remember(path: string, out: string): void {
  convertedCache.set(path, { mtimeMs: statSync(path).mtimeMs, out })
}

async function convertWithSoffice(path: string): Promise<string> {
  const soffice = await findSoffice()
  if (!soffice) throw new Error("MISSING")

  const hit = cachedOutput(path)
  if (hit) return hit

  const outDir = join(previewDir(), "office")
  mkdirSync(outDir, { recursive: true })
  // A private profile keeps the conversion from queueing behind — or crashing —
  // a LibreOffice window the user has open.
  const profileDir = join(previewDir(), "lo-profile")
  mkdirSync(profileDir, { recursive: true })

  await run(
    soffice,
    [
      "--headless",
      "--norestore",
      "--nolockcheck",
      `-env:UserInstallation=${toFileUrl(profileDir)}`,
      "--convert-to",
      "pdf",
      "--outdir",
      outDir,
      path,
    ],
    { timeout: CONVERT_TIMEOUT_MS, windowsHide: true },
  )

  const produced = join(outDir, `${basename(path, extname(path))}.pdf`)
  if (!existsSync(produced)) throw new Error("NO_OUTPUT")
  remember(path, produced)
  return produced
}

async function rasterWithFfmpeg(path: string): Promise<string> {
  const ffmpeg = await findFfmpeg()
  if (!ffmpeg) throw new Error("MISSING")

  const hit = cachedOutput(path)
  if (hit) return hit

  const outDir = join(previewDir(), "raster")
  mkdirSync(outDir, { recursive: true })
  const stem = `${basename(path, extname(path))}-${randomBytes(4).toString("hex")}`
  const out = join(outDir, `${stem}.png`)

  // -frames:v 1 keeps the first frame of an animation, which is what a still
  // preview wants; PNG is chosen because Chromium renders it losslessly.
  await run(ffmpeg, ["-y", "-i", path, "-frames:v", "1", out], {
    timeout: CONVERT_TIMEOUT_MS,
    windowsHide: true,
  })

  if (!existsSync(out)) throw new Error("NO_OUTPUT")
  remember(path, out)
  return out
}

/**
 * Rasterise with ImageMagick. Used when ffmpeg is absent or has no decoder for
 * the format — HEIC is the case that motivated it.
 */
async function rasterWithMagick(path: string): Promise<string> {
  const magick = await findMagick()
  if (!magick) throw new Error("MISSING")

  const hit = cachedOutput(path)
  if (hit) return hit

  const outDir = join(previewDir(), "raster")
  mkdirSync(outDir, { recursive: true })
  const stem = `${basename(path, extname(path))}-${randomBytes(4).toString("hex")}`
  const out = join(outDir, `${stem}.png`)

  // [0] selects the first frame for an animated source, matching ffmpeg.
  await run(magick, [`${path}[0]`, "-flatten", out], {
    timeout: CONVERT_TIMEOUT_MS,
    windowsHide: true,
  })

  if (!existsSync(out)) throw new Error("NO_OUTPUT")
  remember(path, out)
  return out
}

/** ffmpeg first, ImageMagick second; either one is enough. */
async function rasterise(path: string): Promise<string> {
  try {
    return await rasterWithFfmpeg(path)
  } catch {
    return await rasterWithMagick(path)
  }
}

/**
 * Resolve a file into something the pane can display.
 *
 * Markup, pictures, video and PDF go to Chromium untouched. Office documents go
 * through LibreOffice, exotic stills through ffmpeg. A missing converter is
 * reported rather than thrown so the pane can explain itself instead of
 * showing a raw error.
 */
export async function preparePreview(path: string): Promise<PreparedPreview> {
  const kind = previewKind(path)
  const route = previewRoute(path)

  if (!kind || !route) {
    return { url: toFileUrl(path), kind: kind ?? "image", route: "native", error: "unsupported" }
  }

  if (route === "native") {
    // Chromium will happily render the "file not found" page, so a missing
    // file looks like a broken document rather than a missing one. Checking
    // here is the only place that can tell the user which it was.
    if (!existsSync(path) || statSync(path).isDirectory()) {
      return { url: toFileUrl(path), kind, route, error: "missing" }
    }
    return { url: toFileUrl(path), kind, route }
  }

  try {
    if (route === "office") {
      const pdf = await convertWithSoffice(path)
      return { url: toFileUrl(pdf), kind: "pdf", route: "office" }
    }
    const png = await rasterise(path)
    return { url: toFileUrl(png), kind: "image", route: "raster" }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes("MISSING")) {
      return {
        url: toFileUrl(path),
        kind,
        route: "native",
        error: route === "office" ? "office-missing" : "raster-missing",
      }
    }
    return {
      url: toFileUrl(path),
      kind,
      route: "native",
      error: route === "office" ? "office-failed" : "raster-failed",
    }
  }
}