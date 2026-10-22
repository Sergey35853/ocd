import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import type { MessageInfo } from "@shared/types"
import { sessionChanges } from "../lib/diff"
import { DiffView } from "./DiffView"
import { ChangesPanel } from "./ChangesPanel"

/** A tool call that edited `path` into something else. */
function editOf(path: string): MessageInfo {
  return {
    id: "m1",
    type: "assistant",
    time: { created: 1 },
    content: [
      {
        type: "tool",
        tool: "edit",
        callID: "c1",
        state: {
          status: "completed",
          input: { filePath: path, oldString: "one\ntwo", newString: "one\nTWO" },
        },
      },
    ],
  }
}

/** The panel is only ever rendered with changes, so build a real one. */
function panel(overrides?: Partial<React.ComponentProps<typeof ChangesPanel>>) {
  return renderToStaticMarkup(
    <ChangesPanel
      changes={sessionChanges([editOf("src\\a.ts")])}
      open
      onToggle={() => undefined}
      onOpenFile={() => undefined}
      onToast={() => undefined}
      {...overrides}
    />,
  )
}

describe("DiffView", () => {
  const lines = sessionChanges([
    {
      id: "m",
      type: "assistant",
      time: { created: 1 },
      content: [
        {
          type: "tool",
          tool: "edit",
          callID: "c",
          state: {
            status: "completed",
            input: { filePath: "a.ts", oldString: "one\ntwo", newString: "one\nTWO" },
          },
        },
      ],
    },
  ])[0].lines

  it("renders one row per line, marked as added or removed", () => {
    const html = renderToStaticMarkup(<DiffView lines={lines} />)
    expect(html).toContain("diff-line del")
    expect(html).toContain("diff-line add")
    expect(html).toContain(">two<")
    expect(html).toContain(">TWO<")
  })

  it("counts the change in the header", () => {
    const html = renderToStaticMarkup(<DiffView lines={lines} />)
    expect(html).toContain(">+1<")
    expect(html).toContain(">−1<")
  })

  it("folds a long diff and says how much is hidden", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      kind: "add" as const,
      text: `line ${i}`,
      oldNo: null,
      newNo: i + 1,
    }))
    const html = renderToStaticMarkup(<DiffView lines={many} limit={10} />)
    expect(html.match(/diff-line/g)?.length).toBe(10)
    expect(html).toContain("Ещё 30 строк")
  })

  it("says so when nothing changed", () => {
    const html = renderToStaticMarkup(
      <DiffView lines={[{ kind: "ctx", text: "same", oldNo: 1, newNo: 1 }]} />,
    )
    expect(html).toContain("Текст не изменился")
  })
})

describe("ChangesPanel", () => {
  it("summarises the files and the lines in the header button", () => {
    const html = panel()
    expect(html).toContain("1 файл(ов) +1 −1")
    expect(html).toContain("a.ts")
  })

  it("copies the patch of one file", () => {
    expect(panel()).toContain(">патч<")
  })

  it("offers the pane for a file it can render and the editor for the rest", () => {
    const markup = (path: string) =>
      panel({ changes: sessionChanges([editOf(path)]) })
    // .ts is nothing the preview pane can show; .html is exactly what it is for.
    expect(markup("src\\a.ts")).toContain("Открыть в редакторе")
    expect(markup("chart.html")).toContain("в панели")
  })

  it("keeps the diff out of the way until the file is opened", () => {
    expect(panel()).not.toContain("diff-body")
  })

  it("renders nothing when the conversation changed no files", () => {
    expect(panel({ changes: [] })).toBe("")
  })
})