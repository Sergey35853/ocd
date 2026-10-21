import { useMemo } from "react"
import type { FileEntry } from "@shared/types"
import { cx } from "../lib/format"
import { useT } from "../i18n"
import { IconChevron, IconFile, IconFolder } from "./Icon"

/**
 * The project's files, drawn as a tree.
 *
 * The tree is built from what the server has already said: a folder is read
 * when it is opened, not before it is, because a project holds far more files
 * than anybody walks through, and the server would answer for every one of
 * them.
 *
 * What ends up on screen is therefore the part of the project the user has
 * opened — the same files, at the same paths, that the model would be given.
 */
export function FileTree({
  listings,
  open,
  selected,
  onToggle,
  onSelect,
}: {
  /** What the server said about each folder, by its path from the root. */
  listings: Record<string, FileEntry[] | undefined>
  /** Which folders are open. */
  open: Record<string, boolean>
  /** The file whose contents are on the right, if any. */
  selected: string | null
  onToggle(directory: string): void
  onSelect(path: string): void
}) {
  return (
    <div className="files-tree">
      <Branch
        directory=""
        depth={0}
        listings={listings}
        open={open}
        selected={selected}
        onToggle={onToggle}
        onSelect={onSelect}
        ancestors={[]}
      />
    </div>
  )
}

/**
 * One folder of the tree, and everything under it.
 *
 * The recursion is the tree: a folder that is open asks for its own branch,
 * and that branch asks for the folders below it. Nothing is drawn for a folder
 * the server has not answered for yet.
 */
function Branch({
  directory,
  depth,
  listings,
  open,
  selected,
  onToggle,
  onSelect,
  ancestors,
}: {
  directory: string
  depth: number
  listings: Record<string, FileEntry[] | undefined>
  open: Record<string, boolean>
  selected: string | null
  onToggle(directory: string): void
  onSelect(path: string): void
  /**
   * The folders above this one.
   *
   * A folder that is already on the way down is not drawn again: a link that
   * points back at its own parent would otherwise make the tree draw itself
   * for as long as the window is open.
   */
  ancestors: string[]
}) {
  const t = useT()
  const entries = listings[directory]

  const shown = useMemo(() => {
    if (!entries) return []
    // Folders above files: a tree reads as a tree when the branches come
    // first, and the server answers in whatever order the disk gave it.
    return [...entries].sort((a, b) => {
      const aFolder = a.type === "directory"
      const bFolder = b.type === "directory"
      if (aFolder !== bFolder) return aFolder ? -1 : 1
      return baseName(a.path).localeCompare(baseName(b.path))
    })
  }, [entries])

  if (!entries) return <div className="files-note">{t("files.loading")}</div>
  if (!entries.length) {
    // An empty folder is nothing to say; an empty project is.
    return directory === "" ? <div className="files-note">{t("files.empty")}</div> : null
  }

  return (
    <>
      {shown.map((entry) => {
        // The server says what an entry is; the shape of its path does not.
        const folder = entry.type === "directory"
        // A folder that is already on the way down is left out: the tree would
        // draw itself for ever.
        const loop = folder && ancestors.includes(entry.path)
        const isOpen = folder && !loop && Boolean(open[entry.path])
        return (
          <div key={entry.path}>
            <button
              type="button"
              className={cx("files-node", !folder && selected === entry.path && "files-node-selected")}
              style={{ paddingLeft: 8 + depth * 14 }}
              title={entry.path}
              onClick={() => (folder ? onToggle(entry.path) : onSelect(entry.path))}
            >
              <span className="files-caret">
                {folder ? <IconChevron size={12} className={cx(isOpen && "files-open")} /> : null}
              </span>
              {folder ? (
                <IconFolder size={14} className="files-icon" />
              ) : (
                <IconFile size={14} className="files-icon" />
              )}
              <span className="files-label">{baseName(entry.path)}</span>
            </button>
            {isOpen ? (
              <Branch
                directory={entry.path}
                depth={depth + 1}
                listings={listings}
                open={open}
                selected={selected}
                onToggle={onToggle}
                onSelect={onSelect}
                ancestors={[...ancestors, entry.path]}
              />
            ) : null}
          </div>
        )
      })}
    </>
  )
}

/** The last piece of a path: the name the tree shows. */
function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}
