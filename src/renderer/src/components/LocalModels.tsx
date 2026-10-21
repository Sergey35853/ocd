import { useCallback, useEffect, useState } from "react"
import type { FileGroup, HardwareFacts, RepoHit } from "@shared/types"
import { cx, formatBytes } from "../lib/format"
import { judgeFit, type Fit } from "../lib/fit"
import { IconClose, IconDownload, IconRefresh, IconSearch, IconTrash } from "./Icon"
import { useT } from "../i18n"

/**
 * Models on a local engine, and a search for more.
 *
 * Nothing is fetched without being asked for: the list is read, and a model
 * arrives only when the user typed its name and pressed the button. A search
 * sends the query and returns names — nothing is downloaded because a result
 * appeared.
 */
export function LocalModels({ online }: { online: boolean }) {
  const t = useT()
  const [hardware, setHardware] = useState<HardwareFacts | null>(null)
  const [models, setModels] = useState<Array<{ name: string; size?: number }>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wanted, setWanted] = useState("")
  /**
   * The engines this machine can run models on.
   *
   * The list used to be one name written into the code, so a machine with
   * LM Studio saw no models at all — the engine was there, the screen simply
   * never asked about it.
   */
  const [engines, setEngines] = useState<Array<{ id: string; label: string; baseURL: string }>>([])
  const [engine, setEngine] = useState("ollama")

  // ---- the search ----
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<RepoHit[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  /** Files of whichever repository is expanded, with its fit verdict. */
  const [opened, setOpened] = useState<{ repo: string; files: FileGroup[] } | null>(null)
  const [openingRepo, setOpeningRepo] = useState<string | null>(null)
  const [download, setDownload] = useState<string | null>(null)

  useEffect(() => {
    void window.ocd.local.hardware().then(setHardware).catch(() => setHardware(null))
  }, [])

  // The engines are a fact about the machine, not about the server.
  useEffect(() => {
    void window.ocd.model
      .engines()
      .then((list) => {
        setEngines(list)
        setEngine((current) => (list.some((item) => item.id === current) ? current : (list[0]?.id ?? current)))
      })
      .catch(() => setEngines([]))
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setModels(await window.ocd.model.list(engine))
    } catch (err) {
      setModels([])
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [engine])

  // The list is only worth reading when there is something to answer.
  useEffect(() => {
    if (online) void reload()
    else setModels([])
  }, [online, reload])

  const search = async () => {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setSearchError(null)
    setOpened(null)
    try {
      setHits(await window.ocd.local.searchRepos(q, 20))
    } catch (err) {
      setHits([])
      setSearchError(err instanceof Error ? err.message : String(err))
    } finally {
      setSearching(false)
    }
  }

  const openRepo = async (repo: string) => {
    if (opened?.repo === repo) {
      setOpened(null)
      return
    }
    setOpeningRepo(repo)
    try {
      setOpened({ repo, files: await window.ocd.local.repoFiles(repo) })
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : String(err))
    } finally {
      setOpeningRepo(null)
    }
  }

  const start = async () => {
    const name = wanted.trim()
    if (!name) return
    setWanted("")
    try {
      await window.ocd.model.pull(engine, name)
      setDownload(name)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  /**
   * Download a Hugging Face build.
   *
   * Addressed as `hf.co/owner/repo:QUANT`, which Ollama resolves against the
   * repository on its own — so a model found on the web is fetched by the engine
   * the user already runs, without this app hosting a runtime.
   */
  const downloadGroup = async (repo: string, file: FileGroup) => {
    const quant = file.label.toLowerCase().replace(/[^a-z0-9]+/g, "_")
    const ref = `hf.co/${repo}:${quant}`
    setDownload(ref)
    try {
      await window.ocd.model.pull(engine, ref)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const remove = async (name: string) => {
    try {
      await window.ocd.model.delete(engine, name)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="lmodels-wrap">
      {!online ? (
        <div className="desc" style={{ padding: "4px 0" }}>
          {t("model.engineOffline")}
        </div>
      ) : (
        <div className="lmodels">
          {hardware ? <HardwareLine hw={hardware} /> : null}

          <div className="lmodels-bar">
            {engines.length > 1 ? (
              // Only when there is a choice: one engine is not a question.
              <select
                className="input"
                value={engine}
                title={t("model.engine")}
                onChange={(event) => {
                  setEngine(event.target.value)
                  setModels([])
                }}
              >
                {engines.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            ) : (
              <span className="badge">{engines[0]?.label ?? "Ollama"}</span>
            )}
            <input
              className="input grow"
              placeholder={t("model.pullPlaceholder")}
              value={wanted}
              onChange={(event) => setWanted(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void start()
              }}
            />
            <button
              type="button"
              className="btn primary"
              disabled={!wanted.trim()}
              title={t("model.pullHint")}
              onClick={() => void start()}
            >
              <IconDownload size={14} />
              {t("model.pull")}
            </button>
            <button
              type="button"
              className="iconbtn"
              title={t("common.refresh")}
              disabled={loading}
              onClick={() => void reload()}
            >
              <IconRefresh size={14} />
            </button>
          </div>

          {download ? <DownloadBar name={download} /> : null}
          {error ? <div className="err-note">{error}</div> : null}

          {models.length === 0 ? (
            <div className="desc" style={{ padding: "6px 0" }}>
              {loading ? t("model.loading") : t("model.noneHint")}
            </div>
          ) : (
            <div className="lmodels-list">
              {models.map((model) => (
                <div className={cx("row", "lmodel")} key={model.name}>
                  <div className="grow">
                    <div className="name mono" title={model.name}>
                      {model.name}
                    </div>
                    <div className="desc">{model.size ? formatBytes(model.size) : ""}</div>
                  </div>
                  <button
                    type="button"
                    className="iconbtn"
                    title={t("model.deleteTitle", { model: model.name })}
                    onClick={() => void remove(model.name)}
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* The search is the same shape as Hermes': a query, then the
              repositories it matched, then the builds inside one of them with a
              verdict against this machine for each. */}
          <div className="lfinder">
            <div className="lfinder-head">
              <IconSearch size={14} />
              <span className="grow">{t("model.findMore")}</span>
            </div>
            <div className="lmodels-bar">
              <input
                className="input grow"
                placeholder={t("model.searchPlaceholder")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void search()
                }}
              />
              <button
                type="button"
                className="btn"
                disabled={searching || !query.trim()}
                onClick={() => void search()}
              >
                {searching ? t("model.searching") : t("model.search")}
              </button>
            </div>

            {searchError ? <div className="err-note">{searchError}</div> : null}

            {hits.length === 0 ? (
              query.trim() && !searching ? (
                <div className="desc" style={{ padding: "4px 0" }}>
                  {t("model.searchEmpty")}
                </div>
              ) : null
            ) : (
              <div className="lhits">
                {hits.map((hit) => (
                  <div className="lhit" key={hit.repo}>
                    <div className="lhit-row">
                      <span className="grow mono" title={hit.repo}>
                        {hit.repo}
                      </span>
                      <span className="desc mono">
                        {t("model.searchMeta", { n: hit.downloads, likes: hit.likes })}
                      </span>
                      <button
                        type="button"
                        className="linkbtn"
                        disabled={openingRepo === hit.repo}
                        onClick={() => void openRepo(hit.repo)}
                      >
                        {opened?.repo === hit.repo ? t("model.hideFiles") : t("model.showFiles")}
                      </button>
                    </div>

                    {hit.gated ? (
                      <div className="badge err">{t("model.gated")}</div>
                    ) : null}

                    {opened?.repo === hit.repo ? (
                      <div className="lfiles">
                        {opened.files.length === 0 ? (
                          <div className="desc">{t("model.noFiles")}</div>
                        ) : (
                          /* The inner box gives every row one width. Without it
                             each row is as wide as its own label, and the sizes
                             and verdicts end up ragged instead of in columns. */
                          <div className="lfiles-in">
                            {opened.files.map((file) => {
                              const fit = hardware ? judgeFit(file.totalBytes, hardware) : null
                              return (
                                <div className="lfile" key={file.label + file.totalBytes}>
                                  <span className="lfile-label mono" title={file.label}>
                                    {file.label}
                                  </span>
                                  <span className="lfile-size mono">
                                    {formatBytes(file.totalBytes)}
                                  </span>
                                  {fit ? <FitPill fit={fit} /> : null}
                                  <button
                                    type="button"
                                    className="iconbtn tiny"
                                    title={t("model.downloadThis", { repo: hit.repo })}
                                    onClick={() => void downloadGroup(hit.repo, file)}
                                  >
                                    <IconDownload size={12} />
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            <div className="desc" style={{ paddingTop: 6 }}>
              {t("model.searchNote")}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** One line saying what this machine has, so the pills have a visible basis. */
function HardwareLine({ hw }: { hw: HardwareFacts }) {
  const t = useT()
  return (
    <div className="lhwinfo">
      {hw.gpuName ? (
        <span className="badge">
          {hw.gpuName} · {formatBytes(hw.vramTotalBytes)}
        </span>
      ) : null}
      <span className="badge">{t("model.ram", { size: formatBytes(hw.ramTotalBytes) })}</span>
      <span className="badge">
        {t("model.diskFree", { size: formatBytes(hw.diskFreeBytes) })}
      </span>
    </div>
  )
}

function FitPill({ fit }: { fit: Fit }) {
  const t = useT()
  if (fit === "fits-gpu") {
    return <span className="badge ok">{t("model.fitsGpu")}</span>
  }
  if (fit === "needs-ram") {
    return <span className="badge warn">{t("model.needsRam")}</span>
  }
  return <span className="badge err">{t("model.tooBig")}</span>
}

/** Progress of the download the user just asked for. */
function DownloadBar({ name }: { name: string }) {
  const t = useT()
  const [progress, setProgress] = useState<{ fraction: number | null; message?: string } | null>(null)
  const [job, setJob] = useState<string | null>(null)

  useEffect(() => {
    return window.ocd.model.onProgress((next) => {
      if (next.model !== name) return
      if (next.status === "running") {
        setJob(next.id)
        setProgress({ fraction: next.fraction, message: next.message })
      } else {
        setJob(null)
        setProgress(null)
      }
    })
  }, [name])

  if (!progress) return null

  return (
    <div className="lpull">
      <code className="lpull-name" title={name}>
        {name}
      </code>
      {progress.fraction === null ? (
        <span className="desc grow">{progress.message ?? t("model.pullStarting")}</span>
      ) : (
        <>
          <div className="lbar">
            <div className="lbar-fill" style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
          </div>
          <span className="lpull-num mono">{Math.round(progress.fraction * 100)}%</span>
        </>
      )}
      {job ? (
        <button
          type="button"
          className="iconbtn tiny"
          title={t("model.pullCancel")}
          onClick={() => void window.ocd.model.pullCancel(job)}
        >
          <IconClose size={12} />
        </button>
      ) : null}
    </div>
  )
}
