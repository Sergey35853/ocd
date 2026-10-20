import { service } from "./service"
import { log } from "./log"

/**
 * A terminal inside the app.
 *
 * The server runs the command and keeps the process; the app only carries the
 * bytes. The stream is a websocket — the output arrives as the terminal
 * writes it, and what the user types goes back the other way.
 *
 * The socket lives in the main process: the renderer has no way to open a
 * websocket with the server's credentials, and the credentials are what the
 * server checks on the handshake.
 */

export interface PtyInfo {
  id: string
  title: string
  command: string
  args: string[]
  cwd: string
  status: "running" | "exited" | string
  pid?: number
  exitCode?: number
}

interface Session {
  socket: WebSocket
}

const sessions = new Map<string, Session>()

/** How the app is told that a terminal wrote something. */
export type PtyOutput = (payload: { id: string; data: string }) => void

let onOutput: PtyOutput = () => {}

/** Set the sink for terminal output; the window that asked for it. */
export function setPtyOutput(next: PtyOutput): void {
  onOutput = next
}

/**
 * Run a command and attach to it.
 *
 * The websocket is opened right away: a terminal that shows nothing until the
 * user types is a terminal that looks broken.
 */
export async function openPty(input: {
  command: string
  args?: string[]
  cwd?: string
  title?: string
}): Promise<PtyInfo> {
  const info = await service.post<PtyInfo>("/api/pty", {
    command: input.command,
    ...(input.args?.length ? { args: input.args } : {}),
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.title ? { title: input.title } : {}),
  })
  connect(info.id)
  return info
}

function connect(id: string): void {
  const url = new URL(`/api/pty/${id}/connect`, service.endpointUrl())
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  // The handshake is checked like any other request: without the credentials
  // the server answers "not a websocket" and the connection never opens.
  const socket = new WebSocket(url as unknown as string, {
    headers: service.authHeaders(),
  } as never)
  sessions.set(id, { socket })

  socket.addEventListener("open", () => {
    log.info(`pty ${id} connected`)
  })
  socket.addEventListener("message", (event: MessageEvent) => {
    void writeChunk(id, event.data)
  })
  socket.addEventListener("close", () => {
    sessions.delete(id)
    onOutput({ id, data: "" })
  })
  socket.addEventListener("error", () => {
    log.warn(`pty ${id} socket failed`)
  })
}

/** The frames come as binary; the terminal wants text. */
async function writeChunk(id: string, data: unknown): Promise<void> {
  let text = ""
  if (typeof data === "string") text = data
  else if (data instanceof ArrayBuffer) text = Buffer.from(data).toString("utf8")
  else if (ArrayBuffer.isView(data)) text = Buffer.from(data.buffer).toString("utf8")
  else if (data && typeof (data as Blob).text === "function") {
    text = await (data as Blob).text()
  }
  if (!text) return
  onOutput({ id, data: text })
}

/** What the user typed. */
export function writePty(id: string, data: string): void {
  const session = sessions.get(id)
  if (!session) return
  if (session.socket.readyState !== 1) return
  session.socket.send(data)
}

/** Stop the command and forget the session. */
export async function closePty(id: string): Promise<void> {
  const session = sessions.get(id)
  sessions.delete(id)
  try {
    session?.socket.close()
  } catch {
    /* already gone */
  }
  try {
    await service.del(`/api/pty/${id}`)
  } catch {
    // The server forgets a finished terminal on its own.
  }
}
