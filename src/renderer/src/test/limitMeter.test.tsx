// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import { LimitMeter } from "../components/LimitMeter"

/**
 * The meter must not ask for the ledger over and over.
 *
 * The meter reads the ledger from an effect, and the callback it calls came
 * from the chat as an inline arrow — a new function on every render. The
 * effect depended on it, the answer changed the store, the store redrew the
 * chat, and the chat handed over a new arrow: a loop that never ended and
 * never let the chat alone.
 *
 * The test watches the calls instead of the drawing: a loop shows up as a
 * number of calls that keeps growing.
 */
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("the request meter", () => {
  it("asks for the ledger once, not once per render", async () => {
    let calls = 0
    const onRefresh = (model: string) => {
      calls += 1
      void model
    }

    const { rerender } = render(
      <LimitMeter
        model="opencode/test-model"
        limits={{}}
        now={Date.now()}
        visible
        onRefresh={onRefresh}
        onSetLimit={() => undefined}
        onReset={() => undefined}
      />,
    )

    // A few redraws, the way a stream of events would cause them.
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        rerender(
          <LimitMeter
            model="opencode/test-model"
            limits={{}}
            now={Date.now()}
            visible
            onRefresh={onRefresh}
            onSetLimit={() => undefined}
            onReset={() => undefined}
          />,
        )
      })
    }

    expect(calls).toBe(1)
  })

  it("asks again when the model changes", async () => {
    const calls: string[] = []
    const onRefresh = (model: string) => calls.push(model)

    const { rerender } = render(
      <LimitMeter
        model="opencode/one"
        limits={{}}
        now={Date.now()}
        visible
        onRefresh={onRefresh}
        onSetLimit={() => undefined}
        onReset={() => undefined}
      />,
    )

    await act(async () => {
      rerender(
        <LimitMeter
          model="opencode/two"
          limits={{}}
          now={Date.now()}
          visible
          onRefresh={onRefresh}
          onSetLimit={() => undefined}
          onReset={() => undefined}
        />,
      )
    })

    expect(calls).toEqual(["opencode/one", "opencode/two"])
  })

  it("shows nothing when the user turned it off", () => {
    render(
      <LimitMeter
        model="opencode/test-model"
        limits={{}}
        now={Date.now()}
        visible={false}
        onRefresh={() => undefined}
        onSetLimit={() => undefined}
        onReset={() => undefined}
      />,
    )
    expect(screen.queryByTitle(/opencode\/test-model/)).toBeNull()
  })
})
