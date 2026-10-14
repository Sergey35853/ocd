import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"
import { applyEdits, modify, parse, type Edit, type ParseError } from "jsonc-parser"
import type { ConfigFileInfo, ReplyLanguage } from "@shared/types"

function configDir(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")
  return join(base, "opencode")
}

/** Resolve the global config document, preferring JSONC when both exist. */
function resolveConfigPath(): string {
  const dir = configDir()
  const jsonc = join(dir, "opencode.jsonc")
  if (existsSync(jsonc)) return jsonc
  const json = join(dir, "opencode.json")
  if (existsSync(json)) return json
  return jsonc
}

export function configPath(): string {
  return resolveConfigPath()
}

export function readConfig(): ConfigFileInfo {
  const path = resolveConfigPath()
  if (!existsSync(path)) {
    const template = '{\n  "$schema": "https://opencode.ai/config.json"\n}\n'
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, template, "utf8")
    } catch {
      /* reported by caller on write */
    }
    return { path, text: template, exists: true }
  }
  return { path, text: readFileSync(path, "utf8"), exists: true }
}

export function writeConfig(text: string): { ok: boolean; error?: string } {
  const path = resolveConfigPath()
  const errors: ParseError[] = []
  parse(text, errors, { allowTrailingComma: true })
  if (errors.length) {
    const first = errors[0]
    return { ok: false, error: `Invalid JSON at offset ${first?.offset}: ${first?.error ?? "parse error"}` }
  }
  // Keep a single backup so a bad manual edit is recoverable.
  try {
    if (existsSync(path)) {
      renameSync(path, `${basename(path)}.ocd-backup`)
    }
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text, "utf8")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function parseConfig(text: string): Record<string, unknown> {
  const errors: ParseError[] = []
  const value = parse(text, errors, { allowTrailingComma: true }) as unknown
  if (errors.length || !value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

/** Apply a jsonc-parser edit to the current document and persist it. */
function edit(mutator: (text: string) => Edit[]): { ok: boolean; error?: string } {
  const current = readConfig().text
  try {
    const edits = mutator(current)
    const next = applyEdits(current, edits)
    return writeConfig(next)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function configPlugins(text: string): string[] {
  const cfg = parseConfig(text)
  const plugins = cfg.plugins
  if (!Array.isArray(plugins)) return []
  return plugins.filter((item): item is string => typeof item === "string")
}

export function addPlugin(spec: string): { ok: boolean; error?: string } {
  return edit((text) => {
    const existing = configPlugins(text)
    if (existing.includes(spec)) return []
    return modify(text, ["plugins"], [...existing, spec], {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    })
  })
}

export function removePlugin(spec: string): { ok: boolean; error?: string } {
  return edit((text) => {
    const existing = configPlugins(text)
    if (!existing.includes(spec)) return []
    return modify(text, ["plugins"], existing.filter((item) => item !== spec), {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    })
  })
}

export function setConfigModel(providerID: string, modelID: string): { ok: boolean; error?: string } {
  return edit((text) =>
    modify(text, ["model"], { providerID, id: modelID }, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    }),
  )
}

export function setDefaultAgent(agent: string): { ok: boolean; error?: string } {
  return edit((text) =>
    modify(text, ["default_agent"], agent, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    }),
  )
}

/**
 * The instruction file OCD owns, relative to the config document.
 *
 * `instructions` in opencode.json is a list of **paths to instruction files**,
 * not a list of instructions — "CONTRIBUTING.md", "docs/*.md". A sentence
 * written straight into that array is read as a filename, matches nothing, and
 * is dropped without a word, which is why the language setting used to look
 * broken rather than wrong. The text therefore lives in a real file beside the
 * config and the array names it.
 *
 * Relative, because the server resolves these against the config's own
 * directory: an absolute path would break the moment the config was copied to
 * another machine or another user.
 */
const LANG_FILE = "./ocd-language.md"

/**
 * Marks the file OCD owns, so a hand-written instruction of the same name is
 * never silently overwritten.
 */
const LANG_MARKER = "<!-- OCD-LANG -->"

const LANG_TEXT: Record<Exclude<ReplyLanguage, "auto">, string> = {
  ru: [
    LANG_MARKER,
    "",
    "## Язык ответа",
    "",
    "Отвечай пользователю на русском языке, если он явно не попросил другой.",
    "",
    "Пиши размышления тоже на русском. Пользователь видит их в чате отдельным",
    "блоком «Размышления», поэтому служебный текст должен быть на том же",
    "языке, что и ответ, — это не черновик для себя, а видимая часть ответа.",
    "Идентификаторы, имена файлов, команды, сообщения об ошибках и вывод",
    "программ оставляй как есть — их не переводят.",
  ].join("\n"),
  en: [
    LANG_MARKER,
    "",
    "## Reply language",
    "",
    "Reply in English unless the user explicitly asks for another language.",
    "",
    "Do your internal reasoning in English too. Leave identifiers, file names,",
    "commands, error messages and program output exactly as they are.",
  ].join("\n"),
}

/** Which reply language the managed instruction file currently enforces. */
function replyLanguageInFile(text: string): ReplyLanguage {
  if (!text.includes(LANG_MARKER)) return "auto"
  return /Отвечай пользователю на русском/.test(text) ? "ru" : "en"
}

function langFilePath(): string {
  return join(configDir(), "ocd-language.md")
}

function readLangFile(): string | null {
  try {
    return readFileSync(langFilePath(), "utf8")
  } catch {
    return null
  }
}

/**
 * Read back which reply language OCD currently enforces, or "auto" if the
 * managed instruction is absent.
 *
 * The file is the source of truth, not the config: the config only says where
 * to look, so a user who deleted the file gets "auto" even though the path is
 * still listed.
 */
export function configReplyLanguage(text: string): ReplyLanguage {
  const listed = configInstructions(text)
  if (!listed.some((item) => sameName(item, LANG_FILE))) return "auto"
  const content = readLangFile()
  return content === null ? "auto" : replyLanguageInFile(content)
}

/**
 * Whether the managed file already says what OCD wants it to say.
 *
 * Checking only the language was not enough: the file also carries the wording,
 * and OCD owns that too. With the language alone as the test, a file written by
 * an older build — or edited by hand — stayed exactly as it was forever, and a
 * reworded instruction never reached the people it was meant for.
 */
export function configLanguageCurrent(text: string, lang: ReplyLanguage): boolean {
  const listed = configInstructions(text)
  const isListed = listed.some((item) => sameName(item, LANG_FILE))
  if (lang === "auto") return !isListed
  const content = readLangFile()
  return isListed && content !== null && content.trim() === LANG_TEXT[lang].trim()
}

function configInstructions(text: string): string[] {
  const raw = parseConfig(text).instructions
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is string => typeof item === "string")
}

/** Whether two instruction entries name the same file, however they spell it. */
function sameName(entry: string, file: string): boolean {
  const clean = (value: string) => value.replace(/^\.\//, "").replace(/\\/g, "/").toLowerCase()
  return clean(entry) === clean(file)
}

/**
 * Write (or drop) the managed reply-language instruction. Other entries in
 * "instructions" are preserved exactly as the user left them.
 *
 * Two things move together and both have to succeed: the file, and the array
 * entry pointing at it. Leaving the entry behind with the file gone would leave
 * a path that matches nothing, which is the state this whole thing exists to
 * avoid.
 */
export function setReplyLanguage(lang: ReplyLanguage): { ok: boolean; error?: string } {
  const file = langFilePath()

  if (lang !== "auto") {
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, `${LANG_TEXT[lang]}\n`, "utf8")
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  return edit((text) => {
    const kept = configInstructions(text).filter(
      // Both spellings go: the path this build owns, and the bare sentence older
      // builds wrote. Leaving the sentence behind would keep a filename-shaped
      // entry in the array forever, and would re-trigger the repair on every
      // start.
      (item) => !sameName(item, LANG_FILE) && !item.startsWith("OCD-LANG:"),
    )
    const next = lang === "auto" ? kept : [...kept, LANG_FILE]
    return modify(text, ["instructions"], next, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    })
  })
}

/**
 * Repair an instruction entry written as plain text rather than as a path.
 *
 * Older builds put the sentence straight into `instructions`, where the server
 * read it as a filename and ignored it. Called once when the app starts, so a
 * user who set the language before the fix does not have to set it again — and
 * does not keep silently getting English answers.
 */
export function repairLegacyLanguageInstruction(): { ok: boolean; error?: string } {
  const text = readConfig().text
  const raw = parseConfig(text).instructions
  if (!Array.isArray(raw)) return { ok: true }

  const legacy = raw.find(
    (item): item is string => typeof item === "string" && item.startsWith("OCD-LANG:"),
  )
  if (!legacy) return { ok: true }

  const lang: ReplyLanguage = legacy.includes("русском") ? "ru" : "en"
  return setReplyLanguage(lang)
}

function configProviders(text: string): Record<string, Record<string, unknown>> {
  const raw = parseConfig(text).provider
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const out: Record<string, Record<string, unknown>> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = value as Record<string, unknown>
    }
  }
  return out
}

