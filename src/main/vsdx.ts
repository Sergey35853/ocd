/**
 * Reader and SVG renderer for Visio drawings (.vsdx/.vsdm).
 *
 * Why this exists instead of a LibreOffice round-trip: a .vsdx is a ZIP of
 * DrawingML, and current LibreOffice builds ship no Visio import at all —
 * `soffice --convert-to pdf` on a perfectly valid drawing answers "source file
 * could not be loaded". The file this was written for has a single page of
 * 10,572 shapes and 18 MB of XML, comfortably past what that importer would
 * ever swallow. Reading the geometry directly also keeps the feature free of
 * dependencies.
 *
 * What it is: a faithful schematic. Each shape's own geometry, placement,
 * rotation and colour are honoured. What is skipped is Visio's styling layer —
 * master shapes, connector gluing, field substitution and text block fitting.
 * Master-derived geometry still draws, because Visio writes every shape's
 * resolved geometry into the page regardless of where the shape came from.
 */

import { readFileSync } from "node:fs"
import { inflateRawSync } from "node:zlib"

// ---------------------------------------------------------------------------
// Minimal ZIP reader
// ---------------------------------------------------------------------------

/**
 * Read one entry out of a ZIP archive.
 *
 * Only what OPC packages use: stored and deflated entries, no encryption, no
 * split archives. A full implementation would be a dependency, and having none
 * is the point of this module.
 */
function zipEntry(path: string, name: string): Buffer | null {
  const buf = readFileSync(path)

  // The central directory is at the end, but the EOCD comment can push it back
  // by up to 64 KB, so scan backwards for the signature.
  let eocd = -1
  const floor = Math.max(0, buf.length - 22 - 0x10000)
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return null

  const count = buf.readUInt16LE(eocd + 10)
  let offset = buf.readUInt32LE(eocd + 16)

  for (let i = 0; i < count; i++) {
    if (offset + 46 > buf.length) return null
    if (buf.readUInt32LE(offset) !== 0x02014b50) return null

    const method = buf.readUInt16LE(offset + 10)
    const compressedSize = buf.readUInt32LE(offset + 20)
    const nameLength = buf.readUInt16LE(offset + 28)
    const extraLength = buf.readUInt16LE(offset + 30)
    const commentLength = buf.readUInt16LE(offset + 32)
    const localOffset = buf.readUInt32LE(offset + 42)
    const entryName = buf.toString("utf8", offset + 46, offset + 46 + nameLength)
    offset += 46 + nameLength + extraLength + commentLength

    if (entryName !== name) continue

    // The local header repeats name and extra with its own lengths.
    const localNameLength = buf.readUInt16LE(localOffset + 26)
    const localExtraLength = buf.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const raw = buf.subarray(start, start + compressedSize)

    if (method === 0) return Buffer.from(raw)
    if (method === 8) {
      try {
        return inflateRawSync(raw)
      } catch {
        return null
      }
    }
    return null
  }

  return null
}

function zipEntryText(path: string, name: string): string | null {
  const data = zipEntry(path, name)
  return data ? data.toString("utf8") : null
}

// ---------------------------------------------------------------------------
// Tag helpers
// ---------------------------------------------------------------------------

/**
 * One attribute out of a start tag.
 *
 * Visio writes single-quoted attributes; Office generally writes double
 * quotes. Both are accepted so the same code reads pages and content types.
 */
function attr(tag: string, name: string): string | null {
  const single = new RegExp(`\\b${name}='([^']*)'`).exec(tag)
  if (single) return single[1]
  const double = new RegExp(`\\b${name}="([^"]*)"`).exec(tag)
  return double ? double[1] : null
}

function num(value: string | null | undefined): number {
  if (value === null || value === undefined) return 0
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const CELL_RE = /<Cell\b([^>]*?)\/>/g
const ROW_OPEN_RE = /<Row\b([^>]*)>/g
const SECTION_OPEN_RE = /<Section\b([^>]*)>/g

/** Every self-closed <Cell> in a chunk, as name -> numeric value. */
function cellsOf(chunk: string): Map<string, number> {
  const out = new Map<string, number>()
  CELL_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CELL_RE.exec(chunk)) !== null) {
    const name = attr(match[1], "N")
    if (name === null) continue
    const value = attr(match[1], "V")
    if (value === null) continue
    out.set(name, num(value))
  }
  return out
}

/** Raw text of one cell element, or null. */
function cellTag(chunk: string, name: string): string | null {
  return new RegExp(`<Cell\\b[^>]*\\bN='${name}'[^>]*/>`).exec(chunk)?.[0] ?? null
}

