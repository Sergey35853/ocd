/**
 * Text that reaches the interface has to survive being read, copied and
 * searched, and model output does not always arrive clean.
 */

/**
 * Whether a character is invisible and carries no meaning for a reader.
 *
 * A NUL is the important one: providers have been seen sending tool-call
 * markup with NULs as padding, and it survives all the way to the screen as a
 * replacement glyph. It is invisible, it breaks copy-paste into other programs,
 * and it makes a full-text index quietly wrong.
 *
 * Zero-width and bidirectional marks go too, for the same reason with less
 * force: they exist to hide text from whoever is reading it.
 *
 * Line breaks, tabs and carriage returns are structure, not noise, so they stay.
 */
function isInvisible(code: number): boolean {
  if (code < 0x20) return code !== 0x09 && code !== 0x0a && code !== 0x0d
  if (code === 0x7f) return true
  // Zero-width space through right-to-left mark.
  if (code >= 0x200b && code <= 0x200f) return true
  // Bidirectional overrides: they reorder what is around them.
  if (code >= 0x202a && code <= 0x202e) return true
  // Word joiner and the invisible maths operators.
  if (code >= 0x2060 && code <= 0x2064) return true
  // Byte order mark.
  return code === 0xfeff
}

/**
 * Clean model output for display.
 *
 * Written as a scan rather than a regular expression on purpose: the characters
 * being removed are invisible, and a regex literal would have to spell them as
 * escapes that a reader cannot check by eye.
 */
export function cleanText(text: string): string {
  if (!text) return ""
  let out = ""
  for (const char of text) {
    if (!isInvisible(char.codePointAt(0) ?? 0)) out += char
  }
  return out
}

/**
 * Anything that looks like a tag, in either bracket style.
 *
 * The closing bracket is optional because the output is often truncated
 * mid-tag: a model that fell out of its structured channel tends to stop part
 * way through, and a dangling opening tag at the end would otherwise be read as
 * prose.
 */
const TAG_LIKE = /<[^>]*>?|\[[^\]]*\]?/g

/** A real angle-bracket tag, which is what leaked protocol always carries. */
const HAS_TAG = /<[^>]*>/

/**
 * True when the text is nothing but markup, with no answer in it.
 *
 * A model whose structured tool-call channel is unavailable sometimes falls
 * back to writing its own protocol as prose: tool_call, invoke, and whatever
 * vendor tag wraps them. That arrives as the assistant's text, and rendering it
 * as the answer makes the app look broken.
 *
 * Two conditions, both required. There must be a real tag, so that "42" and a
 * bare "[1, 2, 3]" are never mistaken for noise; and nothing readable may be
 * left once the tags are removed, so a reply that mixes genuine prose with a
 * stray tag still shows its prose.
 */
export function isUnreadable(text: string): boolean {
  const cleaned = cleanText(text)
  if (!HAS_TAG.test(cleaned)) return false
  return !/[\p{L}\p{N}]/u.test(cleaned.replace(TAG_LIKE, ""))
}
