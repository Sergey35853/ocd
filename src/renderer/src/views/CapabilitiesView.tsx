import { useCallback, useMemo, useState } from "react"
import { useStore } from "../lib/store"
import { cx, truncate } from "../lib/format"
import { describeAgent, modeLabel } from "../lib/agentDescriptions"
import { IconRefresh, IconSearch } from "../components/Icon"
import { ViewBack } from "../components/ViewBack"
import { useT, type DictKey } from "../i18n"

type Tab = "agents" | "commands" | "skills" | "mcp"

const TABS: Array<{ id: Tab; label: DictKey }> = [
  { id: "agents", label: "cap.tabAgents" },
  { id: "commands", label: "cap.tabCommands" },
  { id: "skills", label: "cap.tabSkills" },
  { id: "mcp", label: "cap.tabMcp" },
]

export function CapabilitiesView({ onBack }: { onBack: () => void }) {
  const store = useStore()
  const t = useT()
  const [tab, setTab] = useState<Tab>("agents")
  const [query, setQuery] = useState("")

  const needle = query.trim().toLowerCase()
  // Its own hook rather than a bare closure: every list below is memoised on
  // `needle`, and a function rebuilt on each render cannot be listed as a
  // dependency without rebuilding the memos too.
  const match = useCallback(
    (text: string) => !needle || text.toLowerCase().includes(needle),
    [needle],
  )

  const agents = useMemo(
    () =>
      store.agents.filter((agent) =>
        // Match both the server's English copy and the Russian text shown.
        match(
          `${agent.id} ${agent.name} ${agent.description ?? ""} ${describeAgent(agent.id, agent.mode)}`,
        ),
      ),
    [store.agents, match],
  )
  const commands = useMemo(
    () => store.commands.filter((item) => match(`${item.name} ${item.description ?? ""}`)),
    [store.commands, match],
  )
  const skills = useMemo(
    () =>
      store.skills.filter((skill) =>
        match(`${skill.name ?? skill.id} ${skill.description ?? ""}`),
      ),
    [store.skills, match],
  )
  const mcp = useMemo(
    () => store.mcp.filter((server) => match(`${server.name ?? server.id ?? ""}`)),
    [store.mcp, match],
  )

  return (
    <div className="view">
      <div className="view-head">
        <ViewBack onClick={onBack} />
        <h1>{t("cap.title")}</h1>
        <span className="sub">{t("cap.subtitle")}</span>
        <div className="spacer" />
        <button type="button" className="iconbtn" title={t("common.refresh")} onClick={() => void store.refreshCatalog()}>
          <IconRefresh size={15} />
        </button>
      </div>

      <div className="tabs">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={cx(tab === item.id && "active")}
            onClick={() => setTab(item.id)}
          >
            {t(item.label)}
            <span style={{ color: "var(--text-faint)", marginLeft: 6, fontSize: 11 }}>
              {
                item.id === "agents"
                  ? store.agents.length
                  : item.id === "commands"
                    ? store.commands.length
                    : item.id === "skills"
                      ? store.skills.length
                      : store.mcp.length
              }
            </span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <div className="search" style={{ width: 260, alignSelf: "center", marginBottom: 6 }}>
          <IconSearch size={14} className="mag" />
          <input
            placeholder={t("cap.filter")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      {tab === "agents" ? (
        <div className="card">
          {agents.length === 0 ? (
            <div className="card-body" style={{ color: "var(--text-faint)" }}>{t("cap.noAgents")}</div>
          ) : (
            agents.map((agent) => (
              <div className="row" key={agent.id}>
                <div className="grow">
                  <div className="name">{agent.name || agent.id}</div>
                  <div className="desc">
                    {truncate(describeAgent(agent.id, agent.mode), 200)}
                  </div>
                </div>
                {agent.mode ? <span className="badge">{modeLabel(agent.mode)}</span> : null}
                {agent.id === store.settings?.defaultAgent ? (
                  <span className="badge accent">{t("common.default")}</span>
                ) : (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void store.updateSettings({ defaultAgent: agent.id })}
                  >
                    {t("prov.pick")}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      ) : null}

      {tab === "commands" ? (
        <div className="card">
          {commands.length === 0 ? (
            <div className="card-body" style={{ color: "var(--text-faint)" }}>{t("cap.noCommands")}</div>
          ) : (
            commands.map((command) => (
              <div className="row" key={command.name}>
                <div className="grow">
                  <div className="name mono">/{command.name}</div>
                  <div className="desc">{truncate(command.description ?? "", 160)}</div>
                </div>
                {command.agent ? <span className="badge">{command.agent}</span> : null}
                {command.subtask ? <span className="badge">{t("cap.subtask")}</span> : null}
              </div>
            ))
          )}
        </div>
      ) : null}

      {tab === "skills" ? (
        <div className="card">
          {skills.length === 0 ? (
            <div className="card-body" style={{ color: "var(--text-faint)" }}>{t("cap.noSkills")}</div>
          ) : (
            skills.map((skill) => (
              <div className="row" key={skill.id}>
                <div className="grow">
                  <div className="name">{skill.name ?? skill.id}</div>
                  <div className="desc">{truncate(skill.description ?? "", 160)}</div>
                </div>
                {skill.scope ? <span className="badge">{skill.scope}</span> : null}
              </div>
            ))
          )}
        </div>
      ) : null}

      {tab === "mcp" ? (
        <div className="card">
          {mcp.length === 0 ? (
            <div className="card-body" style={{ color: "var(--text-faint)" }}>
              {t("cap.noMcpDetail")}
            </div>
          ) : (
            mcp.map((server, index) => (
              <div className="row" key={server.id ?? server.name ?? index}>
                <div className="grow">
                  <div className="name">{server.name ?? server.id}</div>
                  {server.error ? (
                    <div className="desc" style={{ color: "var(--danger)" }}>
                      {server.error}
                    </div>
                  ) : null}
                </div>
                {server.transport?.type ? (
                  <span className="badge">{server.transport.type}</span>
                ) : null}
                <span className={cx("badge", server.status === "connected" ? "ok" : "err")}>
                  {server.status ?? "—"}
                </span>
                {server.tools ? (
                  <span className="badge">{t("cap.toolsCount", { n: Object.keys(server.tools).length })}</span>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
