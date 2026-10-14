import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
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
  const t = useT()

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
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

  return (
    <div className="picker" ref={rootRef}>
      <button
        type="button"
        className="btn"
        onClick={() => {
          setOpen((value) => !value)
          setQuery("")
        }}
      >
        {current?.label ?? label}
      </button>
      {open ? (
        <div className="menu">
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
      ) : null}
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