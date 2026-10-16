import { describe, expect, it } from "vitest"
import { execFile } from "node:child_process"

/**
 * The one thing in this fix that cannot be checked by looking at the source.
 *
 * The icon in the taskbar belongs to whatever Windows resolved the
 * AppUserModelID to when the shell started. The registration here is written at
 * startup, so without an announcement the shell keeps drawing the answer it
 * cached — which is how a corrected entry sat in the registry while the taskbar
 * went on showing another program's logo. `SHChangeNotify(SHCNE_ASSOCCHANGED)`
 * is that announcement, it is reached through PowerShell here, and whether the
 * shell answers is worth proving once.
 *
 * Skipped off Windows, and when PowerShell is not where it usually is.
 */
const windows = process.platform === "win32"

describe.skipIf(!windows)("shell association refresh", () => {
  it("runs and answers without an error", async () => {
    const script = `
$src = @'
using System;
using System.Runtime.InteropServices;
public static class OcdShellRefreshTest {
  [DllImport("shell32.dll", CharSet = CharSet.Auto, SetLastError = false)]
  private static extern void SHChangeNotify(int eventId, uint flags, IntPtr item1, IntPtr item2);
  public static void Go() { SHChangeNotify(0x08000000, 0x0000, IntPtr.Zero, IntPtr.Zero); }
}
'@
Add-Type -TypeDefinition $src
[OcdShellRefreshTest]::Go()
`
    const encoded = Buffer.from(script, "utf16le").toString("base64")
    const code = await new Promise<number>((resolve) => {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
        { windowsHide: true, timeout: 30_000 },
        (err) => resolve(err ? 1 : 0),
      )
    })
    expect(code).toBe(0)
  }, 40_000)
})