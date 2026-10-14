import { describe, expect, it } from "vitest"
import { de } from "./de"
import { en } from "./en"
import { fr } from "./fr"
import { ru } from "./ru"
import { zh } from "./zh"

/**
 * Every locale has to carry every key.
 *
 * `translate()` falls back to Russian, so a key missing from another language is
 * not a crash: it is an English or Russian sentence sitting in a German window,
 * which nobody notices until a person is looking for exactly that string. The
 * dictionaries are plain objects rather than one exported type, so nothing else
 * catches it - this does.
 */
const LOCALES = { en, de, fr, zh } as const

describe("i18n", () => {
  for (const [code, dict] of Object.entries(LOCALES)) {
    it(`${code} carries every Russian key`, () => {
      const missing = Object.keys(ru).filter((key) => !(key in dict))
      expect(missing).toEqual([])
    })

    it(`${code} has no key Russian does not`, () => {
      // A leftover key is not shown to anyone; it is a translation that will
      // never be read, because the lookup never asks for it.
      const extra = Object.keys(dict).filter((key) => !(key in ru))
      expect(extra).toEqual([])
    })
  }

  it("substitutes every placeholder a string declares", () => {
    // A template that forgot a {name} renders the placeholder itself.
    const placeholders = (text: string) => (text.match(/\{[a-zA-Z]+\}/g) ?? []).sort()
    for (const [code, dict] of Object.entries({ ru, ...LOCALES })) {
      for (const key of Object.keys(ru)) {
        const source = (dict as Record<string, string>)[key]
        if (typeof source !== "string") continue
        expect({ code, placeholders: placeholders(source) }).toEqual({
          code,
          placeholders: placeholders((ru as Record<string, string>)[key]),
        })
      }
    }
  })
})