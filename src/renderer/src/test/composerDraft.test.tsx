// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, waitFor } from "@testing-library/react"
import { ChatView } from "../views/ChatView"
import { StoreProvider } from "../lib/store"
import { installOcdMock } from "./harness"

/**
 * The draft of a conversation has to come back.
 *
 * The field is built by hand, in an effect, because React would not have it.
 * The draft is restored in another effect, and the two are declared in an
 * order that matters: the restore ran first, found no field to write to, and
 * left the words in the state alone. The box looked empty while the state
 * said there was something in it — and Send had nothing to send, so the button
 * did nothing at all.
 *
 * The test puts a draft in storage, mounts the chat, and looks at the field.
 */
afterEach(() => {
  cleanup()
  localStorage.clear()
})

const SESSION = { id: "ses_draft", title: "Черновик", time: { created: 1, updated: 1 } }

describe("the composer", () => {
  it("puts the stored draft back into the field", async () => {
    installOcdMock()
    localStorage.setItem("ocd.draft.v1:ses_draft", "неотправленный текст")

    render(
      <StoreProvider>
        <ChatView
          session={SESSION as never}
          expanded={false}
          onToggleExpand={() => undefined}
          onToggleSidebar={() => undefined}
        />
      </StoreProvider>,
    )

    // The field is created by an effect, and the draft goes into it by
    // another one.
    await waitFor(() => {
      const field = document.querySelector(".composer textarea") as HTMLTextAreaElement | null
      expect(field?.value).toBe("неотправленный текст")
    })
  })

  it("keeps an empty field when there is no draft", async () => {
    installOcdMock()

    render(
      <StoreProvider>
        <ChatView
          session={SESSION as never}
          expanded={false}
          onToggleExpand={() => undefined}
          onToggleSidebar={() => undefined}
        />
      </StoreProvider>,
    )

    await waitFor(() => {
      const field = document.querySelector(".composer textarea") as HTMLTextAreaElement | null
      expect(field).toBeTruthy()
      expect(field?.value).toBe("")
    })
  })
})
