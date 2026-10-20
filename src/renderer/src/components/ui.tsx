import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react"
import { createPortal } from "react-dom"
import { cx } from "../lib/format"
import { useT } from "../i18n"
import { IconSearch } from "./Icon"

export function Switch({
  on,
  onChange,
}: {
  on: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      className="switch"
      data-on={on}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
    />
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <>
      <div className="field">
        <label>{label}</label>
        <div>{children}</div>
      </div>
      {hint ? <div className="field"><div /><div className="hint">{hint}</div></div> : null}
    </>
  )
}

export function Modal({
  title,
  onClose,
  actions,
  children,
}: {
  title: string
  onClose: () => void
  actions?: ReactNode
  children: ReactNode
}) {
  const t = useT()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <strong>{title}</strong>
          <div className="spacer" />
          {actions}
          <button type="button" className="iconbtn" onClick={onClose} aria-label={t("common.close")}>
            ✕
          </button>
        </header>
        <div className="body">{children}</div>
      </div>
    </div>
  )
}

export interface PickerItem {
  key: string
  label: string
  hint?: string
  group?: string
  disabled?: boolean
}

export interface AnchorBox {
  top: number
  left: number
  width: number
  maxHeight: number
}

/**
 * Where to hang a floating menu, in window coordinates.
 *
 * The menu is drawn in the document body rather than next to its button,
 * because the chat header scrolls sideways on a narrow window — and a scroll
 * container clips its children. A dropdown that hangs below the button ends
 * up inside the header's box and is cut off: it is there in the DOM, the
 * user just cannot see it. Rendering it in the body and placing it by hand
 * is the only way out, and it also keeps the menu off the bottom edge of a
 * short window.
 */
export function useAnchoredMenu(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  minWidth = 320,
  maxWidth = 420,
  gap = 6,
  maxHeight = 420,
): AnchorBox | null {
  const [box, setBox] = useState<AnchorBox | null>(null)

  const place = useCallback(() => {
    const el = anchorRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const width = Math.min(maxWidth, Math.max(minWidth, window.innerWidth - 24))
    const left = Math.min(
      Math.max(8, rect.right - width),
      Math.max(8, window.innerWidth - width - 8),
    )
    const top = rect.bottom + gap
    setBox({
      top,
      left,
      width,
      maxHeight: Math.max(120, Math.min(maxHeight, window.innerHeight - top - 12)),
    })
  }, [anchorRef, minWidth, maxWidth, gap, maxHeight])

  useLayoutEffect(() => {
    if (!open) {
      setBox(null)
      return
    }
    place()
    // The anchor moves with the window and with any scrolling around it.
    const onChange = () => place()
    window.addEventListener("resize", onChange)
    window.addEventListener("scroll", onChange, true)
    return () => {
      window.removeEventListener("resize", onChange)
      window.removeEventListener("scroll", onChange, true)
    }
  }, [open, place])

  return box
}

export function Picker({
  label,
  items,
  selected,
  onSelect,
  title,
  searchable,
}: {
  label: string
  items: PickerItem[]
  selected: string
  onSelect: (key: string) => void
  title: string
  searchable?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const box = useAnchoredMenu(open, rootRef)
  const t = useT()

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const current = items.find((item) => item.key === selected)
  const needle = query.trim().toLowerCase()
  const filtered = needle
    ? items.filter(
        (item) =>
          item.label.toLowerCase().includes(needle) ||
          (item.hint ?? "").toLowerCase().includes(needle),
      )
    : items

  // Preserve group ordering while filtering.
  const groups: Array<{ name: string; rows: PickerItem[] }> = []
  for (const item of filtered) {
    const name = item.group ?? ""
    const bucket = groups.find((group) => group.name === name)
    if (bucket) bucket.rows.push(item)
    else groups.push({ name, rows: [item] })
  }

  const menu = (
    <div
      className="picker-menu"
      ref={menuRef}
      role="listbox"
      style={{ top: box?.top, left: box?.left, width: box?.width, maxHeight: box?.maxHeight }}
    >
      {searchable ? (
        <div className="search" style={{ padding: "2px 2px 6px" }}>
          <IconSearch size={14} className="mag" />
          <input
            autoFocus
            placeholder={t("common.search")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      ) : null}
      {filtered.length === 0 ? (
        <div style={{ padding: "10px", color: "var(--text-faint)" }}>{t("common.notFound")}</div>
      ) : null}
      {groups.map((group) => (
        <div key={group.name || "_"}>
          {group.name ? <div className="head">{group.name}</div> : null}
          {group.rows.map((item) => (
            <button
              key={item.key}
              type="button"
              className={cx("item", item.key === selected && "sel")}
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return
                onSelect(item.key)
                setOpen(false)
              }}
            >
              <span className="grow">{item.label}</span>
              {item.hint ? (
                <span style={{ color: "var(--text-faint)", fontSize: 11 }}>{item.hint}</span>
              ) : null}
            </button>
          ))}
        </div>
      ))}
    </div>
  )

  return (
    <div className="picker" ref={rootRef}>
      <button
        type="button"
        className="btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value)
          setQuery("")
        }}
      >
        {current?.label ?? label}
      </button>
      {open && box ? createPortal(menu, document.body) : null}
      <span style={{ display: "none" }}>{title}</span>
    </div>
  )
}

export interface Toast {
  id: number
  text: string
  kind: "info" | "error"
}

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[]
  onDismiss: (id: number) => void
}) {
  return (
    <div className="toast-wrap">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cx("toast", toast.kind === "error" && "err")}
          onClick={() => onDismiss(toast.id)}
        >
          {toast.text}
        </div>
      ))}
    </div>
  )
}