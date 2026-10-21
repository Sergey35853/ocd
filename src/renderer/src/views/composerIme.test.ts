import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

/**
 * The composer holds an input method's unfinished word alive.
 *
 * The bug, and the wrong turns before it: the field took exactly one character
 * and then went quiet. The input method sent `insertCompositionText` with "П",
 * no further `input` ever arrived, `compositionend` never fired, and the field
 * sat on its placeholder with Send greyed out while the IME's own suggestion
 * strip held the whole word.
 *
 * The cause was that every character of the composition was pushed into React
 * state. An input method assembles a whole word before committing it, so each
 * character re-rendered the whole view while the word was still being built,
 * and the composition died on the first one. The fix is to leave the element
 * alone until the word is finished.
 *
 * Finding it took a bisect, and the earlier guesses were all wrong. What ruled
 * them out, one at a time:
 *
 *   - not `value` on the element: removing it changed nothing.
 *   - not React's handling of the element: removing React's internal keys made
 *     one run type, but a build where React never touched it still did not.
 *   - not the container: a bare `<textarea>` placed inside `.composer` itself
 *     types the word through in the same session, same input method.
 *   - not `backdrop-filter: blur(18px)` on `.composer`, which is a known source
 *     of exactly this in Chromium.
 *   - not the auto-resize: the working field resized itself on every character
 *     and kept typing.
 *
 * The control is the part worth keeping — a bare field typed into alongside it.
 * Without that, this was twice mistaken for a broken input method.
 */
const here = dirname(fileURLToPath(import.meta.url))
/** Comments taken out: several name the very things being asserted on. */
const source = readFileSync(join(here, "ChatView.tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^\s*\/\/.*$/gm, " ")

/** One function body, up to the next declaration at the same depth. */
function bodyOf(marker: string): string {
  const at = source.indexOf(marker)
  expect(at).toBeGreaterThan(-1)
  const rest = source.slice(at)
  const lines = rest.split("\n")
  const out: string[] = []
  let depth = 0
  for (const line of lines) {
    out.push(line)
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length
    if (depth === 0 && out.length > 1) break
  }
  return out.join("\n")
}

describe("the composer with an input method", () => {
  it("is not rendered by React at all", () => {
    // Not the cause on its own — removing React's involvement changed nothing —
    // but it is where the element now has to live: the handlers below are
    // attached by hand, because the ones React would wire up are the ones that
    // re-rendered the view mid-word.
    expect(source).not.toMatch(/<textarea/)
    expect(source).toMatch(/document\.createElement\("textarea"\)/)
    // Everything the props used to do, done by hand instead.
    for (const name of [
      "input",
      "compositionstart",
      "compositionend",
      "keydown",
      "paste",
      "contextmenu",
    ]) {
      expect(source).toContain(`addEventListener("${name}"`)
    }
  })

  it("leaves React alone until the word is finished", () => {
    // The whole fix. Pushing every character in is what stopped the composition
    // dead: the first character arrived and none after it ever did. Send is
    // enabled directly instead, so it lights up without a re-render.
    //
    // The state is brought up to date too — but only when no word is being
    // assembled. Without that the state kept the words from before the edit,
    // and everything that reads it (the send button, "edit and resend") acted
    // on the old text.
    const sync = bodyOf("const sync = () => {")
    expect(sync).toMatch(/if \(!composingRef\.current\) setDraft\(text\)/)
    expect(sync).toMatch(/send\.disabled = !text\.trim\(\)/)
  })

  it("does not empty the field while the input method is still typing", () => {
    // What made sending hang: `submit` clears the field, an input method is
    // mid-word, and the text it is holding is deleted underneath it. The change
    // waits for the word to finish, and is applied then.
    //
    // The second half of the same trap is the input method committing on its
    // own, which arrives without a composition event of its own — hence the
    // window.
    const body = bodyOf("const applyDraft = useCallback")
    expect(body).toMatch(/if \(composingRef\.current/)
    expect(body).toMatch(/imeBusyUntil\.current/)
    expect(body).toMatch(/pendingDraft\.current = text/)
    // And the queued change is not forgotten.
    expect(bodyOf("const onCompositionEnd = () => {")).toMatch(/flushPending/)
  })

  it("writes nothing on the tick the input method commits the word", () => {
    // Measured: re-rendering from inside `compositionend` is enough to leave
    // the WebView unresponsive. The word is read there and nothing else happens
    // until the next tick.
    const end = bodyOf("const onCompositionEnd = () => {")
    expect(end).toMatch(/setTimeout\([\s\S]*setDraft\(word\)/)
    // Losing focus is the other way into the same moment.
    expect(source).toContain('addEventListener("blur"')
  })

  it("takes the finished word into state", () => {
    // Otherwise the rest of the view never learns what was typed, and Send stays
    // greyed out on a field that plainly has something in it.
    const end = bodyOf("const onCompositionEnd = () => {")
    expect(end).toMatch(/composingRef\.current = false/)
    expect(end).toMatch(/setDraft\(word\)/)
  })

  it("still writes the draft away as it is typed", () => {
    // Storage is not deferred — only the re-render is. A draft lost on a crash
    // or a switch of conversation would be its own kind of loss.
    expect(bodyOf("const sync = () => {")).toMatch(/writeDraft\(/)
  })

  it("treats Enter as finishing a word, not as sending it", () => {
    // While an input method is composing, Enter is the key that takes the word.
    // Sending there throws the message away and keeps the half-typed text.
    const key = bodyOf("const onKeyDown = (event: KeyboardEvent) => {")
    const guard = key.indexOf("if (composingRef.current) return")
    const sends = key.indexOf("fieldLive.current.submit()")
    expect(guard).toBeGreaterThan(-1)
    expect(sends).toBeGreaterThan(guard)
  })

  it("puts the app's own changes into the element, not only into state", () => {
    // The element owns its text now, so anything the app changes on purpose has
    // to reach it. Without this, a draft restored when switching conversations
    // would live in state and not on screen.
    expect(bodyOf("const applyDraft = useCallback")).toMatch(/node\.value = text/)
  })

  it("waits for the field to exist before putting the draft into it", () => {
    // The restore runs in an effect that is declared before the one that builds
    // the field, so on a fresh window there was no field to write to: the
    // words stayed in the state, the box looked empty, and Send had nothing to
    // send. The text waits for the field, and goes in when it is there.
    const apply = bodyOf("const applyDraft = useCallback")
    expect(apply).toMatch(/if \(!node\) \{/)
    expect(apply).toMatch(/pendingDraft\.current = text/)

    const field = bodyOf('const node = document.createElement("textarea")')
    // The field is one statement, so the whole source is what says whether the
    // queued draft is put into it.
    expect(source).toMatch(/pendingDraft\.current !== null/)
    expect(source).toMatch(/node\.value = queued/)
    expect(field).toMatch(/document\.createElement\("textarea"\)/)
  })

  it("sends what is in the field, not what the state last held", () => {
    // "Edit and resend" took the text from the state, which was still the
    // original message — so the edit was discarded and the old prompt went out
    // again.
    expect(bodyOf("const resendEdited = useCallback")).toMatch(
      /textareaRef\.current\?\.value \?\? draftRef\.current/,
    )
  })
})
