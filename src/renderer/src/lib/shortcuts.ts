/**
 * The keys the app answers to.
 *
 * Two things live here: what each action is called, and how a combination is
 * written down. The combination uses Electron's accelerator form — the same
 * one the global hotkey uses — so the recorder that already exists for it can
 * be reused here, and a binding looks the same wherever it is shown.
 *
 * The bindings belong to the user: every action can be given another
 * combination, and a binding that was given up (an empty string) is not
 * answered at all.
 */

export interface ShortcutAction {
  /** What the action does. */
  id: string
  /** The key in the translation dictionary. */
  label: string
  /** The combination it starts with. */
  accelerator: string
}

export const SHORTCUTS: ShortcutAction[] = [
  { id: "palette", label: "set.shortcutPalette", accelerator: "Control+K" },
  { id: "newSession", label: "set.shortcutNewSession", accelerator: "Control+N" },
  { id: "search", label: "set.shortcutSearch", accelerator: "Control+F" },
  { id: "closeTab", label: "set.shortcutCloseTab", accelerator: "Control+W" },
  { id: "nextTab", label: "set.shortcutNextTab", accelerator: "Control+Tab" },
  { id: "prevTab", label: "set.shortcutPrevTab", accelerator: "Control+Shift+Tab" },
  { id: "settings", label: "set.shortcutSettings", accelerator: "Control+," },
  { id: "sidebar", label: "set.shortcutSidebar", accelerator: "Control+B" },
  { id: "log", label: "set.shortcutLog", accelerator: "Control+Shift+L" },
  { id: "terminal", label: "set.shortcutTerminal", accelerator: "Control+Shift+T" },
  { id: "rename", label: "set.shortcutRename", accelerator: "F2" },
]

/** The combination an action starts with, when the user has not changed it. */
export function defaultAccelerator(id: string): string {
  return SHORTCUTS.find((item) => item.id === id)?.accelerator ?? ""
}

/** The combination an action currently answers to. */
export function acceleratorFor(
  id: string,
  bindings: Record<string, string> | undefined,
): string {
  const own = bindings?.[id]
  if (own === undefined) return defaultAccelerator(id)
  return own
}

/**
 * Whether the key that was just pressed is this combination.
 *
 * The comparison is exact: the same modifiers, the same key. A binding of
 * "Control+K" must not fire while the user holds Alt as well — a shortcut
 * that fires when it was not asked for is worse than one that does not fire.
 */
export function matchesAccelerator(event: KeyboardEvent, accelerator: string): boolean {
  if (!accelerator) return false
  const parts = accelerator.split("+")
  const key = parts.pop() ?? ""
  if (!key) return false
  const wants = {
    ctrl: parts.includes("Control") || parts.includes("CommandOrControl"),
    alt: parts.includes("Alt"),
    shift: parts.includes("Shift"),
    meta: parts.includes("Super") || parts.includes("Meta"),
  }
  if (event.ctrlKey !== wants.ctrl) return false
  if (event.altKey !== wants.alt) return false
  if (event.shiftKey !== wants.shift) return false
  if (event.metaKey !== wants.meta) return false
  const pressed = event.key.length === 1 ? event.key.toUpperCase() : event.key
  return pressed === key
}

/** The action a key press asks for, if any. */
export function actionFor(
  event: KeyboardEvent,
  bindings: Record<string, string> | undefined,
): string | null {
  for (const action of SHORTCUTS) {
    if (matchesAccelerator(event, acceleratorFor(action.id, bindings))) return action.id
  }
  return null
}

/** How a combination is shown to a person. */
export function prettyAccelerator(accelerator: string): string {
  if (!accelerator) return "—"
  return accelerator
    .split("+")
    .map((part) =>
      part === "CommandOrControl"
        ? "Ctrl"
        : part === "Plus"
          ? "+"
          : part.length === 1
            ? part.toUpperCase()
            : part,
    )
    .join("+")
}
