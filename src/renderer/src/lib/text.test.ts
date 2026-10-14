import { describe, expect, it } from "vitest"
import { cleanText, isUnreadable } from "./text"

/**
 * Text that came out of the model.
 *
 * Two different jobs. `cleanText` removes the invisible characters a model
 * leaks — zero-width marks and bidirectional overrides — which change how a
 * line reads without changing what a copy of it contains. `isUnreadable` catches
 * the other failure: markup the model wrote as prose because its structured
 * channel was unavailable.
 *
 * Every invisible character below is written as a code. A literal zero-width
 * space in a source file is invisible too, which is how one ended up inside a
 * comment in this codebase once already.
 */
const ZWSP = String.fromCharCode(0x200b)
const ZWNJ = String.fromCharCode(0x200c)
const RLO = String.fromCharCode(0x202e)
const PDF = String.fromCharCode(0x202c)
const BOM = String.fromCharCode(0xfeff)

describe("cleanText", () => {
  it("leaves ordinary Russian and English text exactly as it was", () => {
    const text = "Привет, мир! Hello, world. 42 % — done."
    expect(cleanText(text)).toBe(text)
  })

  it("removes zero-width characters that change how a line reads", () => {
    expect(cleanText(`а${ZWSP}бв${ZWNJ}где`)).toBe("абвгде")
    expect(cleanText(`${BOM}начало`)).toBe("начало")
  })

  it("removes bidirectional overrides, which reorder what is on screen", () => {
    expect(cleanText(`${RLO}admin${PDF} готов`)).toBe("admin готов")
  })

  it("removes the NUL byte and other C0 controls, keeping tab and newline", () => {
    expect(cleanText(`a${String.fromCharCode(0)}b`)).toBe("ab")
    expect(cleanText(`a${String.fromCharCode(0x07)}b`)).toBe("ab")
    expect(cleanText("первая\tвторая\nтретья")).toBe("первая\tвторая\nтретья")
  })

  it("keeps a soft hyphen, which is typography and not concealment", () => {
    // It marks a hyphenation point; removing it would break words the model
    // deliberately broke across lines.
    const softHyphen = String.fromCharCode(0x00ad)
    expect(cleanText(`до${softHyphen}много`)).toBe(`до${softHyphen}много`)
  })

  it("does not touch an empty string", () => {
    expect(cleanText("")).toBe("")
  })
})

describe("isUnreadable", () => {
  it("catches a reply that is nothing but protocol markup", () => {
    // Some models fall back to writing their trained protocol as text when the
    // does have an answer in it, which is the second condition doing its job.
    // app is broken.
    expect(isUnreadable(`<tool_${ZWSP}call></tool_${ZWSP}call>`)).toBe(true)
    expect(isUnreadable("<function_calls></function_calls>")).toBe(true)
    expect(isUnreadable("<invoke></invoke>")).toBe(true)
  })

  it("accepts a reply that mixes prose with a stray tag", () => {
    // The point of the second condition: real prose survives even when a tag
    // turns up inside it.
    expect(isUnreadable("Вот файл: <file>config.json</file>")).toBe(false)
  })

  it("accepts markup-shaped text that is not a tag", () => {
    // "42" and a bare "[1, 2, 3]" must never be mistaken for noise.
    expect(isUnreadable("42")).toBe(false)
    expect(isUnreadable("[1, 2, 3]")).toBe(false)
    expect(isUnreadable("Сравнение: 2 < 3 и 4 > 1")).toBe(false)
  })

  it("accepts a truncated tag that still has prose in front of it", () => {
    // The answer stops part way through, so the closing bracket never arrives.
    // There is no complete tag, so this is ordinary prose with a stray
    // fragment — not a message that is nothing but protocol.
    expect(isUnreadable("вот ответ\n<tool_call")).toBe(false)
    expect(isUnreadable("вот ответ\n[tool")).toBe(false)
  })

  it("accepts nothing at all", () => {
    expect(isUnreadable("")).toBe(false)
    expect(isUnreadable("   ")).toBe(false)
  })

  it("looks past the invisible characters before deciding", () => {
    // A model that pads its markup with zero-width marks is still emitting
    // markup, and cleaning happens first.
    expect(isUnreadable(`<tool_${ZWSP}call></tool_${ZWSP}call>`)).toBe(true)
  })

  it("agrees with cleanText on a well-formed answer", () => {
    expect(isUnreadable(cleanText("Готово. Изменил три файла."))).toBe(false)
  })
})
