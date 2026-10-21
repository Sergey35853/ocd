import { app } from "electron"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Checkpoint, CheckpointFile } from "@shared/types"
import { service } from "./service"
import { log } from "./log"

/**
 * Snapshots of the changed files, taken before something risky happens.
 *
 * The agent changes files; when it changes them wrongly, the way back is the
 * copy that was made before. The server knows which files differ from the
 * commit, and it can read and write them — so a snapshot is that: the
 * current content of the changed files, kept on this machine, and a way to put
 * it back.
 *
 * The files are read through the server rather than from the disk directly:
 * the server is the one that knows where the project is, and a project may
 * live on another machine entirely.
 */

export type { Checkpoint, CheckpointFile }

interface Manifest {
  id: string
  at: number
  directory: string
  branch: string
  files: CheckpointFile[]
}

/** Where the snapshots live: next to the settings, in the app's own folder. */
function root(): string {
  return join(app.getPath("userData"), "checkpoints")
}

function manifestPath(id: string): string {
  return join(root(), id, "manifest.json")
}

/** The folder a snapshot keeps its copies in. */
function payloadPath(id: string): string {
  return join(root(), id, "files")
}

function readManifest(id: string): Manifest | null {
  try {
    const file = manifestPath(id)
    if (!existsSync(file)) return null
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Manifest
    if (!parsed?.id) return null
    return parsed
  } catch {
    return null
  }
}

/** Every snapshot this machine holds, newest first. */
export function listCheckpoints(): Checkpoint[] {
  const out: Checkpoint[] = []
  try {
    if (!existsSync(root())) return out
    for (const entry of readdirSync(root())) {
      const manifest = readManifest(entry)
      if (!manifest) continue
      out.push({
        id: manifest.id,
        at: manifest.at,
        directory: manifest.directory,
        branch: manifest.branch ?? "",
        files: manifest.files ?? [],
      })
    }
  } catch (err) {
    log.warn("could not read the checkpoints", err)
  }
  return out.sort((a, b) => b.at - a.at)
}

/** The files the server says differ from the commit. */
async function changedFiles(directory: string): Promise<string[]> {
  const body = (await service.get<unknown>("/api/vcs/diff", {
    mode: "working",
    ...(directory ? { "location[directory]": directory } : {}),
  })) as { data?: Array<{ file?: string }> } | Array<{ file?: string }>
  const list = Array.isArray(body) ? body : (body.data ?? [])
  return list
    .map((item) => item.file)
    .filter((file): file is string => typeof file === "string" && file.length > 0)
}

/** The branch the project is on, when the server can say. */
async function currentBranch(directory: string): Promise<string> {
  try {
    const body = (await service.get<{ current?: string } | { data?: { current?: string } }>(
      "/api/vcs/branch",
      directory ? { "location[directory]": directory } : {},
    )) as { current?: string; data?: { current?: string } }
    return body?.current ?? body?.data?.current ?? ""
  } catch {
    return ""
  }
}

/**
 * Take a snapshot of the changed files.
 *
 * A file that cannot be read is skipped rather than failing the whole
 * snapshot: half a snapshot is worth more than none, and the manifest says
 * exactly which files it holds.
 */
export async function saveCheckpoint(directory: string): Promise<Checkpoint> {
  const files = await changedFiles(directory)
  const id = `cp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const payload = payloadPath(id)
  mkdirSync(payload, { recursive: true })

  const kept: CheckpointFile[] = []
  for (const file of files) {
    try {
      const encoded = file
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/")
      const body = await service.get<string>(`/api/fs/read/${encoded}`, {
        ...(directory ? { "location[directory]": directory } : {}),
      })
      const text = typeof body === "string" ? body : String((body as { data?: unknown })?.data ?? "")
      const target = join(payload, ...file.split(/[\\/]/).filter(Boolean))
      mkdirSync(join(target, ".."), { recursive: true })
      writeFileSync(target, text, "utf8")
      kept.push({ path: file, size: Buffer.byteLength(text, "utf8") })
    } catch (err) {
      log.warn(`could not read ${file} for the checkpoint`, err)
    }
  }

  const manifest: Manifest = {
    id,
    at: Date.now(),
    directory,
    branch: await currentBranch(directory),
    files: kept,
  }
  writeFileSync(manifestPath(id), JSON.stringify(manifest, null, 2), "utf8")
  return manifest
}

/**
 * Put the files back.
 *
 * The copy is written through the server, because the server is the one that
 * knows where the project is. A file the snapshot does not hold is left alone:
 * a snapshot of what was changed then is not a snapshot of what is there now.
 */
export async function restoreCheckpoint(id: string): Promise<{ restored: number }> {
  const manifest = readManifest(id)
  if (!manifest) throw new Error("Чекпойнт не найден")
  const payload = payloadPath(id)
  let restored = 0
  for (const file of manifest.files) {
    const source = join(payload, ...file.path.split(/[\\/]/).filter(Boolean))
    if (!existsSync(source)) continue
    const body = readFileSync(source)
    await service.post(
      `/api/experimental/fs/write?path=${encodeURIComponent(file.path)}`,
      body,
      manifest.directory ? { "location[directory]": manifest.directory } : {},
    )
    restored += 1
  }
  return { restored }
}

/** Forget a snapshot. The files it holds go with it. */
export function deleteCheckpoint(id: string): boolean {
  const folder = join(root(), id)
  if (!existsSync(folder)) return false
  try {
    rmSync(folder, { recursive: true, force: true })
    return true
  } catch (err) {
    log.warn("could not delete the checkpoint", err)
    return false
  }
}

/** How much disk the snapshots take, for the settings screen. */
export function checkpointsSize(): number {
  let total = 0
  try {
    if (!existsSync(root())) return 0
    for (const entry of readdirSync(root())) {
      const folder = join(root(), entry)
      if (!statSync(folder).isDirectory()) continue
      for (const file of readdirSync(folder)) {
        const path = join(folder, file)
        if (statSync(path).isFile()) total += statSync(path).size
      }
    }
  } catch {
    /* the size is decoration */
  }
  return total
}
