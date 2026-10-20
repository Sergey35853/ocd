import { useEffect, useRef, useState } from "react"
import type { FileEntry } from "@shared/types"
import { useT } from "../i18n"
import { Modal } from "./ui"

/**
 * Find a file in the project and attach it to the prompt.
 *
 * The server walks the tree itself, so the app needs no index of its own and
 * cannot fall behind the disk. What comes back is a name and a path — the
 * path is what the model is given.
 */
export function FileSearch({
  directory,
  initialQuery,
  onPick,
  onClose,
}: {
  directory?: string
  initialQuery?: string
  onPick(paths: string[]): void
  onClose(): void
}) {
  const t = useT()
  const [query, setQuery] = useState(initialQuery ?? "")
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    // An empty query would list the whole tree; the search is for names.
    if (!query.trim()) {
      setFiles([])
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(() => {
      void window.ocd.api
        .findFiles(query.trim(), directory)
        .then((found) => {
          if (!cancelled) setFiles(found)
        })
        .catch(() => {
          if (!cancelled) setFiles([])
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, directory])

  return (
    <Modal title={t("files.title")} onClose={onClose}>
      <input
        ref={inputRef}
        className="input"
        placeholder={t("files.placeholder")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="file-list">
        {loading ? <div className="file-empty">{t("files.searching")}</div> : null}
        {!loading && query.trim() && files.length === 0 ? (
          <div className="file-empty">{t("common.notFound")}</div>
        ) : null}
        {!query.trim() ? <div className="file-empty">{t("files.hint")}</div> : null}
        {files.map((file) => (
          <button
            key={file.path}
            type="button"
            className="file-row"
            onClick={() => onPick([file.path])}
          >
            <span className="file-name">{file.path.split(/[\\/]/).pop()}</span>
            <span className="file-path mono">{file.path}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}
