import { spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { createServer } from "node:net"
import { join } from "node:path"

/**
 * Reach a remote OpenCode through an SSH tunnel.
 *
 * Why `ssh -L` and not an SSH library: OpenSSH ships with Windows, it is the
 * binary the user's own keys and `~/.ssh/config` already belong to, and a
 * local port forward is the least-privileged thing that works. Nothing about
 * the rest of the app has to change — it talks HTTP to `127.0.0.1:<port>`,
 * which is exactly what the tunnel exposes.
 *
 * Authentication is deliberately not scripted. Passwords are not passed on a
 * command line (visible in the process list) and not asked for interactively:
 * the user runs `ssh host` once in a terminal, the key agent or their known
 * host entry takes over, and the tunnel then starts without a prompt. Batch
 * mode makes that failure explicit instead of hanging on a hidden prompt.
 */

export interface TunnelTarget {
  /** `user@host` or just `host`. */
  host: string
  /** Port the remote OpenCode listens on. */
  remotePort: number
  /** Optional local port; 0 asks the OS for a free one. */
  localPort?: number
  /** Seconds to wait for the remote side to answer. */
  timeoutSeconds?: number
}

export interface Tunnel {
  /** Local base URL to use as `serverUrlOverride`. */
  url: string
  localPort: number
  stop(): void
}

function findSsh(): string | null {
  const system = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "OpenSSH", "ssh.exe")
  if (existsSync(system)) return system
  return null
}

/** Ask the OS for a free TCP port by binding and immediately releasing it. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (typeof address === "object" && address) {
        const { port } = address
        server.close(() => resolve(port))
      } else {
        server.close(() => reject(new Error("Could not reserve a local port")))
      }
    })
  })
}

export class TunnelError extends Error {
  constructor(
    message: string,
    readonly detail: string,
  ) {
    super(message)
    this.name = "TunnelError"
  }
}

/**
 * Open the tunnel and wait until the remote side actually answers.
 *
 * `ssh -L` returns long before the far end is usable, and a port that is open
 * locally is not proof the remote service exists — so the check is an actual
 * HTTP request, not a TCP connect.
 */
export async function openTunnel(target: TunnelTarget): Promise<Tunnel> {
  const ssh = findSsh()
  if (!ssh) {
    throw new TunnelError(
      "OpenSSH не найден",
      "Установите «OpenSSH Client» через Параметры → Приложения → Необязательные компоненты.",
    )
  }

  if (!target.host?.trim()) throw new TunnelError("Не указан хост", "")

  const localPort = target.localPort && target.localPort > 0 ? target.localPort : await freePort()
  const timeoutSeconds = target.timeoutSeconds ?? 12

  const args = [
    "-N", // no remote command: this process is only the tunnel
    "-L",
    `127.0.0.1:${localPort}:127.0.0.1:${target.remotePort}`,
    "-o",
    "BatchMode=yes", // never stop on a hidden password prompt
    "-o",
    "ExitOnForwardFailure=yes", // fail loudly instead of pretending to be up
    "-o",
    `ConnectTimeout=${timeoutSeconds}`,
    "-o",
    "ServerAliveInterval=20",
    "-o",
    "ServerAliveCountMax=3",
    target.host.trim(),
  ]

  const child: ChildProcess = spawn(ssh, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })

  let stderr = ""
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString()
    if (stderr.length > 8000) stderr = stderr.slice(-8000)
  })
  // Any stdout would mean the remote command ran; -N should keep it empty.
  child.stdout?.resume()

  let exited = false
  child.on("error", () => {
    exited = true
  })
  child.on("exit", () => {
    exited = true
  })

  const url = `http://127.0.0.1:${localPort}`

  const failure = (): never => {
    child.kill()
    const trimmed = stderr.trim()
    if (/Permission denied/i.test(trimmed)) {
      throw new TunnelError(
        "SSH отклонил аутентификацию",
        "Проверьте ключ или запись в ~/.ssh/config, выполнив `ssh хост` в терминале.",
      )
    }
    if (/Could not resolve hostname/i.test(trimmed)) {
      throw new TunnelError("Не найден хост", "Проверьте имя или адрес сервера.")
    }
    if (/Connection refused/i.test(trimmed)) {
      throw new TunnelError(
        "Удалённый порт закрыт",
        `OpenCode на сервере не слушает порт ${target.remotePort}. Запустите opencode serve --port ${target.remotePort}.`,
      )
    }
    if (/forward/i.test(trimmed)) {
      throw new TunnelError("Не удалось открыть порт", trimmed.split("\n").slice(-2).join(" "))
    }
    throw new TunnelError("SSH-туннель не поднялся", trimmed.split("\n").slice(-2).join(" "))
  }

  // Poll the tunnel with a real request until the remote side answers.
  const deadline = Date.now() + (timeoutSeconds + 8) * 1000
  while (Date.now() < deadline) {
    if (exited) failure()
    try {
      const probe = await fetch(`${url}/api/info`, {
        signal: AbortSignal.timeout(2500),
      })
      // Any HTTP answer means the tunnel works; the app reports a 404 itself.
      if (probe.status < 500) {
        return {
          url,
          localPort,
          stop: () => {
            if (!child.killed) child.kill()
          },
        }
      }
    } catch {
      // Not up yet — keep waiting.
    }
    await new Promise((r) => setTimeout(r, 350))
  }

  child.kill()
  throw new TunnelError(
    "Туннель открылся, но удалённый OpenCode не ответил",
    `Проверьте, что сервер запущен и слушает порт ${target.remotePort}.`,
  )
}

/** Open a tunnel and wire it into the service as an override endpoint. */
export class SshTunnelManager {
  private current: Tunnel | null = null

  active(): Tunnel | null {
    return this.current
  }

  async open(target: TunnelTarget): Promise<Tunnel> {
    this.close()
    const tunnel = await openTunnel(target)
    this.current = tunnel
    return tunnel
  }

  close(): void {
    this.current?.stop()
    this.current = null
  }
}

export const sshTunnel = new SshTunnelManager()