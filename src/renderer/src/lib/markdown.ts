import MarkdownIt from "markdown-it"
import type { Token } from "markdown-it"
import { useMemo, useRef } from "react"
import { useT, type DictKey } from "../i18n"
import { escapeAttr, escapeHtml, highlight, toNumberedLines } from "./highlight"

/** Callbacks a rendered code block can raise. */
export interface CodeActions {
  /** Markup blocks hand their source to the preview pane. */
  onPreview?: (html: string, title: string) => void
}

/** Fence tags whose contents are safe and sensible to run in the pane. */
const LANGUAGES_THAT_RUN = /^(html|htm|xhtml|xml|svg)$/i

/** What an untagged block has to look like before it counts as a document. */
const DOCUMENT_START = /^\s*(<!DOCTYPE\s+html|<html\b|<svg\b)/i

/**
 * Whether this block may be handed to the preview pane.
 *
 * An untagged fence used to count as HTML, which put a working "open in pane"
 * button on ASCII-art and on JSON: the pane then rendered the drawing as a
 * text document, which looks broken rather than merely useless. The same test
 * `htmlSnippets` uses, so the button and the automatic behaviour agree.
 */
function canRun(language: string, code: string): boolean {
  const tagged = language.trim()
  if (tagged) return LANGUAGES_THAT_RUN.test(tagged)
  return code.includes("<") && DOCUMENT_START.test(code)
}

/** Bundles a code block: header with actions, the highlighted body, and the
 * raw source kept in a hidden textarea so the buttons need no side table. */
function codeBlockHtml(code: string, language: string, actions: CodeActions, t: (key: DictKey) => string): string {
  const { html, language: detected } = highlight(code, language)
  const label = escapeHtml((language || detected || "text").trim())

  const previewAction = actions.onPreview && canRun(language, code)
    ? `<button type="button" class="code-act" data-code-action="preview" title="${escapeAttr(
        t("preview.open"),
      )}">${escapeHtml(t("preview.open"))}</button>`
    : ""

  return (
    `<div class="code-block">` +
    `<div class="code-head">` +
    `<span class="code-lang">${label}</span>` +
    `<span class="spacer"></span>` +
    previewAction +
    `<button type="button" class="code-act" data-code-action="copy" title="${escapeAttr(
      t("code.copy"),
    )}">${escapeHtml(t("code.copy"))}</button>` +
    `</div>` +
    `<pre class="code-pre"><code class="hljs language-${escapeAttr(detected || "plaintext")}">${toNumberedLines(html)}</code></pre>` +
    `<textarea class="code-raw" hidden>${escapeHtml(code)}</textarea>` +
    `</div>`
  )
}

/** `<h1>` is far too loud inside a chat bubble, so headings shift down a level. */
function demoteHeadings(tokens: Token[]): void {
  for (let i = 0; i < tokens.length; i++) {
    const open = tokens[i]
    if (open.type !== "heading_open") continue
    const level = Number(open.tag.slice(1))
    if (level > 3) continue
    const close = tokens[i + 2]
    if (close?.type === "heading_close") {
      open.tag = `h${level + 1}`
      close.tag = `h${level + 1}`
    }
  }
}

/**
 * Remove the line breaks that carry no meaning.
 *
 * `breaks: true` turns every single newline into <br>, which is what makes an
 * agent's prose wrap the way it reads — but it also turns the blank line
 * between two bullet points into an empty paragraph, and a list with a stray
 * <br> per item looks like it was laid out by a fax machine.
 */
function tidyBreaks(html: string): string {
  return html
    // A break right before a closing tag adds a phantom empty line.
    .replace(/<br\s*\/?>(?=\s*<\/(?:li|p|ul|ol|h[1-6]|blockquote|pre|td|th|tr)>\s*)/g, "")
    // Two breaks in a row are a blank line the block markup already expresses.
    .replace(/(?:<br\s*\/?>\s*){2,}/g, "")
}

/**
 * Markdown renderer for assistant replies.
 *
 * Agents answer in Markdown, so rendering it is the difference between a
 * readable thread and a wall of literal `**` and pipe tables.
 *
 * Safety: `html: false` means raw tags in the source stay text, and the only
 * other place markup is produced is `highlight()`, which escapes first. Model
 * output is untrusted, so that path is deliberate.
 */
export function useMarkdown(actions: CodeActions = {}) {
  const t = useT()

  /**
   * The actions are remembered rather than depended on.
   *
   * The caller builds its callbacks afresh on every render, and a dependency
   * on that object tore the whole renderer down each time — a new MarkdownIt,
   * and the text parsed again with it. The chat redraws on every token of the
   * answer, so that was the whole history, parsed again and again.
   *
   * A ref is the right shape for this: the callbacks are read when a block is
   * rendered, and the newest ones are the ones that should be used.
   */
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  return useMemo(() => {
    const md = new MarkdownIt({
      html: false,
      linkify: true,
      breaks: true,
      typographer: false,
    })

    // External links leave for the system browser; the app never navigates.
    const fallback =
      md.renderer.rules.link_open ??
      ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts))

    md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
      const href = String(tokens[idx].attrGet("href") ?? "")
      if (/^https?:\/\//i.test(href)) {
        tokens[idx].attrSet("target", "_blank")
        tokens[idx].attrSet("rel", "noopener noreferrer")
      }
      return fallback(tokens, idx, opts, env, self)
    }

    md.renderer.rules.code_inline = (tokens, idx) =>
      `<code class="code-inline">${escapeHtml(String(tokens[idx].content))}</code>`

    md.renderer.rules.fence = (tokens, idx) => {
      const info = tokens[idx].info.trim()
      return codeBlockHtml(
        String(tokens[idx].content),
        info.split(/\s+/)[0] ?? "",
        actionsRef.current,
        t,
      )
    }

    const core = md.parse.bind(md)
    md.render = (text: string, env?: Record<string, unknown>) => {
      const tokens = core(text, env ?? {}) as Token[]
      demoteHeadings(tokens)
      return tidyBreaks(md.renderer.render(tokens, md.options, env ?? {}))
    }

    return {
      render: (text: string) => md.render(text, {}),
      inline: (text: string) => md.renderInline(text, {}),
    }
  }, [t])
}