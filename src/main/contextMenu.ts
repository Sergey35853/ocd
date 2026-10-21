import { clipboard, Menu } from "electron"
import { attachmentFromClipboard, pickAttachments } from "./attachments"
import type { PickedFiles } from "@shared/types"

/** Where the right click happened, so the menu can offer the right items. */
export type ContextTarget = "input" | "stream"

/** Electron 44 reads the clipboard asynchronously, so check before building the menu. */
async function clipboardHasImage(): Promise<boolean> {
  try {
    const items = await clipboard.read()
    return items.some((item) => item.types.some((type) => type.startsWith("image/")))
  } catch {
    return false
  }
}

function sendAttachments(
  win: Electron.BrowserWindow | null,
  pending: Promise<PickedFiles>,
): void {
  void pending
    .then((picked) => {
      if (!win || win.isDestroyed()) return
      win.webContents.send("ocd:attach", picked)
    })
    .catch(() => undefined)
}

export async function showContextMenu(
  win: Electron.BrowserWindow | null,
  target: ContextTarget,
  messageId?: string,
): Promise<void> {
  const isInput = target === "input"
  const hasImage = await clipboardHasImage()

  const template: Electron.MenuItemConstructorOptions[] = []

  // Text roles work natively: the menu drives the focused element's selection.
  if (isInput) {
    template.push(
      { role: "cut", label: "Вырезать" },
      { role: "copy", label: "Копировать" },
      { role: "paste", label: "Вставить" },
    )
  } else {
    template.push({ role: "copy", label: "Копировать" })
  }

  // A rewind to a message: the window asks for it, the window shows what it
  // would cost, and only then is it applied.
  if (!isInput && messageId) {
    template.push({ type: "separator" }, {
      label: "Откатить к этому сообщению…",
      click: () => {
        if (!win || win.isDestroyed()) return
        win.webContents.send("ocd:revert-request", { messageId })
      },
    })
  }

  template.push({ type: "separator" })

  if (hasImage) {
    template.push({
      label: "Вставить изображение",
      click: () => sendAttachments(win, attachmentFromClipboard()),
    })
  }
  template.push({
    label: "Прикрепить файл…",
    click: () => sendAttachments(win, pickAttachments(win, "file")),
  })

  if (isInput) {
    template.push({ type: "separator" }, { role: "selectAll", label: "Выделить всё" })
  }

  const menu = Menu.buildFromTemplate(template)
  if (win && !win.isDestroyed()) menu.popup({ window: win })
  else menu.popup()
}