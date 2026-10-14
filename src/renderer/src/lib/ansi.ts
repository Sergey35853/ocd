/**
 * Strip ANSI escape sequences from command output.
 *
 * The server passes a shell result through untouched, so a command that colours
 * its output — PowerShell's Format-Table does it by default — arrives with the
 * codes still in it. Shown as text, those read as `[32;1m` noise between every
 * word.
 *
 * Written with code points rather than a literal escape character: the ESC byte
 * is invisible in a source file, and a regex nobody can check by eye is a regex
 * nobody will review.
 */

const ESC = 0x1b
const BEL = 0x07
const CSI_INTRODUCERS = new Set([0x5b, 0x5d]) // ESC [ and ESC ]

/** True for the bytes that end an escape sequence. */
function isFinalByte(code: number): boolean {
  return code >= 0x40 && code <= 0x7e
}

/**
 * Remove escape sequences, and fold the carriage returns that come with them.
 *
 * A `\r\n` pair is one line ending and not two, so it is folded first. A lone
 * `\r` is how a progress bar redraws itself, and leaving it in would collapse
 * the whole thing into one unreadable line, so it becomes a newline.
 */
export function stripAnsi(text: string): string {
  if (!text) return ""
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)

    if (code === ESC) {
      const next = text.charCodeAt(i + 1)
      // ESC ] runs until BEL or ST (ESC \); swallow the lot.
      if (next === 0x5d) {
        i += 1
        while (i < text.length) {
          const c = text.charCodeAt(i)
          if (c === BEL) break
          if (c === ESC && text.charCodeAt(i + 1) === 0x5c) {
            i += 1
            break
          }
          i += 1
        }
        continue
      }
      // ESC [ is a control sequence: parameters, then one final byte.
      if (CSI_INTRODUCERS.has(next)) {
        i += 2
        while (i < text.length && !isFinalByte(text.charCodeAt(i))) i += 1
        continue
      }
      // ESC ( B and the other two-character forms.
      if (next >= 0x20 && next <= 0x2f) {
        i += 2
        continue
      }
      i += 1
      continue
    }

    if (code === BEL) continue

    // \r\n is a single line ending.
    if (code === 0x0d) {
      if (text.charCodeAt(i + 1) === 0x0a) continue
      out += "\n"
      continue
    }

    out += text[i]
  }

  // Colour-only leftovers, and trailing spaces left by a cleared line.
  return out.replace(/[ \t]+$/gm, "")
}

/** True when the text carries escape sequences worth stripping. */
export function hasAnsi(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === ESC) return true
  }
  return false
}
