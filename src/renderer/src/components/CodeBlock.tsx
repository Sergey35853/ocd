import { useCallback } from "react"
import { useT } from "../i18n"
import { escapeHtml, highlight, toNumberedLines } from "../lib/highlight"

/**
 * A code surface with a language badge and a copy button.
 *
 * Line numbers come from CSS counters, which keeps the markup free of one
 * <span> per line — on a 2000-line diff that difference is visible.
 *
 * Used for tool output (JSON, commands) and for anything the stream chooses
 * not to hand to the Markdown renderer.
 */
export function CodeBlock({
  code,
  language,
  /** Long output starts folded; the header always stays reachable. */
  collapsible = false,
  defaultOpen = true,
  maxHeight,
}: {
  code: string
  language: string
  collapsible?: boolean
  defaultOpen?: boolean
  maxHeight?: number
}) {
  const t = useT()
  const { html, language: detected } = highlight(code, language)

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      /* clipboard denied: the text is selectable anyway */
    }
  }, [code])

  const body = (
    <pre
      className="code-pre"
      style={maxHeight ? { maxHeight } : undefined}
      tabIndex={0}
    >
      <code
        className={`hljs language-${detected || "plaintext"}`}
        dangerouslySetInnerHTML={{ __html: toNumberedLines(html) }}
      />
    </pre>
  )

  const header = (
    <div className="code-head">
      <span className="code-lang">{(language || detected || "text").trim()}</span>
      <span className="spacer" />
      <button type="button" className="code-act" title={t("code.copy")} onClick={() => void copy()}>
        {t("code.copy")}
      </button>
    </div>
  )

  if (!collapsible) {
    return (
      <div className="code-block">
        {header}
        {body}
      </div>
    )
  }

  return (
    <details className="code-block collapsible" open={defaultOpen}>
      <summary className="code-head">{t("code.expand")}</summary>
      {header}
      {body}
    </details>
  )
}

/** Escaped plain-text fallback for output the highlighter cannot read. */
export function plainBlock(code: string): string {
  return escapeHtml(code)
}