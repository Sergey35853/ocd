import { clipboard, dialog } from "electron"
import { readFile, readdir, stat } from "node:fs/promises"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"
import { execFileSync } from "node:child_process"
import type { Attachment, PickedFiles } from "@shared/types"
import { isImage, isShortcut, mimeOf, nameForBytes, samePath } from "./fileKinds"

/**
 * The field separator used to get three strings out of one line of output.
 *
 * Written as a code, never as a literal: the character is invisible in an
 * editor and in a diff, and a stray copy of the file pastes a different one.
 */
const SEP = String.fromCharCode(30)

/**
 * The largest single file that will be sent.
 *
 * A file part is inlined into the request as base64, which costs a third again
 * in size and then becomes part of the context. A 600 MB video is not a large
 * attachment, it is an app that stops responding. The limit is stated in the
 * message rather than applied silently: the user asked for this file, and
 * quietly attaching less of it than they think is worse than refusing.
 */
const MAX_ATTACH_BYTES = 20 * 1024 * 1024

/** Inline limit for images; bigger ones are referenced by path instead. */
const MAX_INLINE_BYTES = 8 * 1024 * 1024

/**
 * How much one dropped folder may contribute.
 *
 * Small on purpose. A folder is a gesture that can mean "this whole project",
 * and answering that by attaching a thousand files would bury the question the
 * user actually asked. What is left out is named, so it can be dropped
 * separately.
 */
const MAX_FOLDER_FILES = 60
const MAX_FOLDER_BYTES = 40 * 1024 * 1024

/**
 * Directories that are never what the user meant.
 *
 * Every one of these holds either thousands of generated files or a copy of
 * every dependency, and none of it is what someone drops into a chat to be
 * read. Skipping them by name is the difference between a folder attaching in a
 * second and it appearing to hang.
 */
const SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".idea",
  ".vscode",
  ".venv",
  "venv",
  "env",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  "node_modules",
  "bower_components",
  "vendor",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".gradle",
  ".parcel-cache",
  "coverage",
  "bin",
  "obj",
  "Pods",
  "DerivedData",
  "AppData",
  "$RECYCLE.BIN",
  "System Volume Information",
])

/** A shortcut's target, as far as Windows will say. */
interface Shortcut {
  target: string
  args: string
  dir: string
}

/**
 * Where a shortcut points.
 *
 * A shortcut is a 1–2 KB shell link whose bytes mean nothing to a model: what
 * the user dropped is a pointer, and the thing they mean is the program. Asking
 * Windows is the only reliable way to follow one — the alternative is parsing
 * the link format by hand, with the argument and working-directory blocks and
 * the Unicode tail, and getting it subtly wrong.
 *
 * Null when Windows declines to answer. Advertised shortcuts created by an
 * installer resolve their target through the package cache and come back empty,
 * and that is not something this can fix — so the caller falls back to the file
 * itself rather than pretending to know.
 */
export function resolveShortcut(path: string): Shortcut | null {
  const script = [
    // Without this the output goes out in the console's own code page, and a
    // path containing anything outside ASCII comes back as mojibake — which then
    // fails to open, and looks like the shortcut pointed nowhere.
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    "$s = New-Object -ComObject WScript.Shell",
    // The path arrives in the environment, not as an argument: whatever follows
    // `-Command` is appended to the command text rather than bound to `$args`, so
    // a path passed there is read as part of the script — and a path with a
    // quote in it would change what the script says.
    "$l = $s.CreateShortcut($env:OCD_SHORTCUT)",
    // One record, joined on a control character, so a path containing a space
    // or a quote cannot split into the wrong fields.
    `[Console]::Out.Write([string]::Join([char]${SEP.charCodeAt(0)}, @($l.TargetPath, $l.Arguments, $l.WorkingDirectory)))`,
  ].join("; ")

  // Synchronous because a drop is a user action waiting on an answer: the
  // caller is about to render the result and has nothing to overlap it with.
  // `-NoProfile` because a profile can print banners into the stdout this
  // parses.
  let out: string
  try {
    out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      timeout: 8000,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, OCD_SHORTCUT: path },
    })
  } catch {
    return null
  }

  const [target, args, dir] = out.split(SEP)
  if (!target?.trim()) return null
  return { target: target.trim(), args: (args ?? "").trim(), dir: (dir ?? "").trim() }
}

