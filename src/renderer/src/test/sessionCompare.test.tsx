// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { SessionCompare } from "../components/SessionCompare"
import { installOcdMock } from "./harness"

/**
 * Two conversations, side by side.
 *
 * The same task done twice leaves two transcripts that differ in a few
 * places, and the places they differ in are the answer to "what changed
 * between them". A message that is in both is not interesting; one that is in
 * only one of them is.
 */
afterEach(() => {
  cleanup()
})

const SESSIONS = [
  { id: "ses_a", title: "Первый раз" },
  { id: "ses_b", title: "Второй раз" },
]

describe("the comparison of two conversations", () => {
  it("shows what differs between the two", async () => {
    installOcdMock({
      "api:sessionMessages": (sessionId: string) =>
        sessionId === "ses_a"
          ? [{ id: "1", type: "user", content: [{ type: "text", text: "сделай отчёт" }] }]
          : [
              { id: "1", type: "user", content: [{ type: "text", text: "сделай отчёт" }] },
              { id: "2", type: "assistant", content: [{ type: "text", text: "Готово, вот отчёт" }] },
            ],
    })

    render(<SessionCompare sessions={SESSIONS} onClose={() => undefined} />)

    // Nothing is compared until two conversations are named.
    const button = screen.getByRole("button", { name: /сравнить|compare/i })
    expect(button.hasAttribute("disabled")).toBe(true)

    const [first, second] = screen.getAllByRole("combobox")
    fireEvent.change(first, { target: { value: "ses_a" } })
    fireEvent.change(second, { target: { value: "ses_b" } })
    fireEvent.click(button)

    await waitFor(() => expect(screen.getByText(/слева|первая беседа|first conversation/i)).toBeTruthy())
  })

  it("says so when the comparison fails", async () => {
    installOcdMock({
      "api:sessionMessages": () => {
        throw new Error("сервер не отвечает")
      },
    })

    render(<SessionCompare sessions={SESSIONS} onClose={() => undefined} />)

    const button = screen.getByRole("button", { name: /сравнить|compare/i })
    const [first, second] = screen.getAllByRole("combobox")
    fireEvent.change(first, { target: { value: "ses_a" } })
    fireEvent.change(second, { target: { value: "ses_b" } })
    fireEvent.click(button)

    await waitFor(() => expect(screen.getByText(/сервер не отвечает/)).toBeTruthy())
  })
})
