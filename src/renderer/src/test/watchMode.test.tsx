// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react"
import { useStore } from "../lib/store"
import { installOcdMock, renderWithStore, TEST_SETTINGS } from "./harness"

/**
 * Watch-mode, from the user's side.
 *
 * Turning it on asks main to watch the conversation's own project folder, and a
 * change in that folder is answered with the configured prompt while the
 * conversation is idle. The whole point is that the app notices the code moved
 * without the person having to say so — so the test checks the folder is the
 * session's real one and that a change actually reaches a sent prompt.
 */
afterEach(() => {
  cleanup()
})

const PROMPT = "перепроверь тесты"

function Probe() {
  const store = useStore()
  return (
    <div>
      <span data-testid="sessions">{store.sessions.length}</span>
      <span data-testid="watching">{String(store.watchSessionId)}</span>
      <button type="button" onClick={() => void store.toggleWatch("ses_1")}>
        toggle
      </button>
    </div>
  )
}

describe("watch-mode", () => {
  it("watches the session's folder and answers a change with the prompt", async () => {
    const ocd = installOcdMock({
      "app:getSettings": { ...TEST_SETTINGS, watchPrompt: PROMPT },
      // Sessions only load against a connected server, which is how boot works.
      "service:status": { connected: true, generations: 0, url: "", generation: 0 },
      "api:sessions": [{ id: "ses_1", title: "беседа", location: { directory: "C:/proj" } }],
      "api:prompt": {},
    })

    renderWithStore(<Probe />)

    await waitFor(() => expect(screen.getByTestId("sessions").textContent).toBe("1"))

    // Turning it on watches that conversation's own folder.
    fireEvent.click(screen.getByRole("button", { name: "toggle" }))
    await waitFor(() => expect(screen.getByTestId("watching").textContent).toBe("ses_1"))
    expect(ocd.calls["fsWatch.start"]).toBeTruthy()
    expect(ocd.calls["fsWatch.start"][0][0]).toBe("C:/proj")

    // A change in the folder sends the configured prompt to the watched session.
    await act(async () => {
      ocd.fireEvent({ type: "ocd.fsChanged", data: { directory: "C:/proj", files: ["a.ts"] } })
    })
    await waitFor(() => expect(ocd.count("api.prompt")).toBe(1))
  })

  it("stops watching when toggled off", async () => {
    const ocd = installOcdMock({
      "app:getSettings": { ...TEST_SETTINGS, watchPrompt: PROMPT },
      "service:status": { connected: true, generations: 0, url: "", generation: 0 },
      "api:sessions": [{ id: "ses_1", title: "беседа", location: { directory: "C:/proj" } }],
    })

    renderWithStore(<Probe />)
    await waitFor(() => expect(screen.getByTestId("sessions").textContent).toBe("1"))

    fireEvent.click(screen.getByRole("button", { name: "toggle" }))
    await waitFor(() => expect(screen.getByTestId("watching").textContent).toBe("ses_1"))

    fireEvent.click(screen.getByRole("button", { name: "toggle" }))
    await waitFor(() => expect(screen.getByTestId("watching").textContent).toBe("null"))
    expect(ocd.count("fsWatch.stop")).toBe(1)

    // A change after stopping says nothing.
    await act(async () => {
      ocd.fireEvent({ type: "ocd.fsChanged", data: { directory: "C:/proj", files: ["a.ts"] } })
    })
    expect(ocd.count("api.prompt")).toBe(0)
  })
})
