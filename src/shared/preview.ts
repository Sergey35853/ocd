/**
 * What the preview pane can display, and what it takes to get there.
 *
 * Shared by the main process (which picks a conversion route) and the renderer
 * (which labels the entry points), so the two can never disagree about which
 * extension is previewable.
 */

export type PreviewKind =
  /** Markup the pane runs as-is. */
  | "markup"
  /** A still or animated picture, including SVG. */
  | "image"
  /** Motion pictures with sound. */
  | "video"
  /** Documents Chromium ships a viewer for. */
  | "pdf"
  /** Prose documents: .doc/.docx/.odt/.rtf */
  | "document"
  /** Tabular data: .xls/.xlsx/.ods/.csv/.tsv */
  | "sheet"
  /** Slide decks: .ppt/.pptx/.odp */
  | "slides"

/** How a file becomes something the pane can render. */
export type PreviewRoute =
  /** Chromium renders it directly — no external tool. */
  | "native"
  /** LibreOffice turns it into a PDF, preserving the layout. */
  | "office"
  /** ffmpeg rasterises it into a still. */
  | "raster"

interface Spec {
  kind: PreviewKind
  route: PreviewRoute
}

/**
 * Verified against Electron 44 rather than guessed: the `native` entries are
 * the formats a <webview> actually renders, confirmed by loading each one.
 * The rest are grouped by the converter that can read them.
 */
const SPECS: Record<string, Spec> = {
  // ---- native ----
  html: { kind: "markup", route: "native" },
  htm: { kind: "markup", route: "native" },
  xhtml: { kind: "markup", route: "native" },
  svg: { kind: "image", route: "native" },
  svgz: { kind: "image", route: "native" },
  png: { kind: "image", route: "native" },
  apng: { kind: "image", route: "native" },
  jpg: { kind: "image", route: "native" },
  jpeg: { kind: "image", route: "native" },
  jfif: { kind: "image", route: "native" },
  jpe: { kind: "image", route: "native" },
  gif: { kind: "image", route: "native" },
  webp: { kind: "image", route: "native" },
  avif: { kind: "image", route: "native" },
  bmp: { kind: "image", route: "native" },
  ico: { kind: "image", route: "native" },
  cur: { kind: "image", route: "native" },
  mp4: { kind: "video", route: "native" },
  m4v: { kind: "video", route: "native" },
  webm: { kind: "video", route: "native" },
  mov: { kind: "video", route: "native" },
  ogv: { kind: "video", route: "native" },
  mkv: { kind: "video", route: "native" },
  avi: { kind: "video", route: "native" },
  pdf: { kind: "pdf", route: "native" },

  // ---- LibreOffice ----
  doc: { kind: "document", route: "office" },
  docx: { kind: "document", route: "office" },
  docm: { kind: "document", route: "office" },
  odt: { kind: "document", route: "office" },
  rtf: { kind: "document", route: "office" },
  xls: { kind: "sheet", route: "office" },
  xlsx: { kind: "sheet", route: "office" },
  xlsm: { kind: "sheet", route: "office" },
  ods: { kind: "sheet", route: "office" },
  csv: { kind: "sheet", route: "office" },
  tsv: { kind: "sheet", route: "office" },
  ppt: { kind: "slides", route: "office" },
  pptx: { kind: "slides", route: "office" },
  pptm: { kind: "slides", route: "office" },
  odp: { kind: "slides", route: "office" },

  // ---- ffmpeg ----
  tif: { kind: "image", route: "raster" },
  tiff: { kind: "image", route: "raster" },
  ppm: { kind: "image", route: "raster" },
  pgm: { kind: "image", route: "raster" },
  pbm: { kind: "image", route: "raster" },
  pnm: { kind: "image", route: "raster" },
  tga: { kind: "image", route: "raster" },
  icb: { kind: "image", route: "raster" },
  vda: { kind: "image", route: "raster" },
  vst: { kind: "image", route: "raster" },
  jp2: { kind: "image", route: "raster" },
  j2k: { kind: "image", route: "raster" },
  jpf: { kind: "image", route: "raster" },
  jpx: { kind: "image", route: "raster" },
  jpm: { kind: "image", route: "raster" },
  exr: { kind: "image", route: "raster" },
  hdr: { kind: "image", route: "raster" },
  psd: { kind: "image", route: "raster" },
  pcx: { kind: "image", route: "raster" },
  dds: { kind: "image", route: "raster" },
  pict: { kind: "image", route: "raster" },
  sgi: { kind: "image", route: "raster" },
  xbm: { kind: "image", route: "raster" },
  xpm: { kind: "image", route: "raster" },
  wbmp: { kind: "image", route: "raster" },
  // Chromium has no HEIF demuxer and neither winget build of ffmpeg ships one,
  // so these are read by ImageMagick, which bundles libheif.
  heic: { kind: "image", route: "raster" },
  heif: { kind: "image", route: "raster" },
  avci: { kind: "image", route: "raster" },
}

/** Formats no installed converter can be relied on to read. */
export const UNSUPPORTED_EXTENSIONS = new Set([
  "psb",
  "ai",
  "cdr",
  "sketch",
  "fig",
  "xd",
])

export function previewSpec(path: string): Spec | null {
  const match = /\.([a-z0-9]+)$/i.exec(path.trim())
  if (!match) return null
  return SPECS[match[1].toLowerCase()] ?? null
}

export function previewKind(path: string): PreviewKind | null {
  return previewSpec(path)?.kind ?? null
}

export function previewRoute(path: string): PreviewRoute | null {
  return previewSpec(path)?.route ?? null
}
/** What the pane ended up showing for a given file. Produced by the main
 * process, which is the only side that knows which converter ran. */
export interface PreparedPreview {
  /** file:// URL the pane loads. */
  url: string
  kind: PreviewKind
  /** Which route produced `url`: the file itself, or a converted copy. */
  route: PreviewRoute
  /** Set when the file cannot be shown; the pane explains it. */
  error?:
    | "missing"
    | "office-missing"
    | "office-failed"
    | "raster-missing"
    | "raster-failed"
    | "unsupported"
}
