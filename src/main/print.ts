import { BrowserWindow, webContents } from "electron"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ExportPayload } from "./export"

/**
 * Print a conversation.
 *
 * The document is staged to a temp file and printed from an offscreen window —
 * the same two constraints the PDF export already proved: a hidden window
 * needs `offscreen: true` to load anything, and only the first window of a
 * process will take a `data:` URL. A file sidesteps the second entirely.
 *
 * Unlike the PDF export this ends in the system print dialog rather than a
 * file, because "print" means printer (or PDF-via-printer) and silently
 * writing a file under a print button is the kind of surprise that erodes
 * trust in a menu.
 */
export async function printConversation(
  payload: ExportPayload,
  parent: BrowserWindow | null,
  html: string,
): Promise<{ ok: boolean; canceled?: boolean; error?: string }> {
  const dir = await mkdtemp(join(tmpdir(), "ocd-print-"))
  const file = join(dir, "print.html")

  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { offscreen: true, javascript: false, sandbox: true },
  })

  try {
    await writeFile(file, html, "utf8")
    await win.loadFile(file)
    await new Promise<void>((resolve) => {
      const cap = setTimeout(resolve, 2000)
      win.webContents.once("paint", () => {
        clearTimeout(cap)
        resolve()
      })
    })

    const printed = await new Promise<boolean>((resolve) => {
      // print() opens the dialog on Windows only when called with a callback;
      // the promise form is not implemented for silent printing there.
      ;(webContents as unknown as { print(w: unknown, o: unknown, cb: (s: boolean, r?: string) => void): void }).print(win.webContents, {
        silent: false,
        printBackground: true,
        pageSize: "A4",
      }, (success: boolean, reason?: string) => {
        if (!success && reason && reason !== "cancelled") {
          console.error("Print failed:", reason)
        }
        resolve(success || reason === "cancelled" || !reason)
      })
    })

    return { ok: printed }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    if (!win.isDestroyed()) win.destroy()
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

