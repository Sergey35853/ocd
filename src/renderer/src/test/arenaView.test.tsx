// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react"
import { ArenaView } from "../components/ArenaView"
import { installOcdMock, renderWithStore } from "./harness"

/**
 * The same question asked of several models at once.
 *
 * The whole point is that the prompt, the folder and the moment are identical —
 * so the test checks that one prompt opens one conversation per model, is sent
 * to every one of them, and that each answer lands in its own column. A model
 * that could not be opened says so rather than quietly missing from the board.
 */
afterEach(() => {
  cleanup()
})

const MODELS = [
  { id: "m1", name: "Alpha", providerID: "prov", ref: "prov/m1" },
  { id: "m2", name: "Beta", providerID: "prov", ref: "prov/m2" },
]

describe("the model arena", () => {
  it("runs one prompt on two models and shows both answers side by side", async () => {
    let created = 0
    const ocd = installOcdMock({
      "api:models": async () => MODELS,
      "api:createSession": async () => ({ id: `ses_ar${++created}`, title: "" }),
      "api:prompt": async () => ({}),
      "api:sessionMessages": async (sessionId: string) => [
        { id: "1", type: "assistant", content: [{ type: "text", text: `answer from ${sessionId}` }] },
      ],
    })

    const { container } = renderWithStore(<ArenaView onClose={() => undefined} />)

    // The models arrive from the catalog; nothing is runnable before that.
    await waitFor(() => screen.getByText("Alpha"))

    const run = screen.getByRole("button", { name: /запустить|run/i })
    expect(run.hasAttribute("disabled")).toBe(true)

    // Two models and a prompt are what it takes.
    fireEvent.click(screen.getByText("Alpha"))
    fireEvent.click(screen.getByText("Beta"))
    const prompt = screen.getByRole("textbox")
    fireEvent.change(prompt, { target: { value: "сделай всё" } })
    expect(run.hasAttribute("disabled")).toBe(false)

    await act(async () => {
      fireEvent.click(run)
    })

    // One conversation per model, and the one prompt sent to each.
    await waitFor(() => expect(ocd.count("api.createSession")).toBe(2))
    await waitFor(() => expect(ocd.count("api.prompt")).toBe(2))

    // Both columns are on the board and their turns are running.
    await waitFor(() => expect(screen.getAllByText(/пишет|writing/i).length).toBe(2))

    // Both turns finish; each answer is read back into its own column.
    await act(async () => {
      ocd.fireEvent({ type: "session.execution.succeeded", properties: {}, data: { sessionID: "ses_ar1" } })
      ocd.fireEvent({ type: "session.execution.succeeded", properties: {}, data: { sessionID: "ses_ar2" } })
    })

    await waitFor(() => expect(ocd.count("api.sessionMessages")).toBe(2))
    await waitFor(() => {
      expect(container.textContent).toContain("answer from ses_ar1")
      expect(container.textContent).toContain("answer from ses_ar2")
    })
  })

  it("will not run on a single model or without a prompt", async () => {
    installOcdMock({ "api:models": async () => MODELS })
    renderWithStore(<ArenaView onClose={() => undefined} />)
    await waitFor(() => screen.getByText("Alpha"))

    const run = screen.getByRole("button", { name: /запустить|run/i })
    // A prompt alone is not enough.
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "привет" } })
    expect(run.hasAttribute("disabled")).toBe(true)

    // One model still is not a comparison.
    fireEvent.click(screen.getByText("Alpha"))
    expect(run.hasAttribute("disabled")).toBe(true)

    // The second model makes it runnable.
    fireEvent.click(screen.getByText("Beta"))
    expect(run.hasAttribute("disabled")).toBe(false)
  })
})
