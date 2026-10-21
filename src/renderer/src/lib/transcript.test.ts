import { describe, expect, it } from "vitest"
import type { MessageContent, MessageInfo } from "@shared/types"
import { pendingQuestions } from "./questions"
import {
  EMPTY_TRANSCRIPT,
  mergePage,
  pendingRequest,
  prependOlder,
  type PendingRequest,
  type Transcript,
} from "./transcript"

/**
 * The transcript belongs to one conversation.
 *
 * A tab strip means several conversations are open at once and the window
 * shows one of them. The transcript therefore has to say which conversation
 * the messages belong to — otherwise the page fetched for one conversation is
 * merged into the messages of another, and what one conversation asked starts
 * answering in all of them.
 */

/** A question the model asked and has not moved past. */
function asking(callID: string): MessageContent {
  return {
    type: "tool",
    name: "question",
    id: callID,
    state: {
      status: "running",
      input: { questions: [{ question: "В каком формате?", options: [] }] },
    },
  }
}

function turn(id: string, content: MessageContent[] = []): MessageInfo {
  return { id, type: "assistant", time: { created: 1 }, content }
}

function prompt(text: string): MessageInfo {
  return { id: `p-${text}`, type: "user", text, time: { created: 1 } }
}

function ids(transcript: Transcript): string[] {
  return transcript.items.map((message) => message.id)
}

describe("the transcript of a conversation", () => {
  it("keeps what is above the new page of the same conversation", () => {
    const older = turn("m1")
    const transcript = mergePage({ sessionId: "a", items: [older] }, "a", [turn("m2")])
    expect(ids(transcript)).toEqual(["m1", "m2"])
  })

  it("drops the messages of the conversation the user left", () => {
    const first = mergePage(EMPTY_TRANSCRIPT, "a", [turn("m1")])
    const second = mergePage(first, "b", [turn("m2")])
    expect(ids(second)).toEqual(["m2"])
  })

  it("does not answer one conversation's question in another", () => {
    // The question is asked in the first tab and is still open there.
    const first = mergePage(EMPTY_TRANSCRIPT, "a", [turn("m1", [asking("c1")])])
    // The user moves to the second tab: the question stays in the first.
    const second = mergePage(first, "b", [turn("m2")])
    expect(pendingQuestions(second.items, [])).toEqual([])
  })

  it("keeps the older page of the same conversation in front", () => {
    const transcript = prependOlder({ sessionId: "a", items: [turn("m2")] }, "a", [turn("m1")])
    expect(ids(transcript)).toEqual(["m1", "m2"])
  })

  it("does not put the older page of another conversation in front", () => {
    const transcript = prependOlder({ sessionId: "a", items: [turn("m2")] }, "b", [turn("m1")])
    expect(ids(transcript)).toEqual(["m2"])
  })
})

describe("the request that was just sent", () => {
  const sent: PendingRequest = { sessionId: "a", message: prompt("Сделай презентацию") }

  it("stays on screen until the server lists it", () => {
    expect(pendingRequest(sent, "a", [])?.message.text).toBe("Сделай презентацию")
  })

  it("goes away once the server lists it", () => {
    expect(pendingRequest(sent, "a", [prompt("Сделай презентацию")])).toBeNull()
  })

  it("does not follow the user into another tab", () => {
    expect(pendingRequest(sent, "b", [])).toBeNull()
  })
})
