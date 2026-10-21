import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { McpServerInfo, WebSearchProvider } from "@shared/types"
import { useStore } from "../lib/store"
import { cx, truncate } from "../lib/format"
import { describeAgent, modeLabel } from "../lib/agentDescriptions"
import { IconClose, IconLink, IconRefresh, IconSearch, IconTrash } from "../components/Icon"
import { ViewBack } from "../components/ViewBack"
import { translateLoose, useT, type DictKey } from "../i18n"

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
  const mcpKeys = useMemo(() => mcpKeysOf(mcp), [mcp])
  /** The resources the MCP servers publish: files the agent can read. */
  const [mcpResources, setMcpResources] = useState({ resources: [] as string[], templates: [] as string[] })

  useEffect(() => {
    let cancelled = false
    void window.ocd.api
      .mcpResources()
      .then((found) => {
        if (!cancelled) setMcpResources(found)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  /** The MCP server an action is running against; its row waits while it does. */
  const [mcpBusy, setMcpBusy] = useState<string | null>(null)
  /**
   * The web search providers the server knows.
   *
   * Null until the answer arrives: the screen says that nothing is set up
   * rather than name a provider it has not read yet.
   */
  const [websearch, setWebsearch] = useState<WebSearchProvider[] | null>(null)
  /** The directory the providers were read for, so they are read once. */
  const websearchFor = useRef<string | null>(null)
  /** The store is a new object on every tick, so the effect reads the two
   * things it needs — the folder and the toast — on their own. */
  const { directory, toast } = store

  useEffect(() => {
    if (tab !== "mcp") return
    const folder = directory || ""
    if (websearchFor.current === folder) return
    websearchFor.current = folder
    let cancelled = false
    void (async () => {
      try {
        const found = await window.ocd.api.websearchProviders(folder || undefined)
        if (!cancelled) setWebsearch(found)
      } catch (err) {
        if (!cancelled) toast(err instanceof Error ? err.message : String(err), "error")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tab, directory, toast])

  /**
   * Connect, disconnect or remove one MCP server.
   *
   * The server holds the connection, so the app asks it and reads the list
   * again afterwards: the state on screen is the server's own, never a guess
   * made here.
   */
  const mcpAction = async (
    server: McpServerInfo,
    action: "connect" | "disconnect" | "remove",
  ) => {
    const id = server.name ?? server.id
    if (!id) return
    // Removing a server takes it out of the list for good, so it asks first.
    if (action === "remove" && !window.confirm(t("cap.mcpRemoveConfirm"))) return
    setMcpBusy(id)
    try {
      const folder = directory || undefined
      if (action === "connect") await window.ocd.api.mcpConnect(id, folder)
      else if (action === "disconnect") await window.ocd.api.mcpDisconnect(id, folder)
      else await window.ocd.api.mcpRemove(id, folder)
      await store.refreshCatalog()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error")
    } finally {
      setMcpBusy(null)
    }
  }

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
            agents.map((agent) => {
              const details = store.agentDetails[agent.id]
              const rules = (details?.permissions ?? []).filter(
                (rule) => rule.effect !== "allow" || rule.resource !== "*",
              )
              return (
                <div className="row" key={agent.id}>
                  <div className="grow">
                    <div className="name">{agent.name || agent.id}</div>
                    <div className="desc">
                      {truncate(details?.description ?? describeAgent(agent.id, agent.mode), 200)}
                    </div>
                    {rules.length ? (
                      <div className="agent-rules">
                        {rules.slice(0, 6).map((rule) => (
                          <span
                            key={`${rule.action}:${rule.resource}`}
                            className={cx("agent-rule", rule.effect)}
                            title={`${rule.action} ${rule.resource}`}
                          >
                            {rule.action} {rule.resource} ·{" "}
                            {translateLoose(`perm.effect.${rule.effect}`, rule.effect)}
                          </span>
                        ))}
                        {rules.length > 6 ? (
                          <span className="agent-rule more">+{rules.length - 6}</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {details?.steps ? (
                    <span className="badge">{t("cap.agentSteps", { n: details.steps })}</span>
                  ) : null}
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
              )
            })
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
        <>
          <div className="card">
            {mcp.length === 0 ? (
              <div className="card-body" style={{ color: "var(--text-faint)" }}>
                {t("cap.noMcpDetail")}
              </div>
            ) : (
              mcp.map((server, index) => {
                const id = server.name ?? server.id ?? ""
                const busy = mcpBusy === id
                const connected = isConnected(server)
                const error = mcpError(server)
                return (
                  <div className="row" key={mcpKeys[index]}>
                    <div className="grow">
                      <div className="name">{server.name ?? server.id}</div>
                      {error ? (
                        <div className="desc" style={{ color: "var(--danger)" }}>
                          {error}
                        </div>
                      ) : null}
                    </div>
                    {server.transport?.type ? (
                      <span className="badge">{server.transport.type}</span>
                    ) : null}
                    {/* The server's own word stays in the tooltip: the badge
                        says what the user has to act on, the tooltip says why. */}
                    <span
                      className={cx("badge", connected ? "ok" : "err")}
                      title={mcpStatus(server) || undefined}
                    >
                      {connected ? t("cap.mcpConnected") : t("cap.mcpDisconnected")}
                    </span>
                    {server.tools ? (
                      <span className="badge">
                        {t("cap.toolsCount", { n: Object.keys(server.tools).length })}
                      </span>
                    ) : null}
                    <div className="row-actions">
                      {busy ? <span className="desc">{t("cap.mcpBusy")}</span> : null}
                      {connected ? (
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => void mcpAction(server, "disconnect")}
                        >
                          <IconClose size={14} /> {t("cap.mcpDisconnect")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn primary"
                          disabled={busy}
                          onClick={() => void mcpAction(server, "connect")}
                        >
                          <IconLink size={14} /> {t("cap.mcpConnect")}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn danger"
                        disabled={busy}
                        onClick={() => void mcpAction(server, "remove")}
                      >
                        <IconTrash size={14} /> {t("cap.mcpRemove")}
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <div className="card">
            <div className="card-head">{t("cap.websearch")}</div>
            <div className="card-body">
              {websearch && websearch.length > 0 ? (
                websearch.map((provider) => (
                  <div className="row" key={provider.id}>
                    <div className="grow">
                      <div className="name">{t("cap.websearchProvider")}</div>
                      <div className="desc">{provider.name}</div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="row">
                  <div className="grow">
                    <div className="name">{t("cap.websearchProvider")}</div>
                    <div className="desc">{t("cap.websearchNone")}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}

      {mcpResources.resources.length || mcpResources.templates.length ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="card-head">{t("cap.mcpResources")}</div>
          <div className="card-body">
            {mcpResources.resources.map((item) => (
              <div className="row" key={item}>
                <div className="grow">
                  <div className="name mono" style={{ fontSize: 12 }}>
                    {item}
                  </div>
                </div>
              </div>
            ))}
            {mcpResources.templates.map((item) => (
              <div className="row" key={item}>
                <div className="grow">
                  <div className="name mono" style={{ fontSize: 12 }}>
                    {item}
                  </div>
                  <div className="desc">{t("cap.mcpTemplate")}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * One MCP server, in the shapes the server may answer in.
 *
 * The state comes either as a plain word or as an object, and a server may
 * put it under `state` rather than under `status`. The screen reads all of
 * them instead of guessing which one this particular server picked.
 */
interface McpServerLike {
  id?: string
  name?: string
  status?: string | { status?: string; error?: string }
  error?: string
  state?: { status?: string; error?: string }
}

/** The word the server uses for the state of one MCP server. */
function mcpStatus(server: McpServerLike): string {
  const status = server.status
  const word = typeof status === "string" ? status : (status?.status ?? server.state?.status ?? "")
  return word.trim().toLowerCase()
}

/**
 * Whether the server is talking to this MCP server right now.
 *
 * The word is read whole: "disconnected" ends in "connected", and a fragment
 * check would call a stopped server a running one.
 */
function isConnected(server: McpServerLike): boolean {
  return mcpStatus(server)
    .split(/[^a-z]+/)
    .filter(Boolean)
    .some((word) => word === "connected" || word === "active")
}

/** What went wrong with one MCP server, in whichever place the server said it. */
function mcpError(server: McpServerLike): string {
  const status = server.status
  const nested = typeof status === "string" ? undefined : status
  return server.error ?? nested?.error ?? server.state?.error ?? ""
}

/**
 * A key for every MCP server.
 *
 * A server names itself; when it does not, the tools it publishes are what
 * tell one from another. The place in the list is not part of the key, so a
 * server that moves keeps its row — and whatever state it had — with it.
 */
function mcpKeysOf(servers: McpServerInfo[]): string[] {
  const seen = new Map<string, number>()
  return servers.map((server) => {
    const base =
      server.id ??
      server.name ??
      [
        server.status ?? "",
        server.transport?.type ?? "",
        Object.keys(server.tools ?? {})
          .sort()
          .join(","),
      ].join(":")
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    return `${base}:${count}`
  })
}
