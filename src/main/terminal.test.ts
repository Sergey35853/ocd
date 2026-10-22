import { describe, expect, it } from "vitest"
import { runCommand } from "./terminal"

/**
 * The one-shot runner the verify-after-done check uses.
 *
 * The whole point is a verdict: the exit code has to be right, both streams
 * have to be captured, and a command that never finishes has to come back as
 * "did not finish" rather than hang the caller. These run real processes through
 * the same `cmd /c` the app uses, so a change to the runner that would break a
 * real verify breaks here first.
 */
describe("runCommand", () => {
  it("brings back a zero exit and stdout", async () => {
    const result = await runCommand("echo hello", undefined, 10_000)
    expect(result.exit).toBe(0)
    expect(result.stdout).toContain("hello")
  })

  it("treats a failing exit as a result, not a throw", async () => {
    const result = await runCommand("exit /b 3", undefined, 10_000)
    expect(result.exit).toBe(3)
  })

  it("captures stderr separately", async () => {
    const result = await runCommand("echo oops 1>&2", undefined, 10_000)
    expect(result.exit).toBe(0)
    expect(result.stderr).toContain("oops")
  })

  it("reports a command that never finishes as exit 124", async () => {
    const result = await runCommand("ping -n 20 127.0.0.1 > nul", undefined, 400)
    expect(result.exit).toBe(124)
  }, 20_000)
})
