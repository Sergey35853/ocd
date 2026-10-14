import { describe, expect, it } from "vitest"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { renderVsdx, vsdxPages, vsdxReadable } from "./vsdx"

/**
 * Build a ZIP with stored (uncompressed) entries.
 *
 * The renderer reads .vsdx through its own minimal ZIP reader, so a test that
 * used a real archive would only prove that the two agree. Writing the archive
 * here keeps the fixture self-contained and lets it run in CI, where nobody has
 * a Visio file to hand.
 */
function zip(entries: Record<string, string>): Buffer {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const [name, text] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, "utf8")
    const data = Buffer.from(text, "utf8")

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8) // stored
    local.writeUInt32LE(0, 10) // time
    local.writeUInt32LE(0, 14) // date
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    chunks.push(local, nameBuf, data)

    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(20, 4)
    dir.writeUInt16LE(20, 6)
    dir.writeUInt16LE(0, 10)
    dir.writeUInt32LE(data.length, 20)
    dir.writeUInt32LE(data.length, 24)
    dir.writeUInt16LE(nameBuf.length, 28)
    dir.writeUInt32LE(offset, 42)
    central.push(dir, nameBuf)

    offset += local.length + nameBuf.length + data.length
  }

  const dirBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(Object.keys(entries).length, 8)
  eocd.writeUInt16LE(Object.keys(entries).length, 10)
  eocd.writeUInt32LE(dirBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)

  return Buffer.concat([...chunks, dirBuf, eocd])
}

/** One rectangle plus a label, in the shape the renderer has to understand. */
function shape(id: string, pinX: number, pinY: number, width: number, height: number, label: string): string {
  return (
    `<Shape ID='${id}' Type='Shape'>` +
    `<Cell N='PinX' V='${pinX}'/><Cell N='PinY' V='${pinY}'/>` +
    `<Cell N='Width' V='${width}'/><Cell N='Height' V='${height}'/>` +
    `<Cell N='LocPinX' V='${width / 2}'/><Cell N='LocPinY' V='${height / 2}'/>` +
    `<Cell N='Angle' V='0'/><Cell N='FlipX' V='0'/><Cell N='FlipY' V='0'/>` +
    `<Cell N='FillForegnd' V='#00b050'/>` +
    `<Section N='Geometry' IX='0'>` +
    `<Row T='MoveTo'><Cell N='X' V='0'/><Cell N='Y' V='0'/></Row>` +
    `<Row T='LineTo'><Cell N='X' V='${width}'/><Cell N='Y' V='0'/></Row>` +
    `<Row T='LineTo'><Cell N='X' V='${width}'/><Cell N='Y' V='${height}'/></Row>` +
    `<Row T='LineTo'><Cell N='X' V='0'/><Cell N='Y' V='${height}'/></Row>` +
    `</Section><Text>${label}</Text></Shape>`
  )
}

function buildDrawing(pages: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "vsdx-"))
  const rels = Object.entries(pages)
    .map((_, i) => `<Relationship Id='rId${i + 1}' Target='page${i + 1}.xml'/>`)
    .join("")
  const entries: Record<string, string> = {
    "visio/pages/pages.xml":
      `<Pages>${pages
        .map((name, i) => `<Page ID='${i}' Name='${name}'><Rel r:id='rId${i + 1}'/></Page>`)
        .join("")}</Pages>`,
    "visio/pages/_rels/pages.xml.rels": `<Relationships>${rels}</Relationships>`,
  }
  pages.forEach((_, i) => {
    entries[`visio/pages/page${i + 1}.xml`] =
      `<PageContents><Shapes>${shape(`${i}a`, 1, 1, 2, 1, "первая")}${shape(
        `${i}b`,
        4,
        3,
        1,
        1,
        "вторая",
      )}</Shapes></PageContents>`
  })
  const file = join(dir, "drawing.vsdx")
  writeFileSync(file, zip(entries))
  return file
}