/** What the model is told about a shortcut that could not be followed. */
const UNFOLLOWED = (name: string, target: string) =>
  `Windows shortcut «${name}» pointing at ${target}. The program itself is not attached — only this link.`

function withDescription(item: Attachment, description: string): Attachment {
  return { ...item, description }
}

let counter = 0
function nextId(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now()}-${counter}`
}

/** Images travel inline as data URLs so the server never needs local access. */
async function readImageAttachment(path: string): Promise<Attachment> {
  const info = await stat(path)
  const name = basename(path)
  const mime = mimeOf(path)

  if (info.size <= MAX_INLINE_BYTES) {
    const data = await readFile(path)
    const preview = `data:${mime};base64,${data.toString("base64")}`
    return {
      id: nextId("img"),
      kind: "image",
      name,
      mime,
      size: info.size,
      uri: preview,
      preview,
    }
  }

  return {
    id: nextId("img"),
    kind: "image",
    name,
    mime,
    size: info.size,
    uri: pathToFileURL(path).href,
    preview: "",
  }
}

async function readFileAttachment(path: string): Promise<Attachment> {
  const info = await stat(path)
  return {
    id: nextId("file"),
    kind: "file",
    name: basename(path),
    mime: mimeOf(path),
    size: info.size,
    uri: pathToFileURL(path).href,
    preview: "",
  }
}

/** Read one path into an attachment, reporting failures instead of throwing. */
export async function attachmentFromPath(path: string): Promise<Attachment> {
  const info = await stat(path)
  if (!info.isFile()) throw new Error(`${basename(path)}: не файл`)
  if (info.size === 0) throw new Error(`${basename(path)}: пустой файл`)
  return isImage(path) ? readImageAttachment(path) : readFileAttachment(path)
}

/** What a folder walk decided, beyond the files it kept. */
interface WalkResult {
  files: string[]
  /** Files left out because a budget ran out, named for the message. */
  tooMany: number
  tooBig: number
}

/**
 * Collect the files of one folder, in a bounded and deliberate way.
 *
 * Depth-first and sorted, so the same folder always produces the same list in
 * the same order: a list that reorders between drops makes it impossible to
 * tell whether the second drop really had fewer files.
 *
 * Skipped directories are counted, not listed — the message says how many files
 * were left out, and the user can drop the folder they meant if the count is
 * wrong.
 */
async function walkDirectory(root: string, exclude: Set<string>): Promise<WalkResult> {
  const files: string[] = []
  let tooMany = 0
  let tooBig = 0
  let bytes = 0

  async function visit(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      // A folder that cannot be read is not a failure of the drop; it is one
      // unreadable folder in a readable tree.
      return
    }

    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

    for (const entry of sorted) {
      if (files.length >= MAX_FOLDER_FILES) {
        tooMany += 1
        continue
      }
      const full = join(dir, entry.name)
      // A shortcut sitting inside the folder it points at is not part of the
      // folder's contents, and following it would attach the folder twice.
      if (exclude.has(samePath(full))) continue

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        await visit(full)
        continue
      }
      // Symlinks and junctions are not followed: a link pointing back up the
      // tree would walk forever, and a link out of it would read files the user
      // never pointed at.
      if (!entry.isFile()) continue

      let size: number
      try {
        size = (await stat(full)).size
      } catch {
        continue
      }

      if (size === 0 || size > MAX_ATTACH_BYTES) {
        tooBig += 1
        continue
      }
      if (bytes + size > MAX_FOLDER_BYTES) {
        tooBig += 1
        continue
      }

      files.push(full)
      bytes += size
    }
  }

  await visit(root)
  return { files, tooMany, tooBig }
}

/** One sentence about a folder: what came of it, and what did not. */
function describeWalk(name: string, walk: WalkResult): string {
  const parts: string[] = [`Папка «${name}»: приложено файлов ${walk.files.length}`]

  const leftOut: string[] = []
  if (walk.tooMany) leftOut.push(`${walk.tooMany} сверх лимита ${MAX_FOLDER_FILES}`)
  if (walk.tooBig) leftOut.push(`${walk.tooBig} крупнее ${MAX_ATTACH_BYTES / (1024 * 1024)} МБ или не в общий объём`)
  if (leftOut.length) parts.push(`не приложено: ${leftOut.join(", ")}`)

  return parts.join("; ")
}

/** Read one dropped path, following shortcuts and expanding folders. */
async function fromPath(
  path: string,
  notes: string[],
  errors: string[],
  /** Paths to leave out, so a shortcut never attaches the folder holding it. */
  exclude = new Set<string>(),
): Promise<Attachment[]> {
  const info = await stat(path).catch(() => null)
  if (!info) {
    errors.push(`${basename(path)}: не найден`)
    return []
  }

  // A folder is a request for its contents, not for the folder.
  if (info.isDirectory()) {
    const name = basename(path)
    const walk = await walkDirectory(path, exclude)
    notes.push(describeWalk(name, walk))

    const attachments: Attachment[] = []
    for (const file of walk.files) {
      try {
        attachments.push(await attachmentFromPath(file))
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err))
      }
    }
    return attachments
  }

  // A shortcut is a pointer; what the user means is what it points at.
  if (isShortcut(path)) {
    const name = basename(path)
    const shortcut = resolveShortcut(path)

    if (shortcut) {
      const where = await stat(shortcut.target).catch(() => null)
      if (where) {
        const from = await fromPath(shortcut.target, notes, errors, new Set([samePath(path)]))
        if (from.length) {
          // The dropped name is kept on the file, so it is obvious which
          // shortcut brought in which program.
          for (const item of from) item.name = `${item.name} ← ${name}`
          notes.push(`Ярлык «${name}» → ${shortcut.target}${shortcut.args ? ` ${shortcut.args}` : ""}`)
          return from
        }
        // The target exists but could not be attached — too large, or empty.
        // Sending nothing at all for something the user deliberately dropped is
        // the worst of the three outcomes, so the shortcut goes in and the
        // reason stays on screen.
        notes.push(
          `Ярлык «${name}» → ${shortcut.target}, но саму цель приложить не вышло — приложен ярлык`,
        )
        return [withDescription(await attachmentFromPath(path), UNFOLLOWED(name, shortcut.target))]
      }
      notes.push(`Ярлык «${name}»: цели ${shortcut.target} нет, приложен сам ярлык`)
      return [withDescription(await attachmentFromPath(path), UNFOLLOWED(name, shortcut.target))]
    }

    notes.push(
      `Ярлык «${name}»: цель хранится в базе установщика Windows, а не в самом файле — приложить нечего, перетащите саму программу`,
    )
    return [
      withDescription(
        await attachmentFromPath(path),
        // Said to the model, because the bytes will tell it nothing. An
        // advertised shortcut is a few kilobytes of shell link with no path
        // anywhere in it, and without this the model is left guessing at a file
        // it cannot possibly read.
        `Windows shortcut «${name}». Its target is held in the Windows Installer database and is not stored in this file, so there is no path here to follow and the bytes cannot be read as anything. The user dropped the shortcut, not the program.`,
      ),
    ]
  }

  if (info.size === 0) {
    errors.push(`${basename(path)}: пустой файл`)
    return []
  }
  if (info.size > MAX_ATTACH_BYTES) {
    errors.push(
      `${basename(path)}: ${Math.round(info.size / (1024 * 1024))} МБ — больше ${MAX_ATTACH_BYTES / (1024 * 1024)} МБ, такой файл в запрос не влезает`,
    )
    return []
  }

  try {
    return [await attachmentFromPath(path)]
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err))
    return []
  }
}

export async function attachmentsFromPaths(paths: string[]): Promise<PickedFiles> {
  const attachments: Attachment[] = []
  const errors: string[] = []
  const notes: string[] = []
  for (const path of paths) {
    attachments.push(...(await fromPath(path, notes, errors)))
  }
  return { attachments, errors, notes }
}

export async function pickAttachments(
  parent: Electron.BrowserWindow | null,
  kind: "image" | "file",
): Promise<PickedFiles> {
  const properties: Array<"openFile" | "openDirectory" | "multiSelections"> = kind === "image"
    ? ["openFile", "multiSelections"]
    : ["openFile", "openDirectory", "multiSelections"]

  const filters = kind === "image"
    ? [{ name: "Изображения", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"] }]
    : [
        { name: "Изображения", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"] },
        { name: "Видео", extensions: ["mp4", "webm", "mov", "mkv"] },
        { name: "Аудио", extensions: ["mp3", "wav", "ogg", "m4a"] },
        { name: "Документы", extensions: ["pdf", "txt", "md", "json", "csv", "log"] },
        { name: "Все файлы", extensions: ["*"] },
      ]

  const result = parent
    ? await dialog.showOpenDialog(parent, { properties, filters })
    : await dialog.showOpenDialog({ properties, filters })

  if (result.canceled || result.filePaths.length === 0) return { attachments: [], errors: [] }
  return attachmentsFromPaths(result.filePaths)
}

/** Grab an image from the Windows clipboard (screenshot, copy from browser…). */
export async function attachmentFromClipboard(): Promise<PickedFiles> {
  // Electron's async clipboard API: read() returns typed items.
  let items: Electron.ClipboardItem[]
  try {
    items = await clipboard.read()
  } catch {
    return { attachments: [], errors: ["Не удалось прочитать буфер обмена"] }
  }

  for (const item of items) {
    const type = item.types.find((candidate) => candidate.startsWith("image/"))
    if (!type) continue
    try {
      const blob = (await item.getType(type)) as Blob
      const buffer = Buffer.from(await blob.arrayBuffer())
      if (buffer.length === 0) continue
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
      const ext = type === "image/jpeg" ? "jpg" : type.split("/")[1] ?? "png"
      const dataUrl = `data:${type};base64,${buffer.toString("base64")}`
      return {
        attachments: [
          {
            id: nextId("clip"),
            kind: "image",
            name: `clipboard-${stamp}.${ext}`,
            mime: type,
            size: buffer.length,
            uri: dataUrl,
            preview: dataUrl,
          },
        ],
        errors: [],
      }
    } catch {
      // Try the next clipboard item.
    }
  }

  return { attachments: [], errors: ["В буфере обмена нет изображения"] }
}

/**
 * Take a file that arrived as bytes rather than as a path.
 *
 * Two ways in: an HTML paste, and a drop from a source that hands over a file
 * without a filesystem path behind it. Both land here, and the two are not the
 * same thing — so the name decides what this is, not the route it came by.
 */
export async function attachmentFromDataUrl(
  dataUrl: string,
  nameHint = "pasted.png",
): Promise<PickedFiles> {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl)
  if (!match) return { attachments: [], errors: ["Не удалось прочитать данные"] }
  const mime = match[1]
  const data = Buffer.from(match[2], "base64")
  if (data.length === 0) return { attachments: [], errors: ["Пустые данные"] }
  if (data.length > MAX_ATTACH_BYTES) {
    return {
      attachments: [],
      errors: [
        `${nameHint}: ${Math.round(data.length / (1024 * 1024))} МБ — больше ${MAX_ATTACH_BYTES / (1024 * 1024)} МБ`,
      ],
    }
  }

  const { mkdtemp, writeFile } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const dir = await mkdtemp(join(tmpdir(), "ocd-attach-"))

  // The name decides the extension, and an extension is invented only for a
  // picture that arrived without one. See nameForBytes.
  const named = nameForBytes(nameHint, mime)
  const file = join(dir, named)
  await writeFile(file, data)

  const picture = mime.startsWith("image/")
  // The name is the better source when the two disagree, which is the normal
  // case for plain text: the browser sends it as `application/octet-stream`,
  // and the extension says exactly what it is.
  const byName = mimeOf(named)

  return {
    attachments: [
      {
        id: nextId(picture ? "paste" : "bytes"),
        // Not every data URL is a picture. Marking a text file as an image made
        // every chip show a thumbnail that never appeared.
        kind: picture ? "image" : "file",
        name: named,
        mime: byName === "application/octet-stream" ? mime : byName,
        size: data.length,
        uri: `data:${mime};base64,${data.toString("base64")}`,
        preview: picture ? `data:${mime};base64,${data.toString("base64")}` : "",
      },
    ],
    errors: [],
  }
}
