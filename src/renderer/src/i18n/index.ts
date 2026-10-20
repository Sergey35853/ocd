import { useSyncExternalStore } from "react"
import type { UiLanguage } from "@shared/types"
import { de } from "./de"
import { en } from "./en"
import { fr } from "./fr"
import { ru, type DictKey } from "./ru"
import { zh } from "./zh"

export type { DictKey }

const DICTS = { ru, en, de, fr, zh } as const

export const LANGUAGES: ReadonlyArray<{ code: UiLanguage; label: string }> = [
  { code: "ru", label: "Русский" },
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "zh", label: "中文" },
]

function isLanguage(value: unknown): value is UiLanguage {
  return typeof value === "string" && value in DICTS
}

let current: UiLanguage = "ru"
const listeners = new Set<() => void>()

export function getLanguage(): UiLanguage {
  return current
}

export function setLanguage(next: unknown): void {
  const lang = isLanguage(next) ? next : "ru"
  if (lang === current) return
  current = lang
  if (typeof document !== "undefined") document.documentElement.lang = lang
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export type TranslateParams = Record<string, string | number>

/**
 * Look up `key` in the active dictionary, substituting `{name}` placeholders.
 * Falls back to Russian so a missing string is never rendered as a raw key.
 */
export function translate(key: DictKey, params?: TranslateParams): string {
  const dict = DICTS[current] as Record<DictKey, string> | undefined
  let text = dict?.[key] ?? (ru as Record<DictKey, string>)[key] ?? key
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

/**
 * Look up a key the dictionary may not have.
 *
 * The server names its reasoning levels itself, so the app cannot know every
 * key ahead of time. A level without a translation shows its own name rather
 * than a raw key.
 */
export function translateLoose(key: string, fallback: string): string {
  const dict = DICTS[current] as Record<string, string> | undefined
  return dict?.[key] ?? (ru as Record<string, string>)[key] ?? fallback
}

/**
 * Subscribe a component to language changes and hand it the translator.
 * Non-React modules (formatters, the store) can call `translate()` directly.
 */
export function useT(): typeof translate {
  useSyncExternalStore(subscribe, getLanguage, getLanguage)
  return translate
}