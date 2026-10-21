import { useCallback, useEffect, useRef, useState } from "react"
import type { Checkpoint, FileEntry } from "@shared/types"
import { useStore } from "../lib/store"
import { cx } from "../lib/format"
import { serverChanges, type FileChange } from "../lib/diff"
import { useT } from "../i18n"
import { ViewBack } from "../components/ViewBack"
import { FileTree } from "../components/FileTree"
import { DiffView } from "../components/DiffView"
import { IconChevron, IconEdit, IconFile, IconFolder, IconRefresh, IconTrash } from "../components/Icon"

/** What the app managed to make of the file it was asked to read. */
type Verdict = "none" | "loading" | "binary" | "tooBig"

/** Past this the text is not something anybody reads in a window. */
const MAX_PREVIEW = 512 * 1024

/**
 * The project's files, as the server sees them.
 *
 * The server reads the filesystem for the project the conversation runs in,
 * and it knows where that project is — which the window does not. So the tree
 * here is the server's tree: the same folders, the same paths, the same files
 * the model would be given, and the only way to see a file the app cannot
 * show is to hand it to the system's editor.
 */
export function FilesView({ onBack }: { onBack: () => void }) {
  const store = useStore()
  const t = useT()
  const toast = store.toast
  const directory = store.directory

  /** What the server said about each folder, by its path from the project root. */
  const [listings, setListings] = useState<Record<string, FileEntry[] | undefined>>({})
  /** Which folders are open. */
  const [open, setOpen] = useState<Record<string, boolean>>({})
  /** The file on the right, by its path from the project root. */
  const [selected, setSelected] = useState<string | null>(null)
  /** What came back when that file was read. */
  const [content, setContent] = useState<string | null>(null)
  const [verdict, setVerdict] = useState<Verdict>("none")
  /** The server's own words, when the read failed for a reason of its own. */
  const [failure, setFailure] = useState<string | null>(null)

  /**
   * Read one folder.
   *
   * The server is asked for a folder by its path from the project root and
   * answers with paths from the same root; both sides of the conversation
   * speak the same language here, and the app does not keep an index of its
   * own that could fall behind the disk.
   */
  const load = useCallback(
    async (dir: string) => {
      try {
        const entries = await window.ocd.api.fsList(dir || undefined, directory || undefined)
        setListings((current) => ({
          ...current,
          [dir]: entries
            .map((entry) => ({ ...entry, path: underDirectory(dir, entry.path) }))
            // A folder cannot be inside itself. An answer that says so would
            // make the tree draw itself again and again, and the window would
            // run out of memory before the user could do anything about it.
            .filter((entry) => entry.path !== dir),
        }))
      } catch (err) {
        setListings((current) => ({ ...current, [dir]: [] }))
        toast(err instanceof Error ? err.message : String(err), "error")
      }
    },
    [directory, toast],
  )

  // The project can change under the view — another folder is picked, or the
  // window opens on a conversation that lives somewhere else — and the tree of
  // one project says nothing about another.
  useEffect(() => {
    setListings({})
    setOpen({})
    setSelected(null)
    setContent(null)
    setVerdict("none")
    setFailure(null)
    void load("")
  }, [load])

  /**
   * Ask again for what is on screen.
   *
   * The tree is a cache of the server's answers; a refresh throws it away and
   * asks for the root and for every folder that is open, so a file that
   * appeared while the view was open shows up.
   */
  const refresh = useCallback(() => {
    const dirs = Object.keys(open).filter((dir) => open[dir])
    setListings({})
    void load("")
    for (const dir of dirs) void load(dir)
  }, [load, open])

  const toggle = useCallback(
    (dir: string) => {
      const isOpen = Boolean(open[dir])
      setOpen((current) => ({ ...current, [dir]: !isOpen }))
      // A folder is read when it is opened, not before: the tree of a real
      // project is large, and nobody is going to look at all of it.
      if (!isOpen && listings[dir] === undefined) void load(dir)
    },
    [listings, load, open],
  )

  /**
   * What the repository itself says it changed.
   *
   * The tree shows the files; this shows the ones git has something to say
   * about — the changes that are waiting to be committed, whether this
   * conversation made them or not.
   */
  const [mode, setMode] = useState<"tree" | "diff">("tree")
  const [changes, setChanges] = useState<FileChange[]>([])
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffOpen, setDiffOpen] = useState<Record<string, boolean>>({})
  /**
   * The snapshots of the changed files.
   *
   * The way back from a change the agent made wrongly is the copy that was
   * made before it — and it has to be made before, not after.
   */
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  const [checkpointBusy, setCheckpointBusy] = useState(false)

  const loadDiff = useCallback(async () => {
    setDiffLoading(true)
    try {
      const files = await window.ocd.api.vcsDiff("working", directory || undefined)
      setChanges(serverChanges(files))
    } catch (err) {
      setChanges([])
      toast(err instanceof Error ? err.message : String(err), "error")
    } finally {
      setDiffLoading(false)
    }
  }, [directory, toast])

  const loadCheckpoints = useCallback(async () => {
    try {
      setCheckpoints(await window.ocd.app.checkpoints())
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error")
    }
  }, [toast])

  /** Take a snapshot of what is changed right now. */
  const saveCheckpoint = useCallback(async () => {
    setCheckpointBusy(true)
    try {
      const made = await window.ocd.app.checkpointSave(directory || undefined)
      toast(t("project.checkpointSaved", { n: made.files.length }), "info")
      await loadCheckpoints()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error")
    } finally {
      setCheckpointBusy(false)
    }
  }, [directory, loadCheckpoints, t, toast])

  /** Put the files of a snapshot back. */
  const restoreCheckpoint = useCallback(
    async (id: string) => {
      setCheckpointBusy(true)
      try {
        const result = await window.ocd.app.checkpointRestore(id)
        toast(t("project.checkpointRestored", { n: result.restored }), "info")
        await loadDiff()
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "error")
      } finally {
        setCheckpointBusy(false)
      }
    },
    [loadDiff, t, toast],
  )

  const deleteCheckpoint = useCallback(
    async (id: string) => {
      try {
        await window.ocd.app.checkpointDelete(id)
        await loadCheckpoints()
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "error")
      }
    },
    [loadCheckpoints, toast],
  )

  // The diff is read when it is asked for, not on every visit: it is a
  // question about the repository, and the answer goes stale on its own.
  useEffect(() => {
    if (mode !== "diff") return
    void loadDiff()
    void loadCheckpoints()
  }, [mode, loadDiff, loadCheckpoints])

  /** The file whose read is the current one; an older answer is ignored. */
  const wanted = useRef<string | null>(null)

  const select = useCallback(
    async (path: string) => {
      wanted.current = path
      setSelected(path)
      setContent(null)
      setFailure(null)
      setVerdict("loading")
      try {
        const text = await window.ocd.api.fsRead(path, directory || undefined)
        // The user may have picked another file while this one was being read.
        if (wanted.current !== path) return
        const bad = classify(text)
        if (bad) {
          setVerdict(bad)
          return
        }
        setContent(text)
        setVerdict("none")
      } catch (err) {
        if (wanted.current !== path) return
        const message = err instanceof Error ? err.message : String(err)
        setFailure(message)
        setVerdict(classifyFailure(message) ?? "none")
      }
    },
    [directory],
  )

  /**
   * Hand the file to the system.
   *
   * The app shows what it can show; the editor is what shows everything else,
   * and it wants an absolute path — while the server's paths start at the
   * project folder.
   */
  const openInEditor = useCallback(
    (path: string) => {
      const target = absolutePath(directory, path)
      if (!target) return
      void window.ocd.app.openPath(target).catch((err) =>
        toast(err instanceof Error ? err.message : String(err), "error"),
      )
    },
    [directory, toast],
  )

  const note =
    verdict === "loading"
      ? t("files.loading")
      : verdict === "binary"
        ? t("files.binary")
        : verdict === "tooBig"
          ? t("files.tooBig")
          : (failure ?? "")

  return (
    <div className="view">
      <div className="view-head">
        <ViewBack onClick={onBack} />
        <h1>{t("project.title")}</h1>
        {/* Two questions about the same project: what is in it, and what is
            different about it. */}
        <div className="seg">
          <button
            type="button"
            className={cx(mode === "tree" && "on")}
            onClick={() => setMode("tree")}
          >
            {t("project.modeTree")}
          </button>
          <button
            type="button"
            className={cx(mode === "diff" && "on")}
            onClick={() => setMode("diff")}
          >
            {t("project.modeDiff")}
          </button>
        </div>
        <div className="spacer" />
        <span className="sub mono files-path" title={directory}>
          {directory}
        </span>
        <button
          type="button"
          className="iconbtn"
          title={t("common.refresh")}
          onClick={mode === "tree" ? refresh : () => void loadDiff()}
        >
          <IconRefresh size={15} />
        </button>
      </div>

      <div className="files-layout">
        {mode === "tree" ? (
          <>
        <div className="card files-panel">
          <div className="card-head">
            <IconFolder size={16} />
            {t("files.tree")}
          </div>
          <FileTree
            listings={listings}
            open={open}
            selected={selected}
            onToggle={toggle}
            onSelect={(path) => void select(path)}
          />
        </div>

        <div className="card files-panel">
          <div className="card-head">
            <IconFile size={16} />
            {t("files.content")}
            <div className="spacer" />
            {selected ? (
              <span className="sub mono files-path" title={selected}>
                {selected}
              </span>
            ) : null}
            {selected ? (
              <button
                type="button"
                className="btn"
                disabled={!directory}
                title={t("files.openInEditor")}
                onClick={() => openInEditor(selected)}
              >
                <IconEdit size={13} />
                {t("files.openInEditor")}
              </button>
            ) : null}
          </div>
          <div className="card-body files-content">
            {content !== null ? (
              <pre className="mono files-preview">{content}</pre>
            ) : (
              <div className="files-note">{note || t("project.title")}</div>
            )}
          </div>
        </div>
          </>
        ) : (
          <div className="card files-panel">
            <div className="card-head">
              <IconEdit size={16} />
              {t("project.modeDiff")}
              <div className="spacer" />
              <span className="sub">{t("project.diffHint")}</span>
              <button
                type="button"
                className="btn"
                disabled={checkpointBusy}
                title={t("project.checkpointHint")}
                onClick={() => void saveCheckpoint()}
              >
                {t("project.checkpointSave")}
              </button>
              <button
                type="button"
                className="iconbtn tiny"
                title={t("common.refresh")}
                disabled={diffLoading}
                onClick={() => void loadDiff()}
              >
                <IconRefresh size={13} />
              </button>
            </div>
            <div className="card-body files-content">
              {checkpoints.length ? (
                <div className="files-checkpoints">
                  {checkpoints.map((item) => (
                    <div key={item.id} className="row" style={{ gap: 6 }}>
                      <span className="grow">
                        <span className="mono">{new Date(item.at).toLocaleString()}</span>
                        {item.branch ? <span className="desc"> · {item.branch}</span> : null}
                        <span className="desc"> · {t("project.checkpointFiles", { n: item.files.length })}</span>
                      </span>
                      <button
                        type="button"
                        className="btn"
                        disabled={checkpointBusy}
                        onClick={() => void restoreCheckpoint(item.id)}
                      >
                        {t("project.checkpointRestore")}
                      </button>
                      <button
                        type="button"
                        className="iconbtn tiny"
                        title={t("project.checkpointDelete")}
                        onClick={() => void deleteCheckpoint(item.id)}
                      >
                        <IconTrash size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              {diffLoading && changes.length === 0 ? (
                <div className="files-note">{t("files.loading")}</div>
              ) : changes.length === 0 ? (
                <div className="files-note">{t("project.diffEmpty")}</div>
              ) : (
                changes.map((change) => {
                  const open = diffOpen[change.path] === true
                  return (
                    <div key={change.path} className="change">
                      <div className="change-row">
                        <button
                          type="button"
                          className="change-name"
                          aria-expanded={open}
                          title={change.path}
                          onClick={() =>
                            setDiffOpen((state) => ({ ...state, [change.path]: !open }))
                          }
                        >
                          <IconChevron size={12} className={cx("caret", open && "open")} />
                          <span className="change-label">{change.path}</span>
                        </button>
                        <span className="diff-stat add">+{change.stats.added}</span>
                        <span className="diff-stat del">−{change.stats.removed}</span>
                      </div>
                      {open ? (
                        <div className="change-body">
                          <DiffView lines={change.lines} limit={240} />
                        </div>
                      ) : null}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The entry's path from the project root.
 *
 * The server keeps the paths of the entries relative to the place it was asked
 * about, which is the project; a folder read on its own can also answer with
 * the names inside it. Both spellings are the same file, and the tree needs
 * one of them.
 */
function underDirectory(dir: string, path: string): string {
  const clean = path.replace(/\\/g, "/").replace(/\/+$/, "")
  const base = dir.replace(/\\/g, "/").replace(/\/+$/, "")
  if (!base) return clean
  if (clean === base || clean.startsWith(`${base}/`)) return clean
  return `${base}/${clean}`
}

/**
 * Whether the text can be shown at all.
 *
 * A file that is not text arrives as bytes the server decoded into a string,
 * and there is nothing in it to read: the window would only print noise. A
 * file that is too large is text, but showing a megabyte of it is not reading
 * it either.
 */
function classify(text: string): "binary" | "tooBig" | null {
  if (text.length > MAX_PREVIEW) return "tooBig"
  // A NUL byte is what a binary file looks like once it has been decoded.
  if (text.includes("\u0000")) return "binary"
  // Bytes that were not text arrive as the replacement character; a few of them
  // are a text file with a stray byte in it, a wall of them is not text.
  const broken = text.split("\uFFFD").length - 1
  if (broken > 8 && broken * 20 > text.length) return "binary"
  return null
}

/**
 * What the server said about a file it would not read.
 *
 * Its own words are the only evidence there is, so the message is read for the
 * two reasons the app knows how to explain; anything else is shown as it is.
 */
function classifyFailure(message: string): "binary" | "tooBig" | null {
  const lower = message.toLowerCase()
  if (/(too large|too big|exceeds|size limit|too much)/.test(lower)) return "tooBig"
  if (/(binary|not text|not a text|encoding|utf-8|decode)/.test(lower)) return "binary"
  return null
}

/**
 * The file's own path on the disk.
 *
 * The server answers with paths from the project root and the shell wants an
 * absolute path, so the two are joined — with the separator the system expects,
 * which on Windows is a backslash.
 */
function absolutePath(directory: string, relative: string): string {
  const base = directory.replace(/[\\/]+$/, "")
  const tail = relative.replace(/\\/g, "/").replace(/^\/+/, "")
  if (!base || !tail) return ""
  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent
  const windows = /^[a-zA-Z]:/.test(base) || /Windows/.test(agent)
  return windows ? `${base}\\${tail.replace(/\//g, "\\")}` : `${base}/${tail}`
}
