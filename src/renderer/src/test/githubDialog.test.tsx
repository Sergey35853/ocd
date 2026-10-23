// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react"
import { GitHubDialog } from "../components/GitHubDialog"
import { installOcdMock, renderWithStore, TEST_SETTINGS } from "./harness"

/**
 * The GitHub panel, from the user's side.
 *
 * Two things it must not get wrong. The repository is known before any token
 * exists — that half is read offline from the folder's own `.git` — so a
 * person who has not added a token yet still sees whose repository this is and
 * is told where to add one, rather than an empty list that reads as "nothing
 * is open". And a ticket handed to "work on this" has to arrive in the new
 * conversation whole: the number, the title and the URL, because the URL is the
 * only thing the agent cannot guess.
 */
afterEach(() => {
  cleanup()
})

const REPO = { owner: "Sergey35853", repo: "ocd" }
const ISSUE = {
  number: 7,
  title: "Busy-флаг не падает",
  url: "https://github.com/Sergey35853/ocd/issues/7",
  state: "open",
}
const PULL = {
  number: 9,
  title: "Чинит хвост сессии",
  url: "https://github.com/Sergey35853/ocd/pull/9",
  state: "open",
}

/** Boot: connected server and settings holding the given token. */
function boot(githubToken: string) {
  return installOcdMock({
    "app:getSettings": { ...TEST_SETTINGS, githubToken },
    // Sessions only load against a connected server, which is how boot works.
    "service:status": { connected: true, generations: 0, url: "", generation: 0 },
    "api:sessions": [],
    // Answered as a promise: the panel calls `.catch()` on this one, and the
    // mock's plain-value overrides come back synchronously.
    "github:repo": async () => REPO,
    "github:issues": async () => [ISSUE],
    "github:pulls": async () => [PULL],
  })
}

describe("the GitHub panel", () => {
  it("names the repository and asks for a token instead of calling the API", async () => {
    const ocd = boot("")

    renderWithStore(<GitHubDialog directory="C:/proj" onClose={() => undefined} />)

    await waitFor(() => expect(screen.getByText("Sergey35853/ocd")).toBeTruthy())
    expect(screen.getByText(/Добавьте токен/)).toBeTruthy()

    // Nothing to list yet: the lists would be empty either way, and "empty" is
    // exactly what a missing token must not look like.
    expect(ocd.count("github.issues")).toBe(0)
    expect(ocd.count("github.pulls")).toBe(0)
  })

  it("lists the open work and sends the folder and the token to main", async () => {
    const ocd = boot("tok")

    renderWithStore(<GitHubDialog directory="C:/proj" onClose={() => undefined} />)

    await waitFor(() => expect(screen.getByText("#7")).toBeTruthy())
    expect(screen.getByText("#9")).toBeTruthy()
    expect(screen.getByText(ISSUE.title)).toBeTruthy()

    // The token travels to the main process per call; the renderer keeps it
    // only as the settings field it was read from.
    expect(ocd.calls["github.issues"][0]).toEqual(["C:/proj", "tok"])
    expect(ocd.calls["github.pulls"][0]).toEqual(["C:/proj", "tok"])
  })

  it("hands a ticket to a fresh conversation in the same project", async () => {
    const ocd = boot("tok")
    let closed = false

    renderWithStore(
      <GitHubDialog directory="C:/proj" onClose={() => (closed = true)} />,
    )

    await waitFor(() => expect(screen.getByText("#7")).toBeTruthy())

    // Issues come first in the panel, so the first "work on it" is the ticket.
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "В беседу" })[0])
    })

    await waitFor(() => expect(ocd.count("api.prompt")).toBe(1))
    const [, body] = ocd.calls["api.prompt"][0] as [string, { text: string }]
    expect(body.text).toContain("#7")
    expect(body.text).toContain(ISSUE.title)
    expect(body.text).toContain(ISSUE.url)
    await waitFor(() => expect(closed).toBe(true))
  })

  it("says so plainly when the folder is not a GitHub repository", async () => {
    const ocd = installOcdMock({
      "app:getSettings": { ...TEST_SETTINGS, githubToken: "tok" },
      "service:status": { connected: true, generations: 0, url: "", generation: 0 },
      "github:repo": async () => null,
    })

    renderWithStore(<GitHubDialog directory="C:/proj" onClose={() => undefined} />)

    await waitFor(() => expect(screen.getByText(/не из GitHub-репозитория/)).toBeTruthy())
    // The lists would only be a request for a repository that has no name.
    expect(ocd.count("github.issues")).toBe(0)
  })
})
