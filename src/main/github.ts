import { readFileSync, statSync } from "node:fs"
import { isAbsolute, join } from "node:path"

/** A repository as GitHub addresses it. */
export interface GhRepo {
  owner: string
  repo: string
}

/** One issue or pull request, in the shape the dialog lists. */
export interface GhItem {
  number: number
  title: string
  url: string
  state: string
}

/**
 * Pull the `owner/repo` out of a GitHub remote URL.
 *
 * Handles the three forms git actually writes — https, scp-like `git@…:`, and
 * `ssh://` — with or without the trailing `.git`. Anything that is not a GitHub
 * remote returns null: the caller then has nothing to show rather than a
 * repository name it invented.
 */
export function parseGithubUrl(url: string): GhRepo | null {
  const clean = url.trim()
  const patterns = [
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
    /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  ]
  for (const pattern of patterns) {
    const match = clean.match(pattern)
    if (match) return { owner: match[1], repo: match[2] }
  }
  return null
}

/** Where a repository's config lives — accounting for a worktree's `.git` file. */
function configPath(directory: string): string | null {
  try {
    const dotGit = join(directory, ".git")
    if (statSync(dotGit).isFile()) {
      // A worktree: `.git` is a file pointing at a gitdir that lives two levels
      // below the real `.git`, where the shared config sits.
      const text = readFileSync(dotGit, "utf8")
      const match = text.match(/^gitdir:\s*(.+)$/m)
      if (!match) return null
      const gitdir = match[1].trim()
      // git writes an absolute path for a worktree and a relative one for a
      // submodule. A relative path means "relative to this folder", not to
      // whatever directory the process happens to have been started in.
      const base = isAbsolute(gitdir) ? gitdir : join(directory, gitdir)
      return join(base, "..", "..", "config")
    }
    return join(dotGit, "config")
  } catch {
    return null
  }
}

/**
 * The GitHub repository a working copy points at, read straight from
 * `.git/config` — no process is spawned and no network is touched, so this
 * answers for a folder that is not currently connected to anything.
 *
 * A config can name several remotes and they need not agree: the first one may
 * be a mirror on another host with GitHub listed second. Every `url` is
 * therefore tried, and the answer is the first that is GitHub at all — the
 * alternative is telling someone their folder is not a GitHub repository while
 * it plainly is.
 */
export function githubRepo(directory: string): GhRepo | null {
  try {
    const path = configPath(directory)
    if (!path) return null
    const config = readFileSync(path, "utf8")
    for (const match of config.matchAll(/^\s*url\s*=\s*(\S+)\s*$/gm)) {
      const repo = parseGithubUrl(match[1])
      if (repo) return repo
    }
    return null
  } catch {
    return null
  }
}

/**
 * One authenticated GET against the GitHub REST API.
 *
 * The same global `fetch` every other main-process request uses. A non-2xx is
 * an error with the status in it, so a bad token reads as "401" rather than as
 * an empty list the caller cannot distinguish from a repository with no issues.
 */
async function ghGet<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "ocd",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`GitHub ${response.status}`)
  return (await response.json()) as T
}

interface GhApiItem {
  number: number
  title: string
  html_url: string
  state: string
  pull_request?: unknown
}

function requireToken(token: string): string {
  const clean = token.trim()
  if (!clean) throw new Error("No GitHub token")
  return clean
}

/** Open issues for the working copy's repository. PRs are excluded here. */
export async function githubIssues(directory: string, token: string): Promise<GhItem[]> {
  const repo = githubRepo(directory)
  if (!repo) throw new Error("Not a GitHub repository")
  const key = requireToken(token)
  const data = await ghGet<GhApiItem[]>(
    `/repos/${repo.owner}/${repo.repo}/issues?state=open&per_page=30`,
    key,
  )
  // The issues endpoint answers with pull requests too; they carry a
  // `pull_request` marker and belong in the other list.
  return (Array.isArray(data) ? data : [])
    .filter((item) => !item.pull_request)
    .map((item) => ({ number: item.number, title: item.title, url: item.html_url, state: item.state }))
}

/** Open pull requests for the working copy's repository. */
export async function githubPulls(directory: string, token: string): Promise<GhItem[]> {
  const repo = githubRepo(directory)
  if (!repo) throw new Error("Not a GitHub repository")
  const key = requireToken(token)
  const data = await ghGet<GhApiItem[]>(
    `/repos/${repo.owner}/${repo.repo}/pulls?state=open&per_page=30`,
    key,
  )
  return (Array.isArray(data) ? data : []).map((item) => ({
    number: item.number,
    title: item.title,
    url: item.html_url,
    state: item.state,
  }))
}
