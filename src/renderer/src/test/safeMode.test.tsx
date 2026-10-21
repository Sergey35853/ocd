// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { act, cleanup, render, waitFor } from "@testing-library/react"
import { StoreProvider } from "../lib/store"
import { installOcdMock, TEST_SETTINGS } from "./harness"

/**
 * The safe mode: the agent may look, but not touch.
 *
 * The point of the mode is a conversation that cannot cost the user a file,
 * so the refusal has to happen without the question — a question asked every
 * time is a question the user has to answer every time, which is the opposite
 * of what turning the mode on means.
 */
afterEach(() => {
  cleanup()
})

/** The settings with the mode on. */
const SAFE = { ...TEST_SETTINGS, safeMode: true }

describe("the safe mode", () => {
  it("refuses a request to change something, without asking", async () => {
    const ocd = installOcdMock({ "app:getSettings": SAFE })
    render(<StoreProvider>{null}</StoreProvider>)
    await waitFor(() => expect(ocd.calls["app.getSettings"]).toBeTruthy())

    await act(async () => {
      ocd.fireEvent({
        type: "permission.asked",
        properties: {},
        data: { id: "per_1", sessionID: "ses_1", action: "edit", resources: ["a.ts"] },
      })
    })

    await waitFor(() => expect(ocd.count("permission.reply")).toBe(1))
    const args = ocd.calls["permission.reply"][0]
    expect(args[0]).toBe("ses_1")
    expect(args[1]).toBe("per_1")
    expect(args[2]).toBe("reject")
  })

  it("answers a request that only reads at once", async () => {
    const ocd = installOcdMock({ "app:getSettings": SAFE })
    render(<StoreProvider>{null}</StoreProvider>)
    await waitFor(() => expect(ocd.calls["app.getSettings"]).toBeTruthy())

    await act(async () => {
      ocd.fireEvent({
        type: "permission.asked",
        properties: {},
        data: { id: "per_2", sessionID: "ses_1", action: "read", resources: ["a.ts"] },
      })
    })

    await waitFor(() => expect(ocd.count("permission.reply")).toBe(1))
    expect(ocd.calls["permission.reply"][0][2]).toBe("once")
  })

  it("asks as usual when the mode is off", async () => {
    const ocd = installOcdMock()
    render(<StoreProvider>{null}</StoreProvider>)
    await waitFor(() => expect(ocd.calls["app.getSettings"]).toBeTruthy())

    await act(async () => {
      ocd.fireEvent({
        type: "permission.asked",
        properties: {},
        data: { id: "per_3", sessionID: "ses_1", action: "edit", resources: ["a.ts"] },
      })
    })

    // Give the store a chance to answer it on its own.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(ocd.count("permission.reply")).toBe(0)
  })
})
