import hljs from "highlight.js/lib/common"

/**
 * Languages `highlightAuto` may guess between. `lib/common` already registers
 * them, so this list exists only to bound auto-detection — guessing across all
 * 190 bundled grammars is both slower and less accurate.
 */
const LANGUAGES = [
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "diff",
  "go",
  "graphql",
  "ini",
  "java",
  "javascript",
  "json",
  "kotlin",
  "less",
  "lua",
  "makefile",
  "markdown",
  "objectivec",
  "perl",
  "php",
  "python",
  "powershell",
  "ruby",
  "rust",
  "scss",
  "sql",
  "swift",
  "typescript",
  "vbnet",
  "wasm",
  "xml",
  "yaml",
]

/** The names agents actually write in, mapped onto the common bundle. */
const ALIASES: Record<string, string> = {
  ps1: "powershell",
  sh: "bash",
  zsh: "bash",
  console: "shell",
  yml: "yaml",
  ts: "typescript",
  js: "javascript",
  jsx: "javascript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  htm: "xml",
  xhtml: "xml",
  md: "markdown",
}

for (const [alias, target] of Object.entries(ALIASES)) {
  if (!hljs.getLanguage(alias) && hljs.getLanguage(target)) {
    hljs.registerAliases([alias], { languageName: target })
  }
}

/**
 * Cheap test for "this is source, not prose".
 *
 * highlight.js happily labels English prose as VB.NET — a sentence about
 * squares once came back tagged `vbnet`, which is worse than no highlighting
 * at all because the colours then lie. Guessing is only allowed once the text
 * carries a structural tell.
 */
const CODE_TELLS = [
  /[{};]\s*$/m,
  /^\s*(?:def|class|function|const|let|var|import|from|package|public|private|return|if|for|while|echo|export)\b/m,
  /^\s*(?:#include|#define|\$|<[A-Za-z!?]|using\s|namespace\s)/m,
  /\w+\s*=\s*[\w"'[]/,
  /^\s*[.#][a-zA-Z][\w-]*\s*\{/m,
]

/** Prose in a non-Latin script is prose, whatever punctuation it contains. */
function isMostlyNonLatin(code: string): boolean {
  const letters = code.replace(/[^\p{L}]/gu, "")
  if (letters.length < 12) return false
  const cyrillic = (letters.match(/\p{Script=Cyrillic}/gu) ?? []).length
  const cjk = (letters.match(/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/gu) ?? []).length
  return (cyrillic + cjk) / letters.length > 0.25
}

/** Box-drawing and art characters. */
const BOX_ART = /[─│┌┐└┘├┤┬┴┼╔╗╚╝║═▼▲◄►]/

/**
 * ASCII art of a cube gets confidently labelled VB.NET by the detector. Box
 * characters plus very little actual prose is the tell.
 */
function isAsciiArt(code: string): boolean {
  if (!BOX_ART.test(code)) return false
  const alnum = (code.match(/[\p{L}\p{N}]/gu) ?? []).length
  return alnum / Math.max(code.length, 1) < 0.45
}

function looksLikeCode(code: string): boolean {
  if (code.length > 20_000) return true
  if (isMostlyNonLatin(code)) return false
  if (isAsciiArt(code)) return false
  return CODE_TELLS.some((tell) => tell.test(code))
}

export interface HighlightedCode {
  html: string
  language: string
}

/**
 * Highlight `code`, falling back to escaped plain text.
 *
 * Plain text is returned as escaped markup rather than raw: the result lands in
 * the DOM through innerHTML, and model output is untrusted.
 */
export function highlight(code: string, language?: string): HighlightedCode {
  const wanted = language?.trim().toLowerCase()

  // An explicit "this is prose" marker. Reasoning traces quote PowerShell and
  // C# snippets inside English sentences, which the detector reads as source
  // with confidence; when the caller knows it is prose, guessing is wrong.
  if (wanted === "text" || wanted === "plain" || wanted === "txt" || wanted === "prose") {
    return { html: escapeHtml(code), language: "" }
  }

  if (wanted && hljs.getLanguage(wanted)) {
    try {
      return {
        html: hljs.highlight(code, { language: wanted, ignoreIllegals: true }).value,
        language: wanted,
      }
    } catch {
      /* fall through to auto-detection */
    }
  }

  // An explicit but unknown language (or none at all): guess only for source.
  if (looksLikeCode(code)) {
    try {
      const result = hljs.highlightAuto(code, LANGUAGES)
      if (result.language) {
        return { html: result.value, language: result.language }
      }
    } catch {
      /* fall through to plain text */
    }
  }

  return { html: escapeHtml(code), language: "" }
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/'/g, "&#39;")
}

/**
 * Wrap every line of highlighted markup so CSS counters can number it.
 *
 * Naively splitting the HTML on "\n" would tear a construct that legitimately
 * spans lines — a block comment or a template literal — leaving unbalanced
 * tags. Instead the fragment is parsed and walked, and a newline inside a text
 * node closes and reopens whatever spans were open at that point.
 */
export function toNumberedLines(html: string): string {
  if (typeof DOMParser === "undefined") return html

  let root: Element
  try {
    const doc = new DOMParser().parseFromString(`<body><i>${html}</i></body>`, "text/html")
    root = doc.body.firstElementChild as Element
    if (!root) return html
  } catch {
    return html
  }

  const lines: string[] = []
  let current = ""
  const open: string[] = []

  const breakLine = () => {
    current += "</span>".repeat(open.length)
    lines.push(current)
    current = open.map((cls) => `<span class="${cls}">`).join("")
  }

  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      const parts = (node.textContent ?? "").split("\n")
      parts.forEach((part, index) => {
        if (index > 0) breakLine()
        current += escapeHtml(part)
      })
      return
    }
    if (node.nodeType !== 1) return

    const element = node as Element
    const cls = element.getAttribute("class") ?? ""
    current += `<span class="${escapeAttr(cls)}">`
    open.push(cls)
    for (const child of Array.from(element.childNodes)) walk(child)
    open.pop()
    current += "</span>"
  }

  for (const child of Array.from(root.childNodes)) walk(child)
  breakLine()

  // A blank line still needs a box, or the counters drift.
  return lines.map((line) => `<span class="code-line">${line || " "}</span>`).join("\n")
}