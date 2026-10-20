import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useStore } from "../lib/store"
import { cx } from "../lib/format"
import {
  buildCatalog,
  filterCatalog,
  isConnected,
  probeTargets,
  staleConnections,
  type CatalogEntry,
} from "../lib/providerCatalog"
import {
  IconAlert,
  IconCheck,
  IconChip,
  IconKey,
  IconLink,
  IconRefresh,
  IconSearch,
  IconTrash,
} from "../components/Icon"
import type {
  ConfigProviderSummary,
  IntegrationAttempt,
  IntegrationMethod,
  LocalRuntimeStatus,
  MethodField,
  StoredCredential,
} from "@shared/types"
import { ViewBack } from "../components/ViewBack"
import { LocalModels } from "../components/LocalModels"
import { useT } from "../i18n"

/** What the install dialog is doing right now. */
type Stage =
  | { kind: "none" }
  | { kind: "key"; entry: CatalogEntry; method: IntegrationMethod }
  | { kind: "local"; entry: CatalogEntry }
  | { kind: "oauth-form"; entry: CatalogEntry; method: IntegrationMethod }
  | { kind: "oauth"; entry: CatalogEntry; attempt: IntegrationAttempt }

/** Answers for a method's declared fields. */
type FormValues = Record<string, string>

export function ProvidersView({ onBack }: { onBack: () => void }) {
  const store = useStore()
  const t = useT()

  const [query, setQuery] = useState("")
  const [onlyReady, setOnlyReady] = useState(false)

  // ---- catalog from the server ----
  const [integrations, setIntegrations] = useState<Awaited<
    ReturnType<typeof window.ocd.integration.list>
  > | null>(null)
  const [statuses, setStatuses] = useState<Record<string, LocalRuntimeStatus>>({})
  const [catalogQuery, setCatalogQuery] = useState("")
  const [kindFilter, setKindFilter] = useState<"all" | "cloud" | "local">("all")
  const [hideConnected, setHideConnected] = useState(false)
  const [customId, setCustomId] = useState("")
  const [installed, setInstalled] = useState<ConfigProviderSummary[]>([])
  /** The keys the server keeps for the providers. */
  const [credentials, setCredentials] = useState<StoredCredential[]>([])
  const [busy, setBusy] = useState(false)

  const [stage, setStage] = useState<Stage>({ kind: "none" })
  const [apiKey, setApiKey] = useState("")
  const [baseURL, setBaseURL] = useState("")
  const [formValues, setFormValues] = useState<FormValues>({})
  const [oauthCode, setOauthCode] = useState("")
  const [formError, setFormError] = useState<string | null>(null)

  const reloadInstalled = useCallback(async () => {
    const list = await window.ocd.configFile.providers().catch(() => [] as ConfigProviderSummary[])
    setInstalled(list)
  }, [])

  const reloadCatalog = useCallback(async () => {
    try {
      setIntegrations(await window.ocd.integration.list())
    } catch (err) {
      store.toast(err instanceof Error ? err.message : String(err), "error")
    }
  }, [store])

  /** The keys the server keeps: what is stored and which one is in use. */
  const reloadCredentials = useCallback(async () => {
    try {
      setCredentials(await window.ocd.api.credentials())
    } catch {
      setCredentials([])
    }
  }, [])

  /**
   * Ask every known local runtime whether it is up.
   *
   * Probing goes through main: a fetch from the page to 127.0.0.1 is
   * cross-origin, and four dead ports would each cost a full browser timeout.
   */
  const reloadStatuses = useCallback(
    async (entries: CatalogEntry[]) => {
      const targets = probeTargets(entries)
      if (!targets.length) return
      const results = await Promise.all(
        targets.map(async (target) => {
          const status = await window.ocd.integration.probe(target.baseURL).catch(() => ({
            online: false,
            error: "нет ответа",
          }))
          return [target.id, status] as const
        }),
      )
      setStatuses((current) => ({ ...current, ...Object.fromEntries(results) }))
    },
    [],
  )

  useEffect(() => {
    void reloadInstalled()
    void reloadCatalog()
    void reloadCredentials()
  }, [reloadInstalled, reloadCatalog, reloadCredentials])

  const catalog = useMemo(
    () => buildCatalog(integrations ?? [], statuses),
    [integrations, statuses],
  )

  const shown = useMemo(
    () =>
      filterCatalog(catalog, { query: catalogQuery, kind: kindFilter, hideConnected }),
    [catalog, catalogQuery, kindFilter, hideConnected],
  )

  const counts = useMemo(
    () => ({
      cloud: catalog.filter((entry) => entry.kind === "cloud").length,
      local: catalog.filter((entry) => entry.kind === "local").length,
      online: catalog.filter((entry) => entry.status?.online).length,
    }),
    [catalog],
  )

  // Probing waits for the catalog: there is nothing to probe until the server
  // has said which runtimes exist.
  const probed = useRef(false)
  useEffect(() => {
    if (!integrations || probed.current) return
    probed.current = true
    void reloadStatuses(catalog)
  }, [integrations, catalog, reloadStatuses])

  const close = useCallback(() => {
    setStage({ kind: "none" })
    setApiKey("")
    setFormValues({})
    setOauthCode("")
    setFormError(null)
  }, [])

  const openKey = (entry: CatalogEntry, method: IntegrationMethod) => {
    setFormError(null)
    setApiKey("")
    setFormValues(defaultsOf(method.form))
    setStage({ kind: "key", entry, method })
  }

  const openLocal = (entry: CatalogEntry) => {
    setFormError(null)
    setBaseURL(entry.runtime?.baseURL ?? "")
    setStage({ kind: "local", entry })
  }

  const openOAuthForm = (entry: CatalogEntry, method: IntegrationMethod) => {
    setFormError(null)
    setFormValues(defaultsOf(method.form))
    setStage({ kind: "oauth-form", entry, method })
  }

  const startOAuth = async (entry: CatalogEntry, method: IntegrationMethod) => {
    setBusy(true)
    setFormError(null)
    try {
      const answer = collectAnswer(method.form, formValues)
      const attempt = await window.ocd.integration.oauthBegin(
        entry.id,
        method.id ?? "oauth",
        answer,
        method.label,
      )
      setStage({ kind: "oauth", entry, attempt })
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Store a key credential on the server.
   *
   * The server keeps it, not the config file, which is what makes OAuth and
   * account logins possible at all; the config file only records that the
   * provider should be used.
   */
  const connectKey = async () => {
    if (stage.kind !== "key") return
    const key = apiKey.trim()
    if (!key) {
      setFormError(t("prov.errKeyRequired"))
      return
    }
    setBusy(true)
    setFormError(null)
    try {
      await window.ocd.integration.connectKey(
        stage.entry.id,
        key,
        collectAnswer(stage.method.form, formValues),
        stage.method.label,
      )
      await afterConnect()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Point a local runtime at its endpoint.
   *
   * Written to the config file rather than the server: a local engine needs an
   * address, not a credential, and it is the one thing a user may well want to
   * edit by hand later.
   */
  const connectLocal = async () => {
    if (stage.kind !== "local") return
    const url = baseURL.trim()
    if (!url) {
      setFormError(t("prov.errUrlRequired"))
      return
    }
    setBusy(true)
    setFormError(null)
    try {
      await window.ocd.configFile.setProvider(stage.entry.id, { baseURL: url })
      await afterConnect()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const afterConnect = async () => {
    await reloadInstalled()
    await reloadCatalog()
    // Models come from the server, so this is what makes a newly connected
    // provider actually show up.
    await store.refreshCatalog()
    close()
  }

  const remove = async (id: string) => {
    setBusy(true)
    try {
      await window.ocd.configFile.removeProvider(id)
      await reloadInstalled()
      await store.refreshCatalog()
      store.toast(t("prov.removed", { id }))
    } catch (err) {
      store.toast(err instanceof Error ? err.message : String(err), "error")
    } finally {
      setBusy(false)
    }
  }

  const installCustom = async () => {
    const id = customId.trim()
    if (!id) return
    setBusy(true)
    try {
      await window.ocd.configFile.setProvider(id, {})
      await reloadInstalled()
      await store.refreshCatalog()
      store.toast(t("prov.added", { id }))
      setCustomId("")
    } catch (err) {
      store.toast(err instanceof Error ? err.message : String(err), "error")
    } finally {
      setBusy(false)
    }
  }

  const defaultKey = `${store.settings?.defaultProvider}/${store.settings?.defaultModel}`

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return store.models
      .filter((model) => {
        if (!needle) return true
        const hay = `${model.providerID ?? ""}/${model.id} ${model.name ?? ""}`.toLowerCase()
        return hay.includes(needle)
      })
      .map((model) => ({
        key: `${model.providerID ?? ""}/${model.id}`,
        id: model.id,
        name: model.name || model.id,
        providerID: model.providerID ?? "",
        providerName:
          store.providers.find((provider) => provider.id === model.providerID)?.name ??
          model.providerID ??
          "",
        authenticated: store.providers.find((provider) => provider.id === model.providerID)
          ?.authenticated,
        reasoning: model.reasoning,
        context: model.limit?.context,
      }))
  }, [store.models, store.providers, query])

  const filtered = onlyReady
    ? rows.filter((row) => row.authenticated !== false)
    : rows

  const choose = async (providerID: string, modelID: string) => {
    await store.updateSettings({ defaultProvider: providerID, defaultModel: modelID })
    store.toast(t("toast.modelDefault", { provider: providerID, model: modelID }))
  }

  return (
    <div className="view">
      <div className="view-head">
        <ViewBack onClick={onBack} />
        <h1>{t("prov.title")}</h1>
        <span className="sub">
          {t("prov.counts", {
            providers: store.providers.length,
            models: store.models.length,
          })}
        </span>
        <div className="spacer" />
        <button
          type="button"
          className="iconbtn"
          title={t("common.refresh")}
          onClick={() => {
            void reloadCatalog()
            void reloadStatuses(catalog)
          }}
        >
          <IconRefresh size={15} />
        </button>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-head">
          <IconChip size={16} />
          {t("prov.currentModel")}
          <div className="spacer" />
          <span className="badge accent mono">
            {store.settings?.defaultProvider}/{store.settings?.defaultModel}
          </span>
        </div>
        <div className="card-body" style={{ color: "var(--text-dim)" }}>
          {t("prov.currentHint")}
        </div>
      </div>

      {credentials.length ? (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-head">
            <IconKey size={16} />
            {t("prov.credentials")}
            <div className="spacer" />
            <span className="badge">{credentials.length}</span>
          </div>
          <div className="card-body">
            <ul className="rule-list">
              {credentials.map((credential) => (
                <li key={credential.id}>
                  <div className="rule-main">
                    <span className="rule-action">
                      {credential.label || credential.integrationID}
                      {credential.active ? (
                        <span className="badge accent" style={{ marginLeft: 8 }}>
                          {t("prov.credentialActive")}
                        </span>
                      ) : null}
                    </span>
                    <span className="mono rule-resource">
                      {credential.integrationID} ·{" "}
                      {t("prov.credentialTail", { tail: credential.tail })}
                    </span>
                  </div>
                  {credential.active ? null : (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        void window.ocd.api
                          .activateCredential(credential.id)
                          .then(() => reloadCredentials())
                          .catch((err) =>
                            store.toast(err instanceof Error ? err.message : String(err), "error"),
                          )
                      }}
                    >
                      {t("prov.credentialActivate")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      void window.ocd.api
                        .deleteCredential(credential.id)
                        .then(() => reloadCredentials())
                        .catch((err) =>
                          store.toast(err instanceof Error ? err.message : String(err), "error"),
                        )
                    }}
                  >
                    {t("prov.credentialForget")}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="card-head">
          <div className="search" style={{ flex: 1, maxWidth: 360 }}>
            <IconSearch size={14} className="mag" />
            <input
              placeholder={t("prov.filterModels")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="spacer" />
          <button
            type="button"
            className={cx("btn", onlyReady && "primary")}
            onClick={() => setOnlyReady((value) => !value)}
          >
            {t("prov.onlyReady")}
          </button>
        </div>

        {filtered.length === 0 ? (
          <div className="card-body" style={{ color: "var(--text-faint)" }}>
            {store.status?.connected ? t("prov.noModels") : t("prov.needServer")}
          </div>
        ) : (
          filtered.map((row) => (
            <div className="row" key={row.key}>
              <div className="grow">
                <div className="name">{row.name}</div>
                <div className="desc mono">
                  {row.providerID}/{row.id}
                </div>
              </div>
              {row.reasoning ? <span className="badge">{t("prov.badgeReasoning")}</span> : null}
              {row.context ? <span className="badge">{Math.round(row.context / 1000)}k</span> : null}
              {row.authenticated === false ? (
                <span className="badge err">{t("prov.badgeNoKey")}</span>
              ) : row.authenticated ? (
                <span className="badge ok">{t("prov.badgeAuthorized")}</span>
              ) : null}
              {row.key === defaultKey ? (
                <span className="badge accent">
                  <IconCheck size={12} /> {t("common.default")}
                </span>
              ) : (
                <button
                  type="button"
                  className="btn"
                  onClick={() => void choose(row.providerID, row.id)}
                >
                  {t("prov.pick")}
                </button>
              )}
            </div>
          ))
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <IconChip size={16} />
          {t("prov.installTitle")}
          <span className="sub">
            {t("prov.catalogCounts", {
              total: catalog.length,
              online: counts.online,
              local: counts.local,
            })}
          </span>
          <div className="spacer" />
          <div className="seg">
            {(["all", "cloud", "local"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                className={cx(kindFilter === kind && "on")}
                onClick={() => setKindFilter(kind)}
              >
                {t(`prov.filter.${kind}`)}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={cx("btn", hideConnected && "primary")}
            onClick={() => setHideConnected((value) => !value)}
          >
            {t("prov.hideConnected")}
          </button>
          <div className="search" style={{ maxWidth: 240 }}>
            <IconSearch size={14} className="mag" />
            <input
              placeholder={t("prov.installSearch")}
              value={catalogQuery}
              onChange={(event) => setCatalogQuery(event.target.value)}
            />
          </div>
        </div>

        <OAuthAttempt
          stage={stage}
          code={oauthCode}
          busy={busy}
          onCode={setOauthCode}
          onOpenUrl={(url) => void window.ocd.app.openExternal(url)}
          onCancel={() => {
            if (stage.kind === "oauth") {
              void window.ocd.integration.oauthCancel(stage.entry.id, stage.attempt.attemptID)
            }
            close()
          }}
          onFinish={async (code) => {
            if (stage.kind !== "oauth") return
            setBusy(true)
            try {
              await window.ocd.integration.oauthComplete(stage.entry.id, stage.attempt.attemptID, code)
              store.toast(t("prov.connected", { name: stage.entry.name }))
              await afterConnect()
            } catch (err) {
              setFormError(err instanceof Error ? err.message : String(err))
            } finally {
              setBusy(false)
            }
          }}
        />

        {stage.kind !== "none" && stage.kind !== "oauth" ? (
          <div className="card-body install-form">
            <div className="install-title">
              {t("prov.installingPrefix")} <strong>{stage.entry.name}</strong>{" "}
              <span className="desc mono">{stage.entry.id}</span>
            </div>

            {stage.kind === "local" ? (
              <>
                <label className="install-field">
                  <span>{t("prov.fieldBaseUrl")}</span>
                  <input
                    className="input"
                    placeholder="http://127.0.0.1:11434/v1"
                    value={baseURL}
                    onChange={(event) => setBaseURL(event.target.value)}
                  />
                </label>
                <div className="warn-note">
                  {t("prov.localHint")}
                </div>
              </>
            ) : (
              <>
                <label className="install-field">
                  <span>{stage.method.label ?? t("prov.fieldKey")}</span>
                  <input
                    className="input"
                    type="password"
                    autoComplete="off"
                    placeholder="sk-…"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                </label>
                <MethodFields
                  fields={stage.method.form}
                  values={formValues}
                  onChange={setFormValues}
                />
                <div className="warn-note">
                  {t("prov.keyWarningStored")}{" "}
                  <span className="mono">{t("prov.credentialStore")}</span>
                </div>
              </>
            )}

            {formError ? <div className="err-note">{formError}</div> : null}

            <div className="row" style={{ borderTop: 0, paddingTop: 4 }}>
              <div className="spacer" />
              <button type="button" className="btn" onClick={close}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() => {
                  if (stage.kind === "local") void connectLocal()
                  else if (stage.kind === "key") void connectKey()
                  else if (stage.kind === "oauth-form") void startOAuth(stage.entry, stage.method)
                }}
              >
                {busy ? t("prov.saving") : t("prov.connect")}
              </button>
            </div>
          </div>
        ) : null}

        {integrations === null ? (
          <div className="card-body" style={{ color: "var(--text-faint)" }}>
            {t("prov.catalogLoading")}
          </div>
        ) : shown.length === 0 ? (
          <div className="card-body" style={{ color: "var(--text-faint)" }}>
            {t("prov.catalogEmpty")}
          </div>
        ) : (
          shown.map((entry) => (
            <CatalogRow
              key={entry.id}
              entry={entry}
              installed={installed.find((item) => item.id === entry.id)}
              serverActive={store.providers.some((provider) => provider.id === entry.id)}
              busy={busy}
              onKey={(method) => openKey(entry, method)}
              onOauth={(method) => openOAuthForm(entry, method)}
              onLocal={() => openLocal(entry)}
              onRemove={() => void remove(entry.id)}
            />
          ))
        )}

        <div className="card-body" style={{ borderTop: "1px solid var(--line)" }}>
          <div className="desc" style={{ marginBottom: 8 }}>
            {t("prov.customTitle")}
          </div>
          <div className="row" style={{ borderTop: 0, paddingTop: 0 }}>
            <input
              className="input"
              placeholder={t("prov.customPlaceholder")}
              value={customId}
              onChange={(event) => setCustomId(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void installCustom()
              }}
            />
            <button
              type="button"
              className="btn primary"
              disabled={busy || !customId.trim()}
              onClick={() => void installCustom()}
            >
              {t("prov.customAdd")}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** One catalog line: name, kind, how it can be connected, what is already there. */
function CatalogRow({
  entry,
  installed,
  serverActive,
  busy,
  onKey,
  onOauth,
  onLocal,
  onRemove,
}: {
  entry: CatalogEntry
  installed?: ConfigProviderSummary
  serverActive: boolean
  busy: boolean
  onKey(method: IntegrationMethod): void
  onOauth(method: IntegrationMethod): void
  onLocal(): void
  onRemove(): void
}) {
  const t = useT()
  const status = entry.status
  const stale = staleConnections(entry)
  const keyMethod = entry.methods.find((method) => method.type === "key")
  const oauthMethods = entry.methods.filter((method) => method.type === "oauth")
  const envMethod = entry.methods.find((method) => method.type === "env")

  return (
    <>
      <div className="row">
        <div className="grow">
          <div className="name">{entry.name}</div>
          <div className="desc mono">
            {entry.id}
            {entry.runtime ? ` · ${entry.runtime.baseURL}` : ""}
          </div>
          {entry.kind === "local" && status ? (
            <div className="desc">
              {status.online
                ? t("prov.runtimeOnline", {
                    n: status.models ?? 0,
                    sample: status.sample?.length
                      ? ` — ${status.sample.slice(0, 2).join(", ")}`
                      : "",
                  })
                : t("prov.runtimeOffline", { why: status.error ?? "" })}
            </div>
          ) : null}
        </div>

        <span className={cx("badge", entry.kind === "cloud" ? "" : "ok")}>
          {entry.kind === "cloud" ? t("prov.cloud") : t("prov.local")}
        </span>
        {entry.kind === "local" && status?.online ? (
          <span className="badge ok">{t("prov.online")}</span>
        ) : null}

        {/* Two different things, deliberately not merged: a credential the server
            holds, and a provider the config declares. A provider can be in the
            config with no credential behind it, and that is exactly the case that
            looks broken until you know which one you are looking at. */}
        {isConnected(entry) ? (
          <span className="badge ok" title={t("prov.connectedHint", { n: entry.connections.length })}>
            {t("prov.connectedBadge")}
          </span>
        ) : null}
        {stale.length ? (
          <span
            className="badge err"
            title={
              typeof stale[0].message === "string" && stale[0].message
                ? stale[0].message
                : t("prov.needsAuthHint")
            }
          >
            <IconAlert size={12} /> {t("prov.needsAuth")}
          </span>
        ) : null}
        {installed ? (
          <span className="badge" title={t("prov.installedHint")}>
            {t("prov.installed")}
          </span>
        ) : null}
        {serverActive && !isConnected(entry) ? (
          <span className="badge accent" title={t("prov.activeHint")}>
            {t("prov.active")}
          </span>
        ) : null}

        <div className="row-actions">
          {entry.kind === "local" ? (
            <button type="button" className="btn" disabled={busy} onClick={onLocal}>
              {installed ? t("prov.configure") : t("prov.connect")}
            </button>
          ) : (
            <>
              {keyMethod ? (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => onKey(keyMethod)}
                >
                  {keyMethod.label ?? t("prov.byKey")}
                </button>
              ) : null}
              {oauthMethods.map((method) => (
                <button
                  key={method.id ?? method.label}
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => onOauth(method)}
                >
                  <IconLink size={13} />
                  {method.label ?? t("prov.byOAuth")}
                </button>
              ))}
              {!keyMethod && !oauthMethods.length && envMethod ? (
                <span className="badge" title={t("prov.envHint")}>
                  {envMethod.names?.slice(0, 1).join(", ")}
                </span>
              ) : null}
            </>
          )}
          {installed ? (
            <button
              type="button"
              className="iconbtn"
              title={t("prov.removeTitle")}
              disabled={busy}
              onClick={onRemove}
            >
              <IconTrash size={14} />
            </button>
          ) : null}
        </div>
      </div>

    {/* Models on a local engine, and the field that downloads another. Shown
        whether or not the engine is up: when it is not, the panel is what says
        so, which is more useful than the row simply lacking a list.

        Below the row and not inside it. The row is a strip of badges and buttons
        laid out across the width; a panel with a search field and a list of
        model files is not one of those, and squeezed in there it took the space
        the provider's own name needed. */}
    {entry.kind === "local" && entry.id === "ollama" ? (
      <LocalModels online={Boolean(status?.online)} />
    ) : null}
    </>
  )
}

/**
 * The fields a connection method declares.
 *
 * Rendered from the method's own schema, including the `when` conditions, so a
 * method that only needs a URL for enterprise accounts asks for it only in that
 * case — exactly as the server will validate it.
 */
function MethodFields({
  fields,
  values,
  onChange,
}: {
  fields?: MethodField[]
  values: FormValues
  onChange(next: FormValues): void
}) {
  if (!fields?.length) return null
  const visible = fields.filter((field) => !field.hidden && isFieldShown(field, values))

  return (
    <>
      {visible.map((field) => (
        <label className="install-field" key={field.key}>
          <span>{field.title ?? field.key}</span>
          {field.options?.length ? (
            <select
              className="input"
              value={values[field.key] ?? field.default ?? ""}
              onChange={(event) => onChange({ ...values, [field.key]: event.target.value })}
            >
              {field.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="input"
              type={field.type === "string" && field.format === "uri" ? "url" : "text"}
              placeholder={field.placeholder}
              value={values[field.key] ?? field.default ?? ""}
              onChange={(event) => onChange({ ...values, [field.key]: event.target.value })}
            />
          )}
          {field.description ? <span className="desc">{field.description}</span> : null}
        </label>
      ))}
    </>
  )
}

/**
 * The browser half of an OAuth login.
 *
 * `auto` finishes on its own once the user has signed in, so the status is
 * polled; `code` needs the code pasted back, which is what happens when the
 * provider refuses to open a callback.
 */
function OAuthAttempt({
  stage,
  code,
  busy,
  onCode,
  onOpenUrl,
  onCancel,
  onFinish,
}: {
  stage: Stage
  code: string
  busy: boolean
  onCode(next: string): void
  onOpenUrl(url: string): void
  onCancel(): void
  onFinish(code?: string): void
}) {
  const t = useT()
  const [status, setStatus] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)

  const integrationId = stage.kind === "oauth" ? stage.entry.id : null
  const attemptId = stage.kind === "oauth" ? stage.attempt.attemptID : null

  useEffect(() => {
    if (!integrationId || !attemptId) return
    if (stage.kind !== "oauth" || stage.attempt.mode !== "auto") return
    let cancelled = false
    const timer = setInterval(async () => {
      try {
        const next = await window.ocd.integration.oauthStatus(integrationId, attemptId)
        if (cancelled) return
        setStatus(next.status)
        // A settled attempt stops the poll; the parent then refreshes.
        if (next.status !== "pending") clearInterval(timer)
      } catch {
        /* the server may be restarting; the next tick tries again */
      }
    }, 2500)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [integrationId, attemptId, stage])

  if (stage.kind !== "oauth") return null

  const expired = status === "expired" || status === "failed"

  return (
    <div className="card-body install-form">
      <div className="install-title">
        {t("prov.oauthTitle")} <strong>{stage.entry.name}</strong>
      </div>
      <div className="warn-note">{stage.attempt.instructions}</div>

      <div className="row" style={{ borderTop: 0 }}>
        <button
          type="button"
          className="btn primary"
          disabled={opening}
          onClick={() => {
            setOpening(true)
            onOpenUrl(stage.attempt.url)
          }}
        >
          <IconLink size={14} />
          {t("prov.oauthOpen")}
        </button>
        <span className="desc mono grow" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {stage.attempt.url}
        </span>
      </div>

      {stage.attempt.mode === "code" ? (
        <label className="install-field">
          <span>{t("prov.oauthCode")}</span>
          <input
            className="input"
            value={code}
            placeholder="ABCD-1234"
            onChange={(event) => onCode(event.target.value)}
          />
        </label>
      ) : (
        <div className="desc">
          {expired
            ? t("prov.oauthStatus", { status })
            : t("prov.oauthWaiting", { status: status ?? "pending" })}
        </div>
      )}

      {expired ? <div className="err-note">{t("prov.oauthExpired")}</div> : null}

      <div className="row" style={{ borderTop: 0, paddingTop: 4 }}>
        <div className="spacer" />
        <button type="button" className="btn" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        {stage.attempt.mode === "code" ? (
          <button
            type="button"
            className="btn primary"
            disabled={busy || !code.trim() || expired}
            onClick={() => onFinish(code.trim())}
          >
            {t("prov.oauthFinish")}
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** Defaults declared on a method's fields, so a hidden default is still sent. */
function defaultsOf(fields?: MethodField[]): FormValues {
  const values: FormValues = {}
  for (const field of fields ?? []) {
    if (field.default !== undefined) values[field.key] = field.default
  }
  return values
}

/** Only the fields the server would validate for the current answers. */
function collectAnswer(fields: MethodField[] | undefined, values: FormValues): Record<string, string> | undefined {
  if (!fields?.length) return undefined
  const answer: Record<string, string> = {}
  for (const field of fields) {
    const value = values[field.key] ?? field.default ?? ""
    if (value) answer[field.key] = value
  }
  return Object.keys(answer).length ? answer : undefined
}

/** A field shows when every `when` condition holds. */
function isFieldShown(field: MethodField, values: FormValues): boolean {
  if (!field.when?.length) return true
  return field.when.every((condition) => {
    const current = values[condition.key] ?? ""
    return condition.op === "eq" ? current === condition.value : current !== condition.value
  })
}
