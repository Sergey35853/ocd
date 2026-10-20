/**
 * Write the update channel file for a packed build.
 *
 * electron-builder writes `resources/app-update.yml` for the installers, but
 * not for a plain `--dir` build: the file is part of what the installer lays
 * down. A build copied by hand therefore had no channel, and the app asked
 * for updates and got `ENOENT` — which it read as "there is no update" and
 * stayed quiet about it.
 *
 * The contents are the ones electron-builder would write: where the releases
 * live. The version is not in the file — the channel file on GitHub carries
 * that.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "..")
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const publish = pkg.build?.publish

if (!publish || publish.provider !== "github") {
  console.error("no github publish config in package.json — the channel cannot be written")
  process.exit(1)
}

const target = join(root, "release", "win-unpacked", "resources", "app-update.yml")
mkdirSync(dirname(target), { recursive: true })
writeFileSync(
  target,
  [
    `provider: ${publish.provider}`,
    `owner: ${publish.owner}`,
    `repo: ${publish.repo}`,
    `updaterCacheDirName: ${pkg.name}-updater`,
    "",
  ].join("\n"),
  "utf8",
)
console.log(`wrote ${target}`)
