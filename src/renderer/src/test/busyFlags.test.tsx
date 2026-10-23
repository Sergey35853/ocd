// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { act, cleanup, screen, waitFor } from "@testing-library/react"
import { useStore } from "../lib/store"
import { installOcdMock, renderWithStore } from "./harness"

/**
 * The busy flag has to fall when the turn ends, however it ended.
 *
 * `abort` asks the server to stop and gets one of two answers. `false` means
 * there was nothing running, so it clears the flag itself. `true` means the
 * server took the stop and confirms it with `session.execution.interrupted` —
 * an event the store used to drop on the floor, so the flag stayed up and the
 * session went on looking busy long after it had gone quiet. `session.idle` is
 * the same kind of backstop for a turn that ended some other way.
 *
 * These tests do what the server does — hand the store the event — and ask
 * what the UI would show.
 */
afterEach(() => {
  cleanup()
})

const SID = "ses_test"

function BusyProbe() {
  const store = useStore()
  return <span data-testid="busy">{String(Boolean(store.busy[SID]))}</span>
}

/** Boot the store, then start a turn so there is a flag to clear. */
async function startBusyTurn() {
  const ocd = installOcdMock({
    "service:status": { connected: true, generations: 0, url: "", generation: 0 },
  })
  renderWithStore(<BusyProbe />)
  await waitFor(() => expect(ocd.calls["app.getSettings"]).toBeTruthy())

  await act(async () => {
    ocd.fireEvent({ type: "session.execution.started", data: { sessionID: SID } })
  })
  await waitFor(() => expect(screen.getByTestId("busy").textContent).toBe("true"))
  return ocd
}

describe("the busy flag at the end of a turn", () => {
  it("drops when the server confirms an interrupt", async () => {
    const ocd = await startBusyTurn()

    // This is the event `abort` was waiting for and never handled.
    await act(async () => {
      ocd.fireEvent({ type: "session.execution.interrupted", data: { sessionID: SID, reason: "user" } })
    })

    await waitFor(() => expect(screen.getByTestId("busy").textContent).toBe("false"))
  })

  it("drops on session.idle, for a turn that ended some other way", async () => {
    const ocd = await startBusyTurn()

    await act(async () => {
      ocd.fireEvent({ type: "session.idle", data: { sessionID: SID } })
    })

    await waitFor(() => expect(screen.getByTestId("busy").textContent).toBe("false"))
  })

  it("leaves other sessions alone when one goes idle", async () => {
    const ocd = await startBusyTurn()

    // A different session's events must not clear this one's flag.
    await act(async () => {
      ocd.fireEvent({ type: "session.idle", data: { sessionID: "ses_other" } })
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(screen.getByTestId("busy").textContent).toBe("true")
  })

  it("does not raise a completion notice for a turn that was stopped", async () => {
    const ocd = await startBusyTurn()

    await act(async () => {
      ocd.fireEvent({ type: "session.execution.interrupted", data: { sessionID: SID, reason: "user" } })
    })
    await waitFor(() => expect(screen.getByTestId("busy").textContent).toBe("false"))

    // A stopped turn is neither a success nor a failure, so nobody is told it
    // finished — only the flag has to fall.
    expect(ocd.count("notify.finish")).toBe(0)
  })
})
