import { useCallback, useEffect, useRef, useState } from "react"
import { cx } from "../lib/format"
import { useT, type DictKey } from "../i18n"
import { IconClose, IconPanel, IconPin, IconRefresh } from "./Icon"
import type { PreviewKind } from "@shared/preview"

/** Must match PREVIEW_PARTITION in src/main/index.ts. The partition is what
 * lets main attach the guest preload to this guest and nothing else. */
const PARTITION = "persist:ocd-preview"

const GUEST_EXTERNAL_CHANNEL = "preview-open-external"

/** Badges naming what the pane is actually showing. */
const KIND_LABEL: Record<PreviewKind, DictKey> = {
  markup: "preview.kindMarkup",
  image: "preview.kindImage",
  video: "preview.kindVideo",
  pdf: "preview.kindPdf",
  document: "preview.kindDocument",
  sheet: "preview.kindSheet",
  slides: "preview.kindSlides",
  drawing: "preview.kindDrawing",
}

/** Why the pane could not show the file, when the converter is to blame. */
const ERROR_TEXT: Record<string, DictKey> = {
  missing: "preview.missing",
  "office-missing": "preview.officeMissing",
  "office-failed": "preview.officeFailed",
  "raster-missing": "preview.rasterMissing",
  "raster-failed": "preview.rasterFailed",
  "visio-failed": "preview.visioFailed",
  unsupported: "preview.unsupported",
}

/** Formats whose own viewer paints a dark surface whatever the app theme is. */
const DARK_KINDS = new Set<PreviewKind>(["video", "pdf"])

/**
 * React's own `webview` types cover the attributes but not the element API or
 * its events, so the slice used here is declared locally.
 */
interface WebviewElement extends HTMLWebViewElement {
  reloadIgnoringCache(): void
  getURL(): string
}

export interface PreviewTarget {
  /** file:// URL the pane loads. */
  url: string
  title: string
  /** Human-readable origin of the content: a file path or "ответ модели". */
  origin: string
  kind: PreviewKind
  route: "native" | "office" | "raster" | "visio"
  error?: string
}

interface Props {
  /** null = the pane is up but has nothing to show yet. */
  target: PreviewTarget | null
  /** Pinned panes keep their target when a new snippet is opened. */
  pinned: boolean
  /**
   * Path currently being converted, if any.
   *
   * A .docx or .heic has to be run through LibreOffice or ImageMagick first,
   * which takes seconds. Without this the pane would sit empty and the user
   * has no way to tell a slow conversion from a hang.
   */
  preparing: string | null
  onTogglePin(): void
  onClose(): void
}

export function PreviewPane({ target, pinned, preparing, onTogglePin, onClose }: Props) {
  const t = useT()
  const viewRef = useRef<WebviewElement | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState<string | null>(null)
  const url = target?.url

  // A re-staged snippet can land on the same path, so reset on every target
  // change and let the listeners below report the real outcome.
  useEffect(() => {
    setLoading(true)
    setFailed(null)
  }, [url])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const onLoadStop = () => {
      setLoading(false)
      setFailed(null)
    }
    const onFail = (event: Event) => {
      const detail = event as Event & {
        errorCode?: number
        errorDescription?: string
        isMainFrame?: boolean
      }
      if (detail.isMainFrame === false) return
      setLoading(false)
      setFailed(detail.errorDescription ?? `ERR_${detail.errorCode ?? "?"}`)
    }
    // The guest forwards a trusted click on an `_blank` anchor; main re-checks
    // the scheme before anything reaches the OS.
    const onIpc = (event: Event) => {
      const detail = event as Event & { channel?: string; args?: unknown[] }
      if (detail.channel !== GUEST_EXTERNAL_CHANNEL) return
      const url = detail.args?.[0]
      if (typeof url === "string") void window.ocd.preview.openExternal(url)
    }

    view.addEventListener("load-stop", onLoadStop)
    view.addEventListener("did-fail-load", onFail)
    view.addEventListener("ipc-message", onIpc)
    return () => {
      view.removeEventListener("load-stop", onLoadStop)
      view.removeEventListener("did-fail-load", onFail)
      view.removeEventListener("ipc-message", onIpc)
    }
  }, [url])

  const reload = useCallback(() => {
    setFailed(null)
    setLoading(true)
    viewRef.current?.reloadIgnoringCache()
  }, [])

  const conversionError = target?.error ? ERROR_TEXT[target.error] : null

  return (
    <section className={cx("preview", pinned && "pinned")} aria-label={t("preview.pane")}>
      <header className="preview-head">
        <span className="preview-title" title={target?.title}>
          {target?.title ?? t("preview.pane")}
        </span>
        {target ? (
          <span className="preview-origin mono" title={target.origin}>
            {target.origin}
          </span>
        ) : null}
        {target && target.route !== "native" ? (
          <span className="badge" title={t("preview.convertedHint")}>
            {t(KIND_LABEL[target.kind])}
          </span>
        ) : null}
        {target && loading && !failed ? (
          <span className="spinner" role="status" aria-label={t("preview.loading")} />
        ) : null}
        <div className="spacer" />
        <button
          type="button"
          className="iconbtn"
          title={t("preview.reload")}
          disabled={!target}
          onClick={reload}
        >
          <IconRefresh size={14} />
        </button>
        <button
          type="button"
          className={cx("iconbtn", pinned && "active")}
          title={pinned ? t("preview.unpin") : t("preview.pin")}
          aria-pressed={pinned}
          onClick={onTogglePin}
        >
          <IconPin size={14} />
        </button>
        <button
          type="button"
          className="iconbtn"
          title={t("preview.openInBrowser")}
          disabled={!target}
          onClick={() => target && void window.ocd.preview.openExternal(toExternal(target.url))}
        >
          ↗
        </button>
        <button type="button" className="iconbtn" title={t("common.close")} onClick={onClose}>
          <IconClose size={14} />
        </button>
      </header>

      <div className={cx("preview-body", target && DARK_KINDS.has(target.kind) && "dark")}>
        {!target && preparing ? (
          <div className="preview-empty">
            <span className="preview-spinner" aria-hidden="true" />
            <div>{t("preview.preparing")}</div>
            <div className="preview-hint">{preparing.split(/[\\/]/).pop()}</div>
          </div>
        ) : null}
        {!target && !preparing ? (
          <div className="preview-empty">
            <IconPanel size={30} />
            <div>{t("preview.empty")}</div>
            <div className="preview-hint">{t("preview.emptyHint")}</div>
          </div>
        ) : null}
        {target && conversionError ? (
          <div className="preview-failed">
            <div>{t(conversionError)}</div>
            <div className="preview-hint">{t("preview.failedHint")}</div>
          </div>
        ) : null}
        {target && failed ? (
          <div className="preview-failed">
            <div>{t("preview.failed")}</div>
            <code>{failed}</code>
            <div className="preview-hint">{t("preview.failedHint")}</div>
          </div>
        ) : null}
        {/* No allowpopups: a guest cannot spawn a window, and the only way out
            is the audited _blank handoff above. */}
        {target ? (
          <webview
            ref={viewRef}
            className={cx("preview-frame", (conversionError || failed) && "hidden")}
            src={target.url}
            partition={PARTITION}
          />
        ) : null}
      </div>
    </section>
  )
}

/**
 * file:// URLs are refused by the main-process scheme check, so a local preview
 * needs a real path for "open in browser" to mean anything.
 */
function toExternal(url: string): string {
  if (!url.startsWith("file://")) return url
  try {
    return decodeURIComponent(new URL(url).pathname).replace(/^\/([A-Za-z]:)/, "$1")
  } catch {
    return url
  }
}
