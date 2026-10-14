import type { MessageInfo } from "@shared/types"
import { textOf } from "./format"

export interface TaskItem {
  text: string
  done: boolean
  /** Message the checklist was found in, for a stable React key. */
  source: string
}

/**
 * Pull a checklist out of a conversation.
 *
 * Models plan in plain Markdown (`- [ ]` / `- [x]`, sometimes numbered or
 * `*`), so the newest assistant message wins: a later plan supersedes an
 * earlier one and the user is looking for the current state, not the whole
 * history of intentions. Lines nested under a checkbox keep their indentation
 * so the board reads like the list the model wrote.
 */
export function sessionTasks(messages: MessageInfo[]): TaskItem[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    const text = textOf(message.content ?? [])
    if (!text) continue

    const items = parseChecklist(text)
    if (items.length >= 2) return items

    // A lone checkbox is usually prose ("нажмите [x]"), not a plan.
    if (items.length === 1) {
      const only = items[0]
      // One checkbox that names the work in full is still a useful board.
      if (only.text.length >= 12) return items
    }
  }
  return []
}

const CHECKBOX = /^\s{0,6}(?:[-*+]\s+|\d+[.)]\s+)?\[([ xX~-])\]\s*(.*)$/

function parseChecklist(text: string): TaskItem[] {
  const items: TaskItem[] = []
  for (const raw of text.split(/\r?\n/)) {
    const match = CHECKBOX.exec(raw)
    if (!match) continue
    const body = match[2].trim()
    if (!body) continue
    items.push({
      text: body,
      done: match[1].toLowerCase() === "x",
      source: raw,
    })
  }
  return items
}

export interface TaskProgress {
  done: number
  total: number
  ratio: number
}

export function taskProgress(items: TaskItem[]): TaskProgress {
  const total = items.length
  const done = items.filter((item) => item.done).length
  return { done, total, ratio: total ? done / total : 0 }
}