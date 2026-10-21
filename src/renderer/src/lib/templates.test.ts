// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { newTemplate, placeholders, readTemplates, writeTemplates } from "../lib/templates"

/**
 * The user's own starting points for a prompt.
 *
 * They live on this machine and nowhere else, and the whole point of them is
 * that a hole in the text is found where the user has to write: a template
 * whose placeholders cannot be seen is a template that gets sent wrong.
 */
describe("prompt templates", () => {
  it("finds the holes in a template", () => {
    const holes = placeholders("Проверь {file} и {branch}")
    expect(holes.map((hole) => hole.name)).toEqual(["file", "branch"])
    expect(holes[0].at).toBe(8)
    expect(holes[0].length).toBe(6)
  })

  it("leaves text without holes alone", () => {
    expect(placeholders("обычный вопрос без дыр")).toEqual([])
  })

  it("ignores braces that are not holes", () => {
    // Code in a prompt is full of braces, and a template that treats every one
    // of them as a hole would fill the wrong thing.
    expect(placeholders("function f() { return 1 }")).toEqual([])
    expect(placeholders("a { } b")).toEqual([])
  })

  it("keeps the templates between launches", () => {
    const list = [newTemplate("Проверка", "Проверь {file}")]
    writeTemplates(list)
    const read = readTemplates()
    expect(read).toHaveLength(1)
    expect(read[0].name).toBe("Проверка")
    expect(read[0].text).toBe("Проверь {file}")
  })

  it("survives a corrupt list", () => {
    localStorage.setItem("ocd.templates.v1", "не json вовсе")
    expect(readTemplates()).toEqual([])
  })

  it("gives every template its own id", () => {
    const one = newTemplate("a", "x")
    const two = newTemplate("b", "y")
    expect(one.id).not.toBe(two.id)
  })
})
