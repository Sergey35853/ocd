import { BrowserWindow, dialog } from "electron"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** What the renderer hands over: a ready-made Markdown document. */
export interface ExportPayload {
  sessionId: string
  title: string
  markdown: string
  format: "markdown" | "html" | "pdf"
  messages: number
}

export interface ExportResult {
  ok: boolean
  canceled?: boolean
  path?: string
  error?: string
}

const EXT: Record<ExportPayload["format"], string> = {
  markdown: "md",
  html: "html",
  pdf: "pdf",
}

/** Strip characters Windows refuses in a filename. */
function safeName(title: string, fallback: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|\r\n\t]/g, " ").replace(/\s+/g, " ").trim()
  const name = cleaned || fallback || "conversation"
  return name.length > 80 ? name.slice(0, 80).trim() : name
}

/**
 * Write text the app produced itself — a patch, today — where the user says.
 *
 * Separate from the conversation export because nothing here is Markdown to be
 * wrapped in a document: a patch has to reach the disk byte for byte or `git
 * apply` refuses it. The extension is checked against a plain pattern rather
 * than trusted, because it ends up in a file filter and in a default path.
 */
export async function saveText(
  payload: { name: string; content: string; ext: string },
  parent: BrowserWindow | null,
): Promise<ExportResult> {
  const ext = /^[a-z0-9]{1,8}$/i.test(payload.ext) ? payload.ext.toLowerCase() : "txt"
  try {
    const name = safeName(payload.name, "changes")
    const filters = [{ name: ext.toUpperCase(), extensions: [ext] }]
    const result = parent
      ? await dialog.showSaveDialog(parent, { defaultPath: `${name}.${ext}`, filters })
      : await dialog.showSaveDialog({ defaultPath: `${name}.${ext}`, filters })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }

    await writeFile(result.filePath, payload.content, "utf8")
    return { ok: true, path: result.filePath }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Inline stylesheet for the HTML/PDF export.
 *
 * Deliberately self-contained: the file has to render correctly in a browser
 * opened from disk, with no external CSS and no fonts to fetch. Colours are
 * hard-coded rather than taken from the app theme, because the export is a
 * separate artefact and must not change with the acrylic theme.
 */
const HTML_SHELL = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>{title}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 40px 44px 56px;
    background: #ffffff;
    color: #1b1b1f;
    font: 15px/1.62 "Segoe UI", system-ui, -apple-system, sans-serif;
  }
  header.doc { border-bottom: 1px solid #dcdce3; padding-bottom: 14px; margin-bottom: 26px; }
  header.doc h1 { margin: 0 0 4px; font-size: 21px; font-weight: 600; letter-spacing: -0.01em; }
  header.doc p { margin: 0; color: #6a6a74; font-size: 12.5px; }
  section.msg { margin: 0 0 22px; }
  section.msg > h2 {
    margin: 0 0 7px;
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: #6a6a74;
  }
  section.msg.user > h2 { color: #0f6cbd; }
  .body { white-space: pre-wrap; overflow-wrap: anywhere; }
  .body p { margin: 0 0 10px; }
  .body p:last-child { margin-bottom: 0; }
  .body ul, .body ol { margin: 0 0 10px; padding-left: 22px; }
  .body li { margin: 2px 0; }
  .body blockquote {
    margin: 0 0 10px;
    padding: 2px 0 2px 12px;
    border-left: 3px solid #d7d7de;
    color: #4a4a52;
  }
  .body code {
    font-family: "Cascadia Mono", Consolas, "SF Mono", monospace;
    font-size: 13px;
    background: #f1f1f5;
    border-radius: 4px;
    padding: 1px 4px;
  }
  .body pre {
    margin: 0 0 12px;
    padding: 12px 14px;
    background: #f6f6f9;
    border: 1px solid #e3e3ea;
    border-radius: 7px;
    overflow-x: auto;
    white-space: pre;
  }
  .body pre code { background: none; padding: 0; font-size: 12.5px; line-height: 1.5; }
  .body table { border-collapse: collapse; margin: 0 0 12px; }
  .body td, .body th { border: 1px solid #dcdce3; padding: 5px 9px; font-size: 13.5px; }
  .body h1, .body h2, .body h3, .body h4 { margin: 18px 0 8px; font-size: 16px; }
  .body a { color: #0f6cbd; }
  .body img { max-width: 100%; }
  footer.doc { margin-top: 34px; padding-top: 12px; border-top: 1px solid #dcdce3; color: #8a8a94; font-size: 11.5px; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
<header class="doc">
  <h1>{title}</h1>
  <p>OCD — OpenCode Deck · {count}</p>
</header>
{body}
<footer class="doc">Экспорт из OCD</footer>
</body>
</html>
`

/** Minimal Markdown -> HTML for the export; the renderer sends plain blocks. */
function markdownToHtml(markdown: string): string {
  const escaped = markdown
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")

  const out: string[] = []
  /**
   * Code lines are buffered and flushed as one string: joining them with the
   * rest of the document would leave a newline right after the opening tag,
   * which is exactly the shape markdown-it avoids.
   */
  let code: string[] = []
  let inCode = false
  let listType: "ul" | "ol" | null = null

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`)
      listType = null
    }
  }

  const flushCode = () => {
    out.push(`<pre><code>${code.join("\n")}\n</code></pre>`)
    code = []
  }

  for (const raw of escaped.split(/\r?\n/)) {
    const line = raw.trimEnd()

    if (/^```/.test(line)) {
      closeList()
      if (inCode) flushCode()
      inCode = !inCode
      continue
    }
    if (inCode) {
      code.push(line)
      continue
    }
    if (!line.trim()) {
      closeList()
      continue
    }

    // Inline code and bold/italic before the line-level rules, so markers
    // inside a heading still render.
    const inline = line
      .replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|\W)\*([^*\n]+)\*/g, "$1<em>$2</em>")

    const heading = /^(#{1,6})\s+(.*)$/.exec(inline)
    const unordered = /^[-*]\s+(.*)$/.exec(inline)
    const ordered = /^\d+[.)]\s+(.*)$/.exec(inline)
    const quote = /^&gt;\s?(.*)$/.exec(inline)

    if (heading) {
      closeList()
      const level = Math.min(heading[1].length + 2, 6)
      out.push(`<h${level}>${heading[2]}</h${level}>`)
      continue
    }
    if (unordered || ordered) {
      const wanted = unordered ? "ul" : "ol"
      if (listType !== wanted) {
        closeList()
        out.push(`<${wanted}>`)
        listType = wanted
      }
      out.push(`<li>${(unordered ? unordered[1] : ordered![1]).trim()}</li>`)
      continue
    }
    if (quote) {
      closeList()
      out.push(`<blockquote>${quote[1]}</blockquote>`)
      continue
    }
    if (/^(-{3,}|\*{3,})$/.test(inline)) {
      closeList()
      out.push("<hr>")
      continue
    }

    closeList()
    out.push(`<p>${inline}</p>`)
  }

  closeList()
  if (inCode) flushCode()
  return out.join("\n")
}

/** Markdown with a title heading, used for the .md export. */
function markdownDocument(payload: ExportPayload): string {
  const stamp = new Date().toLocaleString("ru-RU")
  return `# ${payload.title || "Беседа"}\n\n_OCD — OpenCode Deck · ${payload.messages} сообщ. · ${stamp}_\n\n${payload.markdown.trim()}\n`
}

/**
 * Render Markdown/HTML/PDF to a file the user picks.
 *
 * PDF goes through an offscreen window: `printToPDF` only exists on a
 * webContents, and reusing a real one would flash a stray window. The window
 * never shows and is destroyed as soon as the bytes come back.
 */
export async function exportConversation(
  payload: ExportPayload,
  parent: BrowserWindow | null,
): Promise<ExportResult> {
  try {
    const name = safeName(payload.title, payload.sessionId)
    const filters =
      payload.format === "markdown"
        ? [{ name: "Markdown", extensions: ["md"] }]
        : payload.format === "html"
          ? [{ name: "HTML", extensions: ["html"] }]
          : [{ name: "PDF", extensions: ["pdf"] }]

    const result = parent
      ? await dialog.showSaveDialog(parent, { defaultPath: `${name}.${EXT[payload.format]}`, filters })
      : await dialog.showSaveDialog({ defaultPath: `${name}.${EXT[payload.format]}`, filters })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }

    if (payload.format === "markdown") {
      await writeFile(result.filePath, markdownDocument(payload), "utf8")
      return { ok: true, path: result.filePath }
    }

    const html = conversationHtml(payload)

    if (payload.format === "html") {
      await writeFile(result.filePath, html, "utf8")
      return { ok: true, path: result.filePath }
    }

    const pdf = await printHtmlToPdf(html)
    await writeFile(result.filePath, pdf)
    return { ok: true, path: result.filePath }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Escape the characters that would otherwise be markup.
 *
 * The title is a piece of text the user typed, and the exported document is
 * opened from disk by a browser: a title carrying a `<` would open a tag
 * there.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * Build the standalone HTML document for a conversation.
 *
 * Shared by the file exports and by printing, so a printed page and a saved
 * .html are the same document - a divergence there would stay invisible until
 * someone compared the two.
 */
export function conversationHtml(payload: ExportPayload): string {
  const values: Record<string, string> = {
    title: esc(payload.title || "Беседа"),
    count: `${payload.messages} сообщ.`,
    body: markdownToHtml(payload.markdown),
  }
  // One pass over the template: a replacement that went in first would be
  // scanned by the next one, and a title holding "{body}" would turn into the
  // whole conversation.
  return HTML_SHELL.replace(/\{(title|count|body)\}/g, (_match, key: string) => values[key] ?? "")
}

/**
 * Print an HTML string to PDF bytes without ever showing a window.
 *
 * Two constraints, both found the hard way:
 *  - the window must be offscreen, otherwise a hidden window refuses to load
 *    anything and `printToPDF` never runs;
 *  - the document must come from a temp *file*. A `data:` URL works in the
 *    first window of a process and fails with ERR_FAILED in every later one,
 *    which is exactly when an export happens — the app already has its main
 *    window by then.
 */
async function printHtmlToPdf(html: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "ocd-pdf-"))
  const file = join(dir, "export.html")
  await writeFile(file, html, "utf8")

  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { offscreen: true, javascript: false, sandbox: true },
  })

  try {
    await win.loadFile(file)

    // printToPDF needs a laid-out frame. A fixed sleep is a race; the first
    // `paint` event is the actual guarantee, with a cap so a document that
    // never paints degrades to a timeout error instead of hanging the export.
    await new Promise<void>((resolve) => {
      const cap = setTimeout(resolve, 2000)
      win.webContents.once("paint", () => {
        clearTimeout(cap)
        resolve()
      })
    })

    return await Promise.race([
      win.webContents.printToPDF({
        pageSize: "A4",
        printBackground: true,
        margins: { top: 0.5, bottom: 0.5, left: 0.6, right: 0.6 },
      }),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error("PDF_TIMEOUT")), 20_000),
      ),
    ])
  } finally {
    if (!win.isDestroyed()) win.destroy()
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}