describe("vsdx", () => {
  it("lists pages in document order with their part names", () => {
    const path = buildDrawing(["Первая", "Вторая"])
    expect(vsdxPages(path).map((page) => page.name)).toEqual(["Первая", "Вторая"])
    // The target in the relationship is relative to visio/pages/, so getting
    // this wrong looks up an entry that does not exist.
    expect(vsdxPages(path)[0].entry).toBe("visio/pages/page1.xml")
  })

  it("reports a file that is not a drawing as unreadable", () => {
    const dir = mkdtempSync(join(tmpdir(), "vsdx-"))
    const file = join(dir, "plain.vsdx")
    writeFileSync(file, "not a zip at all")
    expect(vsdxReadable(file)).toBe(false)
    expect(() => renderVsdx(file)).toThrow()
  })

  it("renders a page's shapes, colours and labels", () => {
    const path = buildDrawing(["Схема"])
    const result = renderVsdx(path)

    expect(result.pageName).toBe("Схема")
    expect(result.pageCount).toBe(1)
    expect(result.shapes).toBe(2)
    expect(result.svg).toContain('fill="#00b050"')
    expect(result.svg).toContain("первая")
    expect(result.svg).toContain("вторая")
    expect(result.svg.startsWith("<svg")).toBe(true)
  })

  it("treats relative rows as fractions of the shape, not inches", () => {
    // A 6x1 box drawn with RelLineTo(1,0) must come out 6 wide. Reading the
    // delta as an inch produced a 1x1 box the first time round.
    // One relative segment of 1.0 across a 6-inch box: read as a fraction the
    // line is 6 long, read as an inch it is 1 — which is what the first
    // version did, turning the drawing into a heap of oversized wedges.
    const dir = mkdtempSync(join(tmpdir(), "vsdx-"))
    const entries: Record<string, string> = {
      "visio/pages/pages.xml": `<Pages><Page ID='0' Name='rel'><Rel r:id='rId1'/></Page></Pages>`,
      "visio/pages/_rels/pages.xml.rels": `<Relationships><Relationship Id='rId1' Target='page1.xml'/></Relationships>`,
      "visio/pages/page1.xml":
        `<PageContents><Shapes><Shape ID='1' Type='Shape'>` +
        `<Cell N='PinX' V='3'/><Cell N='PinY' V='0.5'/>` +
        `<Cell N='Width' V='6'/><Cell N='Height' V='1'/>` +
        `<Cell N='LocPinX' V='3'/><Cell N='LocPinY' V='0.5'/>` +
        `<Cell N='Angle' V='0'/><Cell N='FlipX' V='0'/><Cell N='FlipY' V='0'/>` +
        `<Cell N='FillForegnd' V='#112233'/>` +
        `<Section N='Geometry' IX='0'>` +
        `<Row T='RelMoveTo'><Cell N='X' V='0'/><Cell N='Y' V='0'/></Row>` +
        `<Row T='RelLineTo'><Cell N='X' V='1'/><Cell N='Y' V='1'/></Row>` +
        `</Section></Shape></Shapes></PageContents>`,
    }
    const file = join(dir, "rel.vsdx")
    writeFileSync(file, zip(entries))

    const result = renderVsdx(file)
    // Measure inside the path only: scanning the whole document picks up
    // coordinates from elsewhere in the SVG.
    const d = /<path d="([^"]*)"/.exec(result.svg)?.[1] ?? ""
    const pairs = [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [
      Number.parseFloat(m[1]),
      Number.parseFloat(m[2]),
    ])
    expect(pairs.length).toBe(2)
    expect(Math.abs(pairs[1][0] - pairs[0][0])).toBeCloseTo(6, 3)
    expect(Math.abs(pairs[1][1] - pairs[0][1])).toBeCloseTo(1, 3)
  })

  it("renders only the requested page", () => {
    const path = buildDrawing(["Раз", "Два"])
    expect(renderVsdx(path, 1).pageName).toBe("Два")
    // Out of range clamps rather than throwing: a stale index should still
    // show something.
    expect(renderVsdx(path, 99).pageName).toBe("Два")
  })
})