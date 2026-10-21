// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { act, cleanup, render, waitFor } from "@testing-library/react"
import { StoreProvider } from "../lib/store"
import { installOcdMock, TEST_SETTINGS } from "./harness"

/**
 * The end of a turn has to be announced.
 *
 * The store subscribes to the server's events once, when the window opens, and
 * that subscription is never rebuilt — it would tear the stream down in the
 * middle of a turn. The handler that decides whether to raise a toast was
 * therefore made once too, and it had captured the settings of that first
 * render, when there were none yet: the setting said "do not notify", so the
 * toast never came.
 *
 * The test does what the server does — it hands the store an event — and asks
 * whether the toast was raised.
 */
afterEach(() => {
  cleanup()
})

describe("the store", () => {
  it("announces the end of a turn when the setting asks for it", async () => {
    const ocd = installOcdMock()
    render(<StoreProvider>{null}</StoreProvider>)

    // The settings are read at boot; the toast cannot be decided before they
    // are known.
    await waitFor(() => expect(ocd.calls["app.getSettings"]).toBeTruthy())

    await act(async () => {
      ocd.fireEvent({
        type: "session.execution.succeeded",
        properties: {},
        data: { sessionID: "ses_test" },
      })
    })

    await waitFor(() => expect(ocd.count("notify.finish")).toBe(1))
    const notice = ocd.calls["notify.finish"][0][0] as { sessionId: string; failed: boolean }
    expect(notice.sessionId).toBe("ses_test")
    expect(notice.failed).toBe(false)
  })

  it("says nothing when the setting asks for silence", async () => {
    // The override is keyed by the IPC channel, the way the main process
    // answers it; the calls are recorded by the path the window took.
    const ocd = installOcdMock({
      "app:getSettings": { ...TEST_SETTINGS, notifyOnFinish: false },
    })
    render(<StoreProvider>{null}</StoreProvider>)

    await waitFor(() => expect(ocd.calls["app.getSettings"]).toBeTruthy())

    await act(async () => {
      ocd.fireEvent({
        type: "session.execution.succeeded",
        properties: {},
        data: { sessionID: "ses_test" },
      })
    })

    // Give the event a chance to arrive before saying it did not.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(ocd.count("notify.finish")).toBe(0)
  })
})