/**
 * Merge settings into provider.<id>. Only the provider being touched is
 * rewritten, so hand-written entries elsewhere survive untouched.
 */
export function setConfigProvider(
  providerID: string,
  patch: { apiKey?: string; baseURL?: string; npm?: string },
): { ok: boolean; error?: string } {
  const id = providerID.trim()
  if (!id) return { ok: false, error: "Пустой идентификатор провайдера" }
  return edit((text) => {
    const existing = configProviders(text)[id] ?? {}
    const options: Record<string, unknown> = {
      ...(existing.options && typeof existing.options === "object" && !Array.isArray(existing.options)
        ? (existing.options as Record<string, unknown>)
        : {}),
    }
    if (patch.apiKey) options.apiKey = patch.apiKey
    if (patch.baseURL) options.baseURL = patch.baseURL

    const next: Record<string, unknown> = { ...existing, options }
    if (patch.npm) next.npm = patch.npm
    // An empty key would keep the provider "configured but broken".
    if (!Object.keys(options).length) delete next.options

    return modify(text, ["provider", id], next, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    })
  })
}

/** Drop provider.<id> from the config. */
export function removeConfigProvider(providerID: string): { ok: boolean; error?: string } {
  const id = providerID.trim()
  if (!id) return { ok: false, error: "Пустой идентификатор провайдера" }
  return edit((text) =>
    // jsonc-parser removes the key when the new value is undefined.
    modify(text, ["provider", id], undefined, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    }),
  )
}

/** Which providers the config already declares, with a key masked for display. */
export function configProvidersSummary(text: string): Array<{
  id: string
  hasKey: boolean
  baseURL?: string
  npm?: string
}> {
  return Object.entries(configProviders(text)).map(([id, value]) => {
    const options = (value.options && typeof value.options === "object" ? value.options : {}) as Record<
      string,
      unknown
    >
    return {
      id,
      hasKey: typeof options.apiKey === "string" && options.apiKey.length > 0,
      baseURL: typeof options.baseURL === "string" ? options.baseURL : undefined,
      npm: typeof value.npm === "string" ? value.npm : undefined,
    }
  })
}