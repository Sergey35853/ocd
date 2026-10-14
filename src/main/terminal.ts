import { spawn, spawnSync } from "node:child_process"
import { statSync } from "node:fs"

/** What the button actually managed to launch. */
export type TerminalLauncher = "wt" | "pwsh" | "powershell" | "cmd"

export interface OpenTerminalResult {
  launcher: TerminalLauncher
  /** False when nothing usable is installed, so the caller can say so. */
  opened: boolean
}

/**
 * Re-run a command in a terminal window the user can see.
 *
 * Not a terminal emulator: this hands the command to whatever terminal the
 * machine already has, which is the one with the user's fonts, colours, history
 * and copy-paste working. Building a second one inside the app would mean a PTY,
 * a grid renderer and native modules, to be worse than what ships with Windows.
 *
 * The command is handed over as a single argv element, never pasted into a
 * command line. That stops a path with a space in it from being split, but it
 * is not a sanitiser: `pwsh -Command` and `cmd /k` both parse what they are
 * given as a script, so a `;` in the command still separates statements. The
 * command comes from the agent's own tool calls, which the server's permission
 * system already gated, so re-running one is not a new privilege — but this is
 * not the place to be casual about a command from anywhere else.
 */
export function openInTerminal(command: string, cwd: string | undefined): OpenTerminalResult {
  const dir = cwd && existsDirectory(cwd) ? cwd : process.cwd()
  const wt = resolveOnPath("wt.exe")

  if (wt) {
    // `-d` sets the working directory; `-NoExit` keeps the window up after the
    // command finishes, so its output can still be read and re-run.
    const child = spawn(
      wt,
      ["-d", dir, "pwsh", "-NoExit", "-Command", command],
      { detached: true, stdio: "ignore", windowsHide: false },
    )
    child.unref()
    return { launcher: "wt", opened: true }
  }

  const shell = resolveOnPath("pwsh.exe") ?? resolveOnPath("powershell.exe")
  if (shell) {
    const launcher: TerminalLauncher = shell.toLowerCase().includes("powershell") ? "powershell" : "pwsh"
    const child = spawn(shell, ["-NoExit", "-Command", command], {
      cwd: dir,
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    })
    child.unref()
    return { launcher, opened: true }
  }

  const cmd = resolveOnPath("cmd.exe")
  if (!cmd) return { launcher: "cmd", opened: false }
  // cmd has no -NoExit; `start` keeps the window after the command returns.
  const child = spawn("cmd", ["/c", "start", "cmd", "/k", command], {
    cwd: dir,
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  })
  child.unref()
  return { launcher: "cmd", opened: true }
}

/** Full path of an executable on PATH, or null. */
function resolveOnPath(name: string): string | null {
  try {
    const probe = spawnSync("where", [name], {
      windowsHide: true,
      encoding: "utf8",
      timeout: 8000,
    })
    if (probe.status !== 0) return null
    const first = probe.stdout?.trim().split(/\r?\n/)[0]?.trim()
    return first || null
  } catch {
    return null
  }
}

function existsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
