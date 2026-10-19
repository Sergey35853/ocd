import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

/**
 * Sending from a chat with no session.
 *
 * This is here because of a bug that looked like a dead send button: a window
 * can open straight into the chat with nothing selected, `sessionId` is the
 * empty string, and every prompt went to a session that does not exist. The
 * draft was not even written to storage — `writeDraft` returns early without a
 * session id — which is what finally gave it away, long after the obvious
 * explanations had been ruled out.
 *
 * The symptom from the outside was the worst kind: the field filled in, the
 * button pressed, and nothing happened anywhere. The transcript stayed empty and
 * no error was ever shown, because the request was well formed and simply
 * addressed to nowhere.
 */
const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, "ChatView.tsx"), "utf8")

/**
 * Only the part of the file that is `submit`.
 *
 * `if (!sessionId) {` appears twice in ChatView — once in the loader, which just
 * empties the transcript, and once in the sender, which is the one that matters.
 * A test that took the first match would be asserting about the wrong function
 * and would keep passing if the sender's guard were deleted.
 */
function submitBody(): string {
  const start = source.indexOf("const submit = () => {")
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf("\n  const ", start)
  return source.slice(start, end === -1 ? start + 4000 : end)
}

describe("submitting without a session", () => {
  it("makes a session instead of sending into the empty one", () => {
    // The order is the fix: the session must exist before the prompt is sent
    // to it, and the send must name the id that was just created rather than
    // the empty string the view was opened with.
    const submit = submitBody()
    const guard = submit.indexOf("if (!sessionId) {")
    expect(guard).toBeGreaterThan(-1)
    const creates = submit.indexOf("store.newSession()")
    const sends = submit.indexOf("store.send(")
    expect(creates).toBeGreaterThan(guard)
    expect(sends).toBeGreaterThan(creates)
  })

  it("puts the text back if the session cannot be created", () => {
    // Otherwise a failed attempt takes the words with it: the person types a
    // paragraph, presses send while briefly offline, and the text is gone with
    // nothing sent and nothing said.
    //
    // Through `applyDraft`, not `setDraft`: the field owns its text now, so
    // putting it back has to reach the element as well as the state, or the
    // words reappear in the store and not on screen.
    const submit = submitBody()
    const guard = submit.indexOf("if (!sessionId) {")
    const block = submit.slice(guard, guard + 900)
    expect(block).toMatch(/applyDraft\(text\)/)
    expect(block).toMatch(/toast\(/)
    // Both ways this can fail, not just the first.
    expect([...block.matchAll(/applyDraft\(text\)/g)].length).toBeGreaterThanOrEqual(2)
  })

  it("still clears the draft before sending to an existing session", () => {
    // The no-session path returns early; the ordinary one has to be untouched,
    // or the message would appear to linger after it had been sent.
    const submit = submitBody()
    expect(submit).toMatch(/applyDraft\(""\)/)
  })

  it("reads the text from the field, not from state", () => {
    // An input method holds a word in composition and does not hand it over
    // until something ends it. If Send read `draft`, it would be a word behind
    // at the moment it is pressed and the message would go out saying there was
    // nothing to send.
    const submit = submitBody()
    expect(submit).toMatch(/textareaRef\.current\?\.value \?\? draft/)
  })

  it("never sends to an empty session id", () => {
    // `sessionId ?? ""` was how this happened. The send must never be able to
    // name the empty string again, because the server accepts it and does
    // nothing, which is not an error anything can report.
    const sends = [...source.matchAll(/store\.send\(([^)]*)\)/g)].map((m) => m[1])
    expect(sends.length).toBeGreaterThan(0)
    for (const args of sends) {
      expect(args.includes('sessionId ?? "')).toBe(false)
    }
  })
})

