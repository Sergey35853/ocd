// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { act, cleanup, render, waitFor } from "@testing-library/react"
import { StoreProvider } from "../lib/store"
import { installOcdMock, TEST_SETTINGS } from "./harness"

/**
 * The rules that make the app speak up on its own.
 *
 * A rule is the user saying "this one does" — so it has to fire even when the
 * general notification is off, or the rule is a rule that never fires. The
 * words it watches are the ones the answer just had.
 */
afterEach(() => {
  cleanup()
})

/**
 * Wait for boot to have the settings in hand.
 *
 * The rules are read through `settingsRef` at the moment the event arrives,
 * and boot loads the settings asynchronously: an event that lands before that
 * render has committed finds no rules at all, and the test then waits a second
 * for a notification that could not have been raised. `service.status` is the
 * first call boot makes after the settings are in, and one macrotask after it
 * lets React commit what it has queued.
 */
async function whenSettingsAreIn(ocd: ReturnType<typeof installOcdMock>) {
  await waitFor(() => expect(ocd.calls["service.status"]).toBeTruthy())
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe("the notification rules", () => {
  it("speaks up when the answer contains the word", async () => {
    const ocd = installOcdMock({
      "app:getSettings": {
        ...TEST_SETTINGS,
        notifyOnFinish: false,
        notifyRules: [{ id: "r1", kind: "keyword", value: "ошибка", enabled: true }],
      },
    })
    render(<StoreProvider>{null}</StoreProvider>)
    await whenSettingsAreIn(ocd)

    await act(async () => {
      ocd.fireEvent({
        type: "session.text.delta",
        properties: {},
        data: { sessionID: "ses_1", delta: "Тут была ОШИБКА в логе" },
      })
    })
    await act(async () => {
      ocd.fireEvent({
        type: "session.execution.succeeded",
        properties: {},
        data: { sessionID: "ses_1" },
      })
    })

    await waitFor(() => expect(ocd.count("notify.rule")).toBe(1))
    const notice = ocd.calls["notify.rule"][0][0] as { body: string }
    expect(notice.body).toContain("ошибка")
  })

  it("says nothing when the answer is about something else", async () => {
    const ocd = installOcdMock({
      "app:getSettings": {
        ...TEST_SETTINGS,
        notifyOnFinish: false,
        notifyRules: [{ id: "r1", kind: "keyword", value: "ошибка", enabled: true }],
      },
    })
    render(<StoreProvider>{null}</StoreProvider>)
    await whenSettingsAreIn(ocd)

    await act(async () => {
      ocd.fireEvent({
        type: "session.text.delta",
        properties: {},
        data: { sessionID: "ses_1", delta: "Всё прошло хорошо" },
      })
    })
    await act(async () => {
      ocd.fireEvent({
        type: "session.execution.succeeded",
        properties: {},
        data: { sessionID: "ses_1" },
      })
    })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(ocd.count("notify.rule")).toBe(0)
  })

  it("speaks up when the turn failed", async () => {
    const ocd = installOcdMock({
      "app:getSettings": {
        ...TEST_SETTINGS,
        notifyOnFinish: false,
        notifyRules: [{ id: "r1", kind: "error", value: "", enabled: true }],
      },
    })
    render(<StoreProvider>{null}</StoreProvider>)
    await whenSettingsAreIn(ocd)

    await act(async () => {
      ocd.fireEvent({
        type: "session.execution.failed",
        properties: {},
        data: { sessionID: "ses_1" },
      })
    })

    await waitFor(() => expect(ocd.count("notify.rule")).toBe(1))
  })

  it("keeps quiet about a rule the user turned off", async () => {
    const ocd = installOcdMock({
      "app:getSettings": {
        ...TEST_SETTINGS,
        notifyOnFinish: false,
        notifyRules: [{ id: "r1", kind: "error", value: "", enabled: false }],
      },
    })
    render(<StoreProvider>{null}</StoreProvider>)
    await whenSettingsAreIn(ocd)

    await act(async () => {
      ocd.fireEvent({
        type: "session.execution.failed",
        properties: {},
        data: { sessionID: "ses_1" },
      })
    })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(ocd.count("notify.rule")).toBe(0)
  })
})
