import { describe, expect, it } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { githubRepo, parseGithubUrl } from "./github"

/**
 * How the GitHub panel decides whose repository it is looking at.
 *
 * The name is read out of the folder's own `.git/config` rather than by
 * spawning git, because the folder may be offline and a process for a name in
 * a title bar is not worth spawning. What has to hold is that every remote form
 * git actually writes lands on the same owner/repo, that anything which is not
 * GitHub reads as "not a repository" instead of a name the app invented, and
 * that a worktree — whose `.git` is a file, not a directory — still reaches the
 * config it shares with its main working copy.
 */
function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "ocd-gh-"))
}

/** A config with one remote pointing at `url`. */
function writeConfig(directory: string, url: string): void {
  mkdirSync(join(directory, ".git"), { recursive: true })
  writeFileSync(
    join(directory, ".git", "config"),
    `[core]\n\tbare = false\n[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`,
    "utf8",
  )
}

describe("the repository GitHub addresses", () => {
  it("takes owner and repo from the https remote", () => {
    expect(parseGithubUrl("https://github.com/Sergey35853/ocd.git")).toEqual({
      owner: "Sergey35853",
      repo: "ocd",
    })
  })

  it("takes them from the scp-like and ssh forms", () => {
    const expected = { owner: "Sergey35853", repo: "ocd" }
    expect(parseGithubUrl("git@github.com:Sergey35853/ocd.git")).toEqual(expected)
    expect(parseGithubUrl("ssh://git@github.com/Sergey35853/ocd")).toEqual(expected)
  })

  it("refuses a remote that is not GitHub", () => {
    // The dialog's only other answer is "this folder is not a GitHub
    // repository", so a host it cannot query must read as null rather than as
    // a repository whose API calls all fail.
    expect(parseGithubUrl("https://gitlab.com/someone/ocd.git")).toBeNull()
    expect(parseGithubUrl("https://github.com/Sergey35853")).toBeNull()
    expect(parseGithubUrl("")).toBeNull()
  })

  it("refuses a page below the repository", () => {
    // A branch URL is a location inside a repo; taking it as the repo would
    // address the API as owner/repo/tree/main.
    expect(parseGithubUrl("https://github.com/Sergey35853/ocd/tree/main")).toBeNull()
  })
})

describe("the repository is read from the folder's own .git", () => {
  it("reads the remote out of .git/config", () => {
    const dir = tempDir()
    try {
      writeConfig(dir, "https://github.com/Sergey35853/ocd.git")
      expect(githubRepo(dir)).toEqual({ owner: "Sergey35853", repo: "ocd" })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("reports no repository for a folder that is not one", () => {
    const dir = tempDir()
    try {
      expect(githubRepo(dir)).toBeNull()
      writeConfig(dir, "https://gitlab.com/someone/ocd.git")
      expect(githubRepo(dir)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("takes the first GitHub remote when another host comes first", () => {
    // Mirrors happen: origin on a private host, GitHub listed second. Refusing
    // here would tell someone their folder is not a GitHub repository while it
    // plainly is.
    const dir = tempDir()
    try {
      mkdirSync(join(dir, ".git"), { recursive: true })
      writeFileSync(
        join(dir, ".git", "config"),
        '[remote "origin"]\n\turl = https://gitlab.com/someone/ocd.git\n[remote "github"]\n\turl = git@github.com:Sergey35853/ocd.git\n',
        "utf8",
      )
      expect(githubRepo(dir)).toEqual({ owner: "Sergey35853", repo: "ocd" })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("reaches the shared config through a worktree's .git file", () => {
    // In a worktree `.git` is a file naming a gitdir two levels below the real
    // `.git`; reading `.git/config` as a directory would simply throw.
    const main = tempDir()
    const worktree = join(tempDir(), "wt")
    try {
      writeConfig(main, "https://github.com/Sergey35853/ocd.git")
      mkdirSync(join(main, ".git", "worktrees", "wt"), { recursive: true })
      mkdirSync(worktree, { recursive: true })
      writeFileSync(
        join(worktree, ".git"),
        `gitdir: ${join(main, ".git", "worktrees", "wt")}\n`,
        "utf8",
      )
      expect(githubRepo(worktree)).toEqual({ owner: "Sergey35853", repo: "ocd" })
    } finally {
      rmSync(main, { recursive: true, force: true })
      rmSync(worktree, { recursive: true, force: true })
    }
  })

  it("resolves a relative gitdir against the folder, not the process", () => {
    // git writes `gitdir: ../.git/modules/…` for a submodule. Resolved against
    // the working directory of whatever launched the app, that path points
    // somewhere else entirely and the panel would find nothing.
    const root = tempDir()
    try {
      mkdirSync(join(root, ".git", "modules", "sub"), { recursive: true })
      writeFileSync(
        join(root, ".git", "config"),
        '[remote "origin"]\n\turl = https://github.com/Sergey35853/ocd.git\n',
        "utf8",
      )
      const sub = join(root, "sub")
      mkdirSync(sub, { recursive: true })
      writeFileSync(join(sub, ".git"), "gitdir: ../.git/modules/sub\n", "utf8")
      expect(githubRepo(sub)).toEqual({ owner: "Sergey35853", repo: "ocd" })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
