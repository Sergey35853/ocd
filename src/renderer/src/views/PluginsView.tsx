import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ManagedPlugin, NpmPluginHit } from "@shared/types"
import { useStore } from "../lib/store"
import { cx, truncate } from "../lib/format"
import { Modal } from "../components/ui"
import {
  IconDownload,
  IconFolder,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
} from "../components/Icon"
import { ViewBack } from "../components/ViewBack"
import { useT, type DictKey } from "../i18n"

const KIND_LABEL: Record<ManagedPlugin["kind"], DictKey | null> = {
  builtin: "plugins.kindBuiltin",
  local: "plugins.kindLocal",
  npm: null,
  unknown: null,
}

function PluginRow({ plugin, onChanged }: { plugin: ManagedPlugin; onChanged: () => void }) {
  const store = useStore()
  const t = useT()
  const [busy, setBusy] = useState(false)
  const removable = plugin.kind === "npm" || plugin.kind === "local"
  // npm keeps its own name; the built-in and local rows get a translated kind.
  const kindLabel = KIND_LABEL[plugin.kind] ? t(KIND_LABEL[plugin.kind]!) : plugin.kind

  const remove = async () => {
    setBusy(true)
    try {
      const result = await window.ocd.plugins.uninstall(plugin.id)
      if (!result.ok) store.toast(result.error ?? t("toast.removeFailed"), "error")
      else store.toast(t("toast.pluginRemoved", { name: plugin.id }))
      onChanged()
    } catch (err) {
      store.toast(err instanceof Error ? err.message : String(err), "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="row">
      <div className="grow">
        <div className="name">
          {plugin.meta?.description ?? plugin.id}
        </div>
        <div className="desc mono">{plugin.id}</div>
        {plugin.error ? <div className="desc" style={{ color: "var(--danger)" }}>{plugin.error}</div> : null}
      </div>

      {plugin.meta ? (
        <span className="badge">
          {plugin.meta.name}@{plugin.meta.version}
        </span>
      ) : null}
      <span className={cx("badge", plugin.runtime ? "ok" : "")}>{kindLabel}</span>
      {plugin.runtime?.state?.status === "active" ? (
        <span className="badge ok">{t("prov.active")}</span>
      ) : null}

      {plugin.path ? (
        <button
          type="button"
          className="iconbtn"
          title={t("plugins.reveal")}
          onClick={() =>
            void window.ocd.plugins
              .revealLocal(plugin.path!)
              .catch((err: unknown) =>
                store.toast(err instanceof Error ? err.message : String(err), "error"),
              )
          }
        >
          <IconFolder size={15} />
        </button>
      ) : null}

      {removable ? (
        <button type="button" className="btn danger" disabled={busy} onClick={() => void remove()}>
          <IconTrash size={14} />
        </button>
      ) : null}
    </div>
  )
}

export function PluginsView({ onBack }: { onBack: () => void }) {
  const store = useStore()
  const t = useT()
  /**
   * The store, in a ref.
   *
   * The store is a new object on every tick of a running turn, so an effect
   * that depends on it reads the plugin list again, once a second, for as
   * long as the model writes.
   */
  const storeRef = useRef(store)
  storeRef.current = store
  const [plugins, setPlugins] = useState<ManagedPlugin[]>([])
  const [loading, setLoading] = useState(true)
  /** The "update everything" run is in flight. */
  const [updating, setUpdating] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<NpmPluginHit[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [installed, setInstalled] = useState<Record<string, boolean>>({})

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setPlugins(await window.ocd.plugins.list())
    } catch (err) {
      storeRef.current.toast(err instanceof Error ? err.message : String(err), "error")
      setPlugins([])
    } finally {
      setLoading(false)
    }
  }, [])

  // The list is read again when the connection changes: a plugin the server
  // has just announced is only known to the main process afterwards.
  const connected = Boolean(store.status?.connected)
  useEffect(() => {
    void reload()
  }, [reload, connected])

  const grouped = useMemo(() => {
    const managed = plugins.filter((plugin) => plugin.kind !== "builtin")
    const builtin = plugins.filter((plugin) => plugin.kind === "builtin")
    return { managed, builtin }
  }, [plugins])

  const runSearch = async () => {
    setSearching(true)
    setSearchError(null)
    try {
      setHits(await window.ocd.plugins.search(query))
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : String(err))
    } finally {
      setSearching(false)
    }
  }

  useEffect(() => {
    if (!searchOpen) return
    const timer = setTimeout(() => void runSearch(), 350)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searchOpen])

  useEffect(() => {
    if (!searchOpen) return
    const map: Record<string, boolean> = {}
    for (const plugin of plugins) {
      if (plugin.kind !== "builtin") map[plugin.id] = true
    }
    setInstalled(map)
  }, [plugins, searchOpen])

  const install = async (spec: string) => {
    try {
      const result = await window.ocd.plugins.install(spec)
      if (!result.ok) {
        store.toast(result.error ?? t("toast.installFailed"), "error")
        return
      }
      setInstalled((current) => ({ ...current, [spec]: true }))
      store.toast(t("toast.pluginAddedRestart", { name: spec }))
      await reload()
      await store.refreshCatalog()
    } catch (err) {
      store.toast(err instanceof Error ? err.message : String(err), "error")
    }
  }

  const addLocal = async () => {
    try {
      const dir = await window.ocd.app.pickDirectory()
      if (!dir) return
      await install(dir)
    } catch (err) {
      store.toast(err instanceof Error ? err.message : String(err), "error")
    }
  }

  /**
   * Ask the server to bring the installed plugins up to date.
   *
   * The route existed and nothing called it: plugins could be installed from
   * npm, but there was no way to update the ones already there.
   */
  const updateAll = async () => {
    setUpdating(true)
    try {
      await window.ocd.api.updatePlugins()
      store.toast(t("toast.pluginsUpdated"), "info")
      await reload()
      await store.refreshCatalog()
    } catch (err) {
      store.toast(err instanceof Error ? err.message : String(err), "error")
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div className="view">
      <div className="view-head">
        <ViewBack onClick={onBack} />
        <h1>{t("plugins.title")}</h1>
        <span className="sub">
          {t("plugins.counts", {
            connected: grouped.managed.length,
            builtin: grouped.builtin.length,
          })}
        </span>
        <div className="spacer" />
        <button type="button" className="btn" disabled={updating} onClick={() => void updateAll()}>
          <IconRefresh size={14} /> {t("plugins.updateAll")}
        </button>
        <button type="button" className="btn" onClick={addLocal}>
          <IconFolder size={14} /> {t("plugins.localFolder")}
        </button>
        <button type="button" className="btn primary" onClick={() => setSearchOpen(true)}>
          <IconDownload size={14} /> {t("plugins.fromNpm")}
        </button>
        <button type="button" className="iconbtn" title={t("common.refresh")} onClick={() => void reload()}>
          <IconRefresh size={15} />
        </button>
      </div>

      <div className="card">
        <div className="card-head">
          {t("plugins.connected")}
          <div className="spacer" />
          <span className="sub" style={{ color: "var(--text-faint)", fontSize: 12 }}>
            opencode.jsonc → plugins
          </span>
        </div>
        {loading ? (
          <div className="card-body" style={{ color: "var(--text-faint)" }}>
            {t("plugins.loading")}
          </div>
        ) : grouped.managed.length === 0 ? (
          <div className="card-body" style={{ color: "var(--text-faint)" }}>
            {t("plugins.noneHint")}
          </div>
        ) : (
          grouped.managed.map((plugin) => (
            <PluginRow key={plugin.id} plugin={plugin} onChanged={() => void reload()} />
          ))
        )}
      </div>

      <div className="card">
        <div className="card-head">{t("plugins.builtin")}</div>
        {grouped.builtin.length === 0 ? (
          <div className="card-body" style={{ color: "var(--text-faint)" }}>
            {t("plugins.noServerData")}
          </div>
        ) : (
          grouped.builtin.map((plugin) => (
            <div className="row" key={plugin.id}>
              <div className="grow">
                <div className="name mono" style={{ fontSize: 12 }}>
                  {plugin.id}
                </div>
              </div>
              {plugin.runtime?.state?.status === "active" ? (
                <span className="badge ok">{t("prov.active")}</span>
              ) : null}
            </div>
          ))
        )}
      </div>

      {searchOpen ? (
        <Modal title={t("plugins.npmTitle")} onClose={() => setSearchOpen(false)}>
          <div className="search" style={{ marginBottom: 12 }}>
            <IconSearch size={15} className="mag" />
            <input
              autoFocus
              placeholder="opencode-plugin …"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void runSearch()
              }}
            />
          </div>

          {searchError ? <div className="badge err">{searchError}</div> : null}
          {searching ? (
            <div style={{ color: "var(--text-faint)" }}>{t("plugins.searching")}</div>
          ) : hits.length === 0 && !searchError ? (
            <div style={{ color: "var(--text-faint)" }}>{t("plugins.noResults")}</div>
          ) : null}

          {hits.map((hit) => (
            <div className="row" key={hit.name}>
              <div className="grow">
                <div className="name">
                  {hit.name} <span className="badge">{hit.version}</span>
                </div>
                <div className="desc">{truncate(hit.description ?? "", 120)}</div>
              </div>
              {installed[hit.name] ? (
                <span className="badge ok">{t("prov.installed")}</span>
              ) : (
                <button type="button" className="btn" onClick={() => void install(hit.name)}>
                  <IconPlus size={14} /> {t("plugins.install")}
                </button>
              )}
              {hit.links?.npm ? (
                <button
                  type="button"
                  className="iconbtn"
                  title={t("plugins.openOnNpm")}
                  onClick={() => void window.ocd.app.openExternal(hit.links!.npm!)}
                >
                  ↗
                </button>
              ) : null}
            </div>
          ))}
        </Modal>
      ) : null}
    </div>
  )
}
