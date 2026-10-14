import { describe, expect, it } from "vitest"
import { hasAnsi, stripAnsi } from "./ansi"

/**
 * Escape sequences out of command output.
 *
 * Output arrives from shells and tools that colour, move the cursor and report
 * progress, and none of that belongs in the transcript. The sequences are
 * written as codes rather than pasted in, because a literal ESC is invisible
 * in an editor and in a diff.
 */
const ESC = String.fromCharCode(0x1b)

describe("stripAnsi", () => {
  it("removes colour codes", () => {
    expect(stripAnsi(`${ESC}[32mготово${ESC}[0m`)).toBe("готово")
    expect(stripAnsi(`${ESC}[1;31mошибка${ESC}[0m`)).toBe("ошибка")
  })

  it("removes cursor movement and erase", () => {
    expect(stripAnsi(`${ESC}[2K${ESC}[1Gстрока`)).toBe("строка")
  })

  it("turns a redraw into a line rather than letting it overwrite", () => {
    // A lone `\r` is how a progress bar redraws itself. Left in place the whole
    // thing collapses into one unreadable line, so it becomes a newline and the
    // latest state is the last line.
    expect(stripAnsi(`счётчик\r 42`)).toBe("счётчик\n 42")
  })

  it("folds a CRLF pair into one line ending", () => {
    expect(stripAnsi("первая\r\nвторая")).toBe("первая\nвторая")
  })

  it("removes the bracketed paste markers some shells emit", () => {
    expect(stripAnsi(`${ESC}[?2004hвставлено${ESC}[?2004l`)).toBe("вставлено")
  })

  it("leaves ordinary text alone", () => {
    const plain = "npm WARN deprecated: left-pad@1.0.0"
    expect(stripAnsi(plain)).toBe(plain)
    expect(stripAnsi("")).toBe("")
  })

  it("does not eat a bracket that is not a sequence", () => {
    expect(stripAnsi("массив[0] и список[1]")).toBe("массив[0] и список[1]")
  })

  it("keeps text after the last sequence", () => {
    expect(stripAnsi(`${ESC}[32mда${ESC}[0m ${ESC}[33mнет${ESC}[0m`)).toBe("да нет")
  })
})

describe("hasAnsi", () => {
  it("sees a sequence when there is one", () => {
    expect(hasAnsi(`${ESC}[32mда${ESC}[0m`)).toBe(true)
  })

  it("does not fire on bracketed text", () => {
    expect(hasAnsi("массив[0]")).toBe(false)
    expect(hasAnsi("обычный вывод")).toBe(false)
  })
})
