import { translate, type DictKey } from "../i18n"

/** Descriptions for the built-in OpenCode agents.
 *
 * The server ships English copy (and none at all for the internal agents), so
 * OCD keeps its own table and falls back to a generated line for anything it
 * does not know about.
 */
const DESCRIPTIONS: Record<string, DictKey> = {
  build: "agent.build",
  general: "agent.general",
  explore: "agent.explore",
  plan: "agent.plan",
  compaction: "agent.compaction",
  title: "agent.title",
  summary: "agent.summary",
}

/** Reasonable wording for agents this build does not know about. */
const BY_MODE: Record<string, DictKey> = {
  primary: "agent.byPrimary",
  subagent: "agent.bySubagent",
  all: "agent.byAll",
}

export function describeAgent(id: string, mode?: string): string {
  return translate(DESCRIPTIONS[id] ?? BY_MODE[mode ?? "all"] ?? BY_MODE.all)
}

/** Human-readable mode badge, translated. */
export function modeLabel(mode?: string): string {
  switch (mode) {
    case "primary":
      return translate("cap.modePrimary")
    case "subagent":
      return translate("cap.modeSubagent")
    default:
      return mode ?? ""
  }
}