/** Formula of one cell, for the few rows whose points live only there. */
function cellFormula(chunk: string, name: string): string | null {
  const tag = cellTag(chunk, name)
  return tag ? attr(tag, "F") : null
}

// ---------------------------------------------------------------------------
// Page list
// ---------------------------------------------------------------------------

export interface VsdxPage {
  index: number
  name: string
  /** ZIP entry holding this page's XML. */
  entry: string
}

/**
 * Turn a relationship target into a ZIP entry name.
 *
 * Targets in `visio/pages/_rels/pages.xml.rels` are written relative to
 * `visio/pages/` ("page1.xml"), while some producers write them package-
 * absolute ("visio/pages/page1.xml"). Both have to land on the same entry.
 */
function pageEntryFor(target: string): string {
  const clean = target.replace(/^\.\//, "").replace(/^\//, "")
  return clean.startsWith("visio/") ? clean : `visio/pages/${clean}`
}

/**
 * Pages in the order Visio shows them.
 *
 * The link to each page's part is a child `<Rel r:id='...'/>` at the end of the
 * page, not an attribute of `<Page>` itself, and the page elements carry
 * children rather than closing on their opening tag — both of which a naive
 * `<Page ... />` scan misses. The id is then resolved through the relationship
 * part instead of assuming `pageN.xml`, since editors do renumber those.
 */
export function vsdxPages(path: string): VsdxPage[] {
  const pagesXml = zipEntryText(path, "visio/pages/pages.xml")
  const relsXml = zipEntryText(path, "visio/pages/_rels/pages.xml.rels")
  if (!pagesXml || !relsXml) return []

  const targets = new Map<string, string>()
  const relRe = /<Relationship\b([^>]*)\/>/g
  let rel: RegExpExecArray | null
  while ((rel = relRe.exec(relsXml)) !== null) {
    const id = attr(rel[1], "Id")
    const target = attr(rel[1], "Target")
    if (id && target) targets.set(id, pageEntryFor(target))
  }

  const out: VsdxPage[] = []
  const pageRe = /<Page\b([^>]*)>([\s\S]*?)<\/Page>/g
  let page: RegExpExecArray | null
  while ((page = pageRe.exec(pagesXml)) !== null) {
    const id = /<Rel\b[^>]*\br:id='([^']*)'/.exec(page[2])?.[1]
    const entry = id ? targets.get(id) : undefined
    if (!entry) continue
    out.push({
      index: out.length,
      name: attr(page[1], "Name") ?? `Страница ${out.length + 1}`,
      entry,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

interface Point {
  x: number
  y: number
}

interface SubPath {
  points: Point[]
}

/** Straight segments per quarter turn when a curve is flattened. */
const SEGMENTS_PER_QUARTER = 8

/** Shape extent used to normalise polyline points, which are unit-square. */
interface Extent {
  width: number
  height: number
}

/**
 * Flatten one geometry row into local-space points and return the new cursor.
 *
 * Everything becomes a polyline on purpose. A path, an arc and an ellipse then
 * all pass through the same rotation and flip below instead of each needing its
 * own transform maths, which is where this kind of renderer usually goes wrong.
 */
function rowPoints(row: string, current: Point | null, out: Point[], extent: Extent): Point | null {
  const kind = attr(row, "T")
  const cells = cellsOf(row)
  const x = cells.get("X") ?? 0
  const y = cells.get("Y") ?? 0

  switch (kind) {
    case "MoveTo":
      out.push({ x, y })
      return { x, y }

    case "RelMoveTo": {
      // Relative rows are normalised: the deltas are fractions of the shape's
      // own Width and Height, not inches. Reading them as inches turns a
      // 6-inch box into a 6x6 square — which is what the first version did.
      const from = current ?? { x: 0, y: 0 }
      const next = { x: from.x + x * extent.width, y: from.y + y * extent.height }
      out.push(next)
      return next
    }

    case "LineTo":
      out.push({ x, y })
      return { x, y }

    case "RelLineTo": {
      const from = current ?? { x: 0, y: 0 }
      const next = { x: from.x + x * extent.width, y: from.y + y * extent.height }
      out.push(next)
      return next
    }

    case "PolylineTo": {
      // The point list survives only in the formula; the value holds the last
      // point alone. Visio normalises these to the unit square and scales by
      // Width and Height, so that is how they read back.
      const formula = cellFormula(row, "A") ?? ""
      const call = /POLYLINE\(([^)]*)\)/i.exec(formula)
      if (!call) {
        out.push({ x, y })
        return { x, y }
      }
      const nums = call[1]
        .split(",")
        .map((part) => Number.parseFloat(part.trim()))
        .filter((n) => Number.isFinite(n))
      for (let i = 0; i + 1 < nums.length; i += 2) {
        out.push({ x: nums[i] * extent.width, y: nums[i + 1] * extent.height })
      }
      const last = out[out.length - 1]
      return last ?? { x, y }
    }

    case "Ellipse": {
      // Centre plus radii. Flattened rather than emitted as <ellipse> so it
      // rides the same transform as everything else.
      const rx = cells.get("A") ?? 0
      const ry = cells.get("B") ?? 0
      const steps = Math.max(24, SEGMENTS_PER_QUARTER * 4)
      for (let i = 0; i < steps; i++) {
        const t = (i / steps) * Math.PI * 2
        out.push({ x: x + Math.cos(t) * rx, y: y + Math.sin(t) * ry })
      }
      return { x, y }
    }

    case "EllipticalArcTo":
    case "ArcTo": {
      const from = current ?? { x, y }
      const rx = Math.abs(cells.get("A") ?? 0)
      const ry = Math.abs(cells.get("B") ?? 0)
      const startAngle = cells.get("C") ?? 0
      const endAngle = cells.get("D") ?? 0

      if (rx < 1e-9 || ry < 1e-9) {
        out.push({ x, y })
        return { x, y }
      }
      // Visio leaves the angles at zero when the row is really a chord; there
      // is no arc to flatten in that case.
      if (startAngle === 0 && endAngle === 0) {
        out.push({ x, y })
        return { x, y }
      }

      let sweep = endAngle - startAngle
      while (sweep <= -Math.PI) sweep += Math.PI * 2
      while (sweep > Math.PI) sweep -= Math.PI * 2

      // Recover the ellipse centre from the start point and its angle.
      const cx = from.x - Math.cos(startAngle) * rx
      const cy = from.y - Math.sin(startAngle) * ry
      const steps = Math.max(
        2,
        Math.round((Math.abs(sweep) / (Math.PI / 2)) * SEGMENTS_PER_QUARTER),
      )
      for (let i = 1; i <= steps; i++) {
        const t = startAngle + (sweep * i) / steps
        out.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry })
      }
      return { x, y }
    }

    default: {
      // NURBS knot lists live in the formula and are not worth a full
      // evaluator; the chord keeps the shape present and in the right place.
      if (kind === "NURBSTo" || kind === "RelCubBezTo" || kind === "RelQuadBezTo" || kind === "Invis") {
        out.push({ x, y })
        return { x, y }
      }
      return current
    }
  }
}

/**
 * Split a chunk into its <Shape> elements, nesting-aware.
 *
 * `from` skips the element's own opening tag. A group chunk contains the group
 * itself at offset 0, so scanning a group from 0 would yield the group again
 * and recurse forever.
 */
function* shapesIn(chunk: string, from = 0): Generator<string> {
  let index = from
  for (;;) {
    const open = chunk.indexOf("<Shape ", index)
    if (open < 0) return

    let depth = 0
    let cursor = open
    let end = -1
    for (;;) {
      const nextOpen = chunk.indexOf("<Shape ", cursor + 1)
      const nextClose = chunk.indexOf("</Shape>", cursor + 1)
      if (nextClose < 0) return
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth++
        cursor = nextOpen
      } else {
        if (depth === 0) {
          end = nextClose + 8
          break
        }
        depth--
        cursor = nextClose
      }
    }

    yield chunk.slice(open, end)
    index = end
  }
}

// ---------------------------------------------------------------------------
// Drawing model
// ---------------------------------------------------------------------------

interface PathPrim {
  kind: "path"
  /** Flat x,y pairs, already in page space. */
  points: number[]
  fill: string
  /** 1 = opaque. Visio stores transparency, so this is derived, not read. */
  fillOpacity: number
  stroke: string
  weight: number
}

interface TextPrim {
  kind: "text"
  x: number
  y: number
  fill: string
  size: number
  label: string
}

type Prim = PathPrim | TextPrim

/** Past this a single page stops being a drawing and becomes a hang. */
const SHAPE_CAP = 30_000

const esc = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

/** Visio writes '#rrggbb'; anything else means "not specified". */
function paint(tag: string | null, fallback: string): string {
  const value = tag ? attr(tag, "V") : null
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
}

/** Collect the outline sub-paths of one shape, in its local coordinates. */
function localSubPaths(chunk: string, extent: Extent): SubPath[] {
  const out: SubPath[] = []
  let current: Point | null = null
  let active: Point[] = []

  SECTION_OPEN_RE.lastIndex = 0
  let section: RegExpExecArray | null
  while ((section = SECTION_OPEN_RE.exec(chunk)) !== null) {
    if (attr(section[1], "N") !== "Geometry") continue
    // Geometry IX=0 is the outline; any other index is a user guide.
    if (attr(section[1], "IX") !== "0") continue

    const close = chunk.indexOf("</Section>", SECTION_OPEN_RE.lastIndex)
    const body = chunk.slice(SECTION_OPEN_RE.lastIndex, close < 0 ? undefined : close)

    ROW_OPEN_RE.lastIndex = 0
    let row: RegExpExecArray | null
    while ((row = ROW_OPEN_RE.exec(body)) !== null) {
      const kind = attr(row[1], "T")
      if (!kind || kind === "Connection") continue

      const rowClose = body.indexOf("</Row>", ROW_OPEN_RE.lastIndex)
      // From the opening tag, not after it: the row's type lives in T='...'
      // on the tag itself, and a body without it is unreadable.
      const rowBody = body.slice(row.index, rowClose < 0 ? undefined : rowClose + 6)

      if (kind === "MoveTo" || kind === "RelMoveTo") {
        if (active.length > 1) out.push({ points: active })
        active = []
      }
      current = rowPoints(rowBody, current, active, extent)
    }
  }
  if (active.length > 1) out.push({ points: active })
  return out
}

interface EmitState {
  count: number
  truncated: boolean
  prims: Prim[]
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Turn one <Shape> chunk into primitives in page space. */
function emitShape(chunk: string, state: EmitState, defaultTextSize: number, depth = 0): void {
  if (state.count >= SHAPE_CAP) {
    state.truncated = true
    return
  }
  // Groups nest, and a malformed drawing could nest forever; Visio itself is
  // happy past a dozen levels, so this only ever catches damage.
  if (depth > 32) return

  const open = /^<Shape\b[^>]*>/.exec(chunk)?.[0] ?? ""
  const type = attr(open, "Type") ?? "Shape"
  const cells = cellsOf(chunk)

  const pinX = cells.get("PinX") ?? 0
  const pinY = cells.get("PinY") ?? 0
  const locPinX = cells.get("LocPinX") ?? 0
  const locPinY = cells.get("LocPinY") ?? 0
  const angle = cells.get("Angle") ?? 0
  const flipX = (cells.get("FlipX") ?? 0) !== 0 ? -1 : 1
  const flipY = (cells.get("FlipY") ?? 0) !== 0 ? -1 : 1
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)

  // Local coordinates are measured from the pin inside the shape. Getting this
  // one transform right is what puts every shape in the right place.
  const project = (x: number, y: number): Point => {
    const dx = (x - locPinX) * flipX
    const dy = (y - locPinY) * flipY
    return { x: pinX + dx * cos - dy * sin, y: pinY + dx * sin + dy * cos }
  }

  const extent: Extent = { width: cells.get("Width") ?? 1, height: cells.get("Height") ?? 1 }
  const subs = localSubPaths(chunk, extent)

  const noFill = (cells.get("NoFill") ?? 0) !== 0
  const noLine = (cells.get("NoLine") ?? 0) !== 0
  const fill = noFill ? "none" : paint(cellTag(chunk, "FillForegnd"), "#dfe7f3")
  const stroke = noLine ? "none" : paint(cellTag(chunk, "LineColor"), "#1b2733")
  const weight = Math.max(cells.get("LineWeight") ?? 0.006, 0.002)

  state.count++

  if (subs.length) {
    const points: number[] = []
    for (const sub of subs) {
      for (const p of sub.points) {
        const page = project(p.x, p.y)
        points.push(page.x, page.y)
        if (page.x < state.minX) state.minX = page.x
        if (page.x > state.maxX) state.maxX = page.x
        if (page.y < state.minY) state.minY = page.y
        if (page.y > state.maxY) state.maxY = page.y
      }
    }
    // Visio records transparency, not opacity, and a schematic relies on it heavily:
// the coloured blocks are meant to sit under the cable runs that cross them.
const fillTrans = cells.get("FillForegndTrans") ?? 0
const fillOpacity = noFill ? 0 : Math.max(0.08, Math.min(1, 1 - fillTrans))
state.prims.push({
    kind: "path",
    points,
    fill,
    fillOpacity,
    stroke,
    weight,
  })
  }

  const textMatch = /<Text\b[^>]*>([\s\S]*?)<\/Text>/.exec(chunk)
  if (textMatch) {
    const label = decodeEntities(textMatch[1].replace(/<cp\b[^>]*\/>/g, "")).trim()
    if (label) {
      const character = /<Section\b[^>]*N='Character'[^>]*>([\s\S]*?)<\/Section>/.exec(chunk)?.[1] ?? ""
      const sizeTag = cellTag(character, "Size")
      const colorTag = cellTag(character, "Color")
      const size = sizeTag ? num(attr(sizeTag, "V")) || defaultTextSize : defaultTextSize
      const anchor = project(locPinX, locPinY)
      state.minX = Math.min(state.minX, anchor.x)
      state.maxX = Math.max(state.maxX, anchor.x)
      state.minY = Math.min(state.minY, anchor.y)
      state.maxY = Math.max(state.maxY, anchor.y)
      state.prims.push({
        kind: "text",
        x: anchor.x,
        y: anchor.y,
        fill: paint(colorTag, "#101820"),
        size,
        label: label.slice(0, 4000),
      })
    }
  }

  if (type === "Group") {
    // Skip the group's own opening tag, or it is found again as its own child.
    for (const child of shapesIn(chunk, open.length)) emitShape(child, state, defaultTextSize, depth + 1)
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface RenderedVisio {
  svg: string
  shapes: number
  truncated: boolean
  pageName: string
  pageCount: number
  pageIndex: number
}

/** Median label height in inches, for pages whose shapes carry no text size. */
const DEFAULT_TEXT_SIZE = 0.09

/**
 * Render one page of a Visio drawing to a standalone SVG document.
 *
 * Visio's Y axis points up and SVG's points down, so paths go into one group
 * flipped on the Y axis. Text cannot live in that group — it would render
 * mirrored — so labels are emitted separately with their own Y already turned.
 */
export function renderVsdx(path: string, pageIndex = 0): RenderedVisio {
  const pages = vsdxPages(path)
  if (!pages.length) throw new Error("no-pages")

  const page = pages[Math.min(Math.max(pageIndex, 0), pages.length - 1)]
  const xml = zipEntryText(path, page.entry)
  if (!xml) throw new Error("no-page-xml")

  const state: EmitState = {
    count: 0,
    truncated: false,
    prims: [],
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  }

  for (const shape of shapesIn(xml)) emitShape(shape, state, DEFAULT_TEXT_SIZE)

  if (!Number.isFinite(state.minX)) {
    state.minX = 0
    state.minY = 0
    state.maxX = 1
    state.maxY = 1
  }

  const width = Math.max(state.maxX - state.minX, 0.01)
  const height = Math.max(state.maxY - state.minY, 0.01)

  const paths: string[] = []
  const labels: string[] = []

  for (const prim of state.prims) {
    if (prim.kind === "path") {
      if (prim.points.length < 4) continue
      let d = `M${prim.points[0].toFixed(3)} ${prim.points[1].toFixed(3)}`
      for (let i = 2; i + 1 < prim.points.length; i += 2) {
        d += `L${prim.points[i].toFixed(3)} ${prim.points[i + 1].toFixed(3)}`
      }
      d += "Z"
      paths.push(
        `<path d="${d}" fill="${prim.fill}" fill-opacity="${prim.fillOpacity.toFixed(2)}" ` +
          `stroke="${prim.stroke}" stroke-width="${prim.weight.toFixed(4)}" stroke-linejoin="round"/>`,
      )
    } else {
      labels.push(
        `<text x="${(prim.x - state.minX).toFixed(3)}" y="${(state.maxY - prim.y).toFixed(3)}" ` +
          `fill="${prim.fill}" font-size="${prim.size.toFixed(4)}" ` +
          `font-family="'Segoe UI', 'Segoe UI Symbol', sans-serif" ` +
          `text-anchor="middle" dominant-baseline="middle">${esc(prim.label)}</text>`,
      )
    }
  }

  // Sized as a percentage rather than in pixels: the pane's <webview> is the
// viewport, and a drawing whose natural size is 3,000 x 12,000 px should fit
// whatever window it lands in instead of being clipped to its top-left corner.
const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width.toFixed(3)} ${height.toFixed(3)}" ` +
    `width="100%" height="100%" preserveAspectRatio="xMidYMid meet">` +
    `<rect x="0" y="0" width="${width.toFixed(3)}" height="${height.toFixed(3)}" fill="#ffffff"/>` +
    `<g transform="translate(${(-state.minX).toFixed(3)} ${state.maxY.toFixed(3)}) scale(1 -1)">` +
    paths.join("") +
    `</g>` +
    labels.join("") +
    `</svg>`

  return {
    svg,
    shapes: state.count,
    truncated: state.truncated,
    pageName: page.name,
    pageCount: pages.length,
    pageIndex: page.index,
  }
}

export function vsdxReadable(path: string): boolean {
  try {
    return vsdxPages(path).length > 0
  } catch {
    return false
  }
}