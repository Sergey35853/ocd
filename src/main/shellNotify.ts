import { execFile } from "node:child_process"
import { log } from "./log"

/**
 * Telling Windows that an association changed.
 *
 * Windows resolves an AppUserModelID - the id that decides the name and icon in
 * the taskbar, Alt-Tab and the jump list - once per shell session and then keeps
 * the answer. A registration written while Explorer is already running is only
 * read again after something announces the change, so a corrected entry sits
 * there unused until the user logs out. `SHChangeNotify(SHCNE_ASSOCCHANGED)`
 * is that announcement.
 *
 * It is one function in shell32 with four integers for arguments, which reads
 * like it should be a direct call - and it is not: `process.dlopen` throws on
 * any binding shape in current Node, and spawning PowerShell with `Add-Type`
 * compiles C# on the fly, which is why it costs about a second. A second of
 * background CPU at startup, detached and unawaited, is a fair price for the
 * taskbar entry being right the first time rather than after a reboot.
 *
 * The call goes out base64-encoded: a here-string with quotes in it survives
 * neither the shell nor a path with an apostrophe in it.
 */

const SCRIPT = `
$src = @'
using System;
using System.Runtime.InteropServices;
public static class OcdShellRefresh {
  [DllImport("shell32.dll", CharSet = CharSet.Auto, SetLastError = false)]
  private static extern void SHChangeNotify(int eventId, uint flags, IntPtr item1, IntPtr item2);
  public static void Go() { SHChangeNotify(0x08000000, 0x0000, IntPtr.Zero, IntPtr.Zero); }
}
'@
Add-Type -TypeDefinition $src
[OcdShellRefresh]::Go()
`

/** `SHCNE_ASSOCCHANGED`, and `SHCNF_IDLIST`. */
function encoded(): string {
  return Buffer.from(SCRIPT, "utf16le").toString("base64")
}

let started = false

/**
 * Announce that associations changed, so the shell re-reads them.
 *
 * Detached on purpose: the caller is holding up a window, and the answer is
 * something Explorer will have done by the time anyone looks at the taskbar.
 * Fire and forget, once per start, with the failure written to the log.
 */
export function refreshShellAssociations(): void {
  if (started) return
  started = true
  if (process.platform !== "win32") return
  try {
    const child = execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded()],
      { windowsHide: true, timeout: 20_000 },
      (err) => {
        if (err) log.warn(`could not announce the association change: ${String(err)}`)
      },
    )
    child.unref()
  } catch (err) {
    log.warn(`could not announce the association change: ${String(err)}`)
  }
}