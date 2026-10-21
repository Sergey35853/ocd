import { useCallback, useEffect, useMemo, useState } from "react"
import { useT } from "../i18n"
import { ViewBack } from "../components/ViewBack"
import { IconCopy, IconFolder, IconRefresh, IconSearch } from "../components/Icon"

/**
 * What the app wrote down.
 *
 * The log is where everything the app swallows quietly ends up: a request
 * that failed, a preview that would not convert, a renderer that threw. Until
 * now the only way to read it was to find the file by hand and open it in
 * notepad — which is a poor answer to "it does not work".
 *
 * So the log is shown here, in the app, next to the thing it describes.
 */
export function LogView({ onBack }: { onBack: () => void }) {
  const t = useT()
  const [lines, setLines] = useState<string[]>([])
  const [needle, setNeedle] = useState("")
  const [copied, setCopied] = useState(false)

  const reload = useCallback(async () => {
    try {
      setLines(await window.ocd.diag.tail(600))
    } catch {
      setLines([])
    }
  }, [])

  useEffect(() => {
    void reload()
    // The log grows while the app works; the view keeps up on its own.
    const timer = setInterval(() => void reload(), 5000)
    return () => clearInterval(timer)
  }, [reload])

  const shown = useMemo(() => {
    const text = needle.trim().toLowerCase()
    if (!text) return lines
    return lines.filter((line) => line.toLowerCase().includes(text))
  }, [lines, needle])

  return (
    <div className="view">
      <div className="view-head">
        <ViewBack onClick={onBack} />
        <h1>{t("log.title")}</h1>
        <span className="sub">{t("log.hint")}</span>
        <div className="spacer" />
        <button
          type="button"
          className="iconbtn"
          title={t("common.refresh")}
          onClick={() => void reload()}
        >
          <IconRefresh size={15} />
        </button>
        <button
          type="button"
          className="iconbtn"
          title={t("log.openFolder")}
          onClick={() => {
            void window.ocd.diag.folder().then((folder) => {
              if (folder) void window.ocd.app.openPath(folder)
            })
          }}
        >
          <IconFolder size={15} />
        </button>
        <button
          type="button"
          className="iconbtn"
          title={copied ? t("chat.copied") : t("log.copy")}
          onClick={() => {
            void navigator.clipboard
              .writeText(shown.join("\n"))
              .then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1600)
              })
              .catch(() => undefined)
          }}
        >
          <IconCopy size={15} />
        </button>
      </div>

      <div className="log-filter">
        <IconSearch size={14} className="mag" />
        <input
          className="input"
          placeholder={t("log.filter")}
          value={needle}
          onChange={(event) => setNeedle(event.target.value)}
        />
      </div>

      <pre className="log-view mono">{shown.join("\n") || t("log.empty")}</pre>
    </div>
  )
}
