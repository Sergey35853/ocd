/**
 * Comparing the version in hand with the version on offer.
 *
 * Its own module because it is the one part of the updater that can be checked
 * without an installer or a release channel, and because it was wrong once: the
 * screen announced "a new version is available: 0.1.9" while running 0.1.9,
 * because what the channel holds was reported without ever being compared
 * against what is installed.
 */

/** True when `found` is a version worth installing over `running`. */
export function isNewer(found: string | undefined, running: string): boolean {
  if (!found) return false
  // A `v` prefix and a build suffix are packaging noise, not the version.
  const clean = (value: string) => value.trim().replace(/^v/i, "").split("-")[0]
  const mine = clean(running).split(".").map((part) => Number.parseInt(part, 10))
  const theirs = clean(found).split(".").map((part) => Number.parseInt(part, 10))
  // Anything unparseable is compared as text, which is no worse than refusing
  // to answer: the caller has a version to show either way.
  if (mine.some((part) => Number.isNaN(part)) || theirs.some((part) => Number.isNaN(part))) {
    return found !== running
  }
  // Part by part, because "0.1.10" is newer than "0.1.9" and a string
  // comparison has it backwards.
  for (let i = 0; i < Math.max(mine.length, theirs.length); i += 1) {
    const a = mine[i] ?? 0
    const b = theirs[i] ?? 0
    if (b > a) return true
    if (b < a) return false
  }
  return false
}