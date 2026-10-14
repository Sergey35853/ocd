import type { Attachment } from "@shared/types"
import { IconChip, IconCube, IconImage, IconSpeaker, IconTerminal } from "./Icon"

/**
 * The glyph that says what kind of thing this is.
 *
 * A row of attachments that all carry the same picture icon tells the user
 * nothing they did not already know, and the one thing they need to check — "is
 * this the file I meant?" — is exactly what the icon should answer. Chosen from
 * the MIME the file was read as, so it agrees with what the model will get.
 */
export function attachmentIcon(item: Attachment, size = 13) {
  const mime = item.mime || "application/octet-stream"

  // An image with a thumbnail already shows itself.
  if (item.kind === "image" && item.preview) return <IconImage size={size} />
  if (mime.startsWith("image/")) return <IconImage size={size} />
  if (mime.startsWith("audio/")) return <IconSpeaker size={size} />
  // Archives and executables: an opaque container, which is the honest picture.
  if (/(zip|compressed|x-tar|gzip|portable-executable|x-ms-shortcut)/.test(mime)) {
    return <IconCube size={size} />
  }
  // Source, documents and anything that arrives as text all get read line by
  // line, so they share one glyph. Video is left to the fallback: there is no
  // play icon in the set, and a terminal is a worse lie than a generic chip.
  if (
    mime.startsWith("text/") ||
    mime.startsWith("video/") ||
    mime === "application/pdf" ||
    mime.includes("officedocument")
  ) {
    return <IconTerminal size={size} />
  }
  return <IconChip size={size} />
}
