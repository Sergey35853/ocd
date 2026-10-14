import { describe, expect, it } from "vitest"
import type { MessageContent, MessageInfo, PendingForm } from "@shared/types"
import { formsByCall, pendingQuestions, questionOf } from "./questions"

/** A `question` tool call the way the server reports it. */
function asking(callID: string, question: string): MessageContent {
  return {
    type: "tool",
    name: "question",
    id: callID,
    state: {
      status: "running",
      input: {
        questions: [
          {
            question,
            options: [
              { label: "pptx", description: "Редактируемый", value: "pptx" },
              { label: "html", description: "Слайды в браузере", value: "html" },
            ],
          },
        ],
      },
    },
  }
}

function turn(content: MessageContent[], created: number): MessageInfo {
  return { id: `m${created}`, type: "assistant", time: { created }, content }
}

function form(id: string, callID: string): PendingForm {
  return {
    id,
    metadata: { tool: { id: callID } },
    fields: [{ key: "format", title: "Формат", options: [{ label: "pptx", value: "pptx" }] }],
  } as unknown as PendingForm
}

describe("questionOf", () => {
  it("reads the question and its options", () => {
    const question = questionOf(asking("c1", "В каком формате?"))
    expect(question?.question).toBe("В каком формате?")
    expect(question?.options.map((option) => option.value)).toEqual(["pptx", "html"])
  })

  it("falls back to the label when there is no value to send", () => {
    const block: MessageContent = {
      type: "tool",
      state: { input: { questions: [{ question: "?", options: [{ label: "да" }] }] } },
    }
    expect(questionOf(block)?.options[0].value).toBe("да")
  })

  it("ignores calls that ask nothing", () => {
    expect(questionOf({ type: "tool", state: { input: { command: "ls" } } })).toBeNull()
    expect(questionOf({ type: "text", text: "?" })).toBeNull()
  })
})

describe("pendingQuestions", () => {
  it("finds the question asked in the middle of a long conversation", () => {
    const messages = [
      turn([{ type: "tool", name: "read", id: "t1", state: { status: "completed" } }], 1),
      turn([asking("c1", "Формат?")], 2),
      turn([{ type: "tool", name: "read", id: "t2", state: { status: "completed" } }], 3),
    ]
    const questions = pendingQuestions(messages, [])
    expect(questions).toHaveLength(1)
    expect(questions[0].key).toBe("c1")
    expect(questions[0].fallback?.question).toBe("Формат?")
  })

  it("pairs a question with the form that makes it answerable", () => {
    const questions = pendingQuestions([turn([asking("c1", "Формат?")], 1)], [form("f1", "c1")])
    expect(questions[0].form?.id).toBe("f1")
    expect(questions[0].fallback?.question).toBe("Формат?")
  })

  it("does not show the same question twice once its form has arrived", () => {
    const questions = pendingQuestions([turn([asking("c1", "Формат?")], 1)], [form("f1", "c1")])
    expect(questions).toHaveLength(1)
  })

  it("keeps a form whose tool block is not in the loaded history", () => {
    const questions = pendingQuestions([], [form("f1", "c9")])
    expect(questions).toHaveLength(1)
    expect(questions[0].form?.id).toBe("f1")
  })

  it("asks nothing when the conversation is quiet", () => {
    expect(
      pendingQuestions([turn([{ type: "tool", name: "read", id: "t1", state: {} }], 1)], []),
    ).toEqual([])
  })

  it("orders questions the way they were asked, strays last", () => {
    const messages = [
      turn([asking("c1", "Первая?")], 1),
      turn([asking("c2", "Вторая?")], 2),
    ]
    const questions = pendingQuestions(messages, [form("f3", "c3")])
    expect(questions.map((item) => item.key)).toEqual(["c1", "c2", "f3"])
  })
})

describe("formsByCall", () => {
  it("links a form to the call that asked", () => {
    const map = formsByCall([turn([asking("c1", "Формат?")], 1)], [form("f1", "c1")])
    expect(map.get("c1")?.id).toBe("f1")
  })

  it("skips a form whose call is not on screen", () => {
    expect(formsByCall([], [form("f1", "c9")]).size).toBe(0)
  })
})