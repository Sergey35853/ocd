import { useCallback, useEffect, useRef, useState } from "react"
import { Field, Modal, useAnchoredMenu } from "./ui"
import { IconClip, IconTrash } from "./Icon"
import { useT } from "../i18n"
import {
  newTemplate,
  placeholders,
  readTemplates,
  writeTemplates,
  type PromptTemplate,
} from "../lib/templates"

/**
 * The user's own starting points for a prompt.
 *
 * The button opens a list of them; choosing one puts its text into the
 * composer, with the placeholders marked, so the user writes over the holes
 * instead of hunting for them. The list is the user's own — it lives on this
 * machine, and the server never sees it.
 */
export function TemplatePicker({ onInsert }: { onInsert(text: string): void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [editing, setEditing] = useState<PromptTemplate | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const box = useAnchoredMenu(open, rootRef, 260, 340)

  const reload = useCallback(() => setTemplates(readTemplates()), [])

  useEffect(() => {
    if (!open) return
    reload()
  }, [open, reload])

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

  const remove = (id: string) => {
    const next = templates.filter((item) => item.id !== id)
    writeTemplates(next)
    setTemplates(next)
  }

  const save = (template: PromptTemplate) => {
    const next = templates.some((item) => item.id === template.id)
      ? templates.map((item) => (item.id === template.id ? template : item))
      : [...templates, template]
    writeTemplates(next)
    setTemplates(next)
    setEditing(null)
  }

  return (
    <div ref={rootRef} style={{ display: "contents" }}>
      <button
        type="button"
        className="iconbtn"
        title={t("tpl.title")}
        onClick={() => setOpen((value) => !value)}
      >
        <IconClip size={15} />
      </button>

      {open ? (
        <div
          className="picker-menu"
          ref={menuRef}
          role="menu"
          style={{ top: box?.top, left: box?.left, width: box?.width, maxHeight: box?.maxHeight }}
        >
          {templates.length === 0 ? (
            <div className="desc" style={{ padding: "8px 10px" }}>
              {t("tpl.empty")}
            </div>
          ) : (
            templates.map((item) => (
              <div key={item.id} className="row" style={{ gap: 4 }}>
                <button
                  type="button"
                  className="grow linkbtn"
                  title={t("tpl.insert")}
                  onClick={() => {
                    onInsert(item.text)
                    setOpen(false)
                  }}
                >
                  {item.name}
                </button>
                <button
                  type="button"
                  className="iconbtn tiny"
                  title={t("tpl.edit")}
                  onClick={() => {
                    setEditing(item)
                    setOpen(false)
                  }}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="iconbtn tiny"
                  title={t("tpl.remove")}
                  onClick={() => remove(item.id)}
                >
                  <IconTrash size={12} />
                </button>
              </div>
            ))
          )}
          <div className="navmenu-sep" />
          <button
            type="button"
            className="linkbtn"
            onClick={() => {
              setOpen(false)
              setEditing(newTemplate("", ""))
            }}
          >
            {t("tpl.add")}
          </button>
        </div>
      ) : null}

      {editing ? (
        <TemplateEditor
          template={editing}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      ) : null}
    </div>
  )
}

/**
 * The editor for one template.
 *
 * The placeholders are listed under the text: a template with a hole in it
 * that the user cannot see is a template they will get wrong.
 */
function TemplateEditor({
  template,
  onClose,
  onSave,
}: {
  template: PromptTemplate
  onClose(): void
  onSave(template: PromptTemplate): void
}) {
  const t = useT()
  const [name, setName] = useState(template.name)
  const [text, setText] = useState(template.text)
  const holes = placeholders(text)

  return (
    <Modal
      title={t("tpl.title")}
      onClose={onClose}
      actions={
        <button
          type="button"
          className="btn primary"
          disabled={!text.trim()}
          onClick={() => onSave({ ...template, name: name.trim() || template.name, text })}
        >
          {t("common.save")}
        </button>
      }
    >
      <Field label={t("tpl.name")}>
        <input
          className="input"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Field label={t("tpl.text")} hint={t("tpl.hint")}>
        <textarea
          className="input"
          rows={8}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </Field>
      {holes.length ? (
        <div className="desc">
          {"{"}
          {holes.map((hole) => hole.name).join("}{")}
          {"}"}
        </div>
      ) : null}
    </Modal>
  )
}
