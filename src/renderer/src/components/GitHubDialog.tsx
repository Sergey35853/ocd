import { useEffect, useState } from "react"
import { useStore } from "../lib/store"
import { useT } from "../i18n"
import { Modal } from "./ui"

interface Repo {
  owner: string
  repo: string
}

interface Entry {
  number: number
  title: string
  url: string
  state: string
}

/**
 * The repository's open work, and a way to hand one item to the agent.
 *
 * The repository is read from the folder's own `.git`, so the panel knows what
 * it is looking at even before a token exists; the lists come from the API and
 * need that token. "Work on this" opens a fresh conversation in the project and
 * sends the issue as its first prompt — the shortest path from a ticket to a
 * turn that starts doing something about it.
 */
export function GitHubDialog({ directory, onClose }: { directory: string; onClose(): void }) {
  const store = useStore()
  const t = useT()
  const token = store.settings?.githubToken?.trim() ?? ""

  const [repo, setRepo] = useState<Repo | null>(null)
  const [checkedRepo, setCheckedRepo] = useState(false)
  const [issues, setIssues] = useState<Entry[]>([])
  const [pulls, setPulls] = useState<Entry[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const found = await window.ocd.github.repo(directory).catch(() => null)
      if (!alive) return
      setRepo(found)
      setCheckedRepo(true)
      if (!found || !token) return
      setBusy(true)
      setError(null)
      try {
        const [issueList, pullList] = await Promise.all([
          window.ocd.github.issues(directory, token),
          window.ocd.github.pulls(directory, token),
        ])
        if (!alive) return
        setIssues(issueList)
        setPulls(pullList)
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (alive) setBusy(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [directory, token])

  /** Start a conversation in this project whose first prompt is the ticket. */
  const workOn = async (entry: Entry) => {
    const id = await store.newSession()
    if (!id) return
    await store.send(id, t("gh.workOn", { n: entry.number, title: entry.title, url: entry.url }))
    onClose()
  }

  const list = (title: string, items: Entry[], kind: "issue" | "pr") => (
    <div className="gh-list" key={kind}>
      <div className="gh-list-head">{title}</div>
      {items.length === 0 && !busy ? <p className="about-hint">{t("gh.empty")}</p> : null}
      {items.map((item) => (
        <div className="gh-row" key={`${kind}-${item.number}`}>
          <span className="gh-num">#{item.number}</span>
          <span className="grow" title={item.title}>
            {item.title}
          </span>
          <button
            type="button"
            className="btn ghost"
            title={t("gh.open")}
            onClick={() => void window.ocd.app.openExternal(item.url)}
          >
            {t("gh.open")}
          </button>
          <button type="button" className="btn" onClick={() => void workOn(item)}>
            {t("gh.workOnBtn")}
          </button>
        </div>
      ))}
    </div>
  )

  return (
    <Modal
      title={t("gh.title")}
      onClose={onClose}
      actions={
        <button type="button" className="btn" onClick={onClose}>
          {t("gh.close")}
        </button>
      }
    >
      {checkedRepo && !repo ? <p className="about-hint">{t("gh.notRepo")}</p> : null}
      {repo ? <p className="gh-repo">{`${repo.owner}/${repo.repo}`}</p> : null}
      {repo && !token ? <p className="about-hint">{t("gh.needToken")}</p> : null}
      {busy ? <p className="about-hint">{t("gh.loading")}</p> : null}
      {error ? <p className="arena-error">{t("gh.failed", { error })}</p> : null}
      {repo && token ? (
        <>
          {list(t("gh.issues"), issues, "issue")}
          {list(t("gh.pulls"), pulls, "pr")}
        </>
      ) : null}
    </Modal>
  )
}
