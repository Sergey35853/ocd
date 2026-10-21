import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { EventEmitter } from "node:events"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

/** Same config files the oc-voice / oc-dictate OpenCode plugins use. */
function pluginConfigPath(name: string): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")
  return join(base, "opencode", `${name}.json`)
}

function readPluginConfig(name: string): Record<string, unknown> {
  const file = pluginConfigPath(name)
  try {
    if (!existsSync(file)) return {}
    const parsed = JSON.parse(readFileSync(file, "utf8"))
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function scratchDir(): string {
  return join(tmpdir(), "ocd-voice")
}

/**
 * Remove a scratch file.
 *
 * The voice helper works through files in %TEMP%, and nothing ever cleaned
 * them up: every spoken sentence and every dictation left its text, its
 * recording and its audio behind. A file that will not delete is not worth
 * failing a speech over.
 */
function removeScratch(...files: Array<string | undefined>): void {
  for (const file of files) {
    if (!file) continue
    try {
      if (existsSync(file)) rmSync(file, { force: true })
    } catch {
      /* still in use, or already gone */
    }
  }
}

export interface VoiceDefaults {
  engine: "auto" | "edge" | "sapi"
  voice: string
  rate: string
  volume: string
  pitch: string
  maxChars: number
  speakReplies: boolean
  sttModel: string
  sttLanguage: string
  micDevice: string
  maxSeconds: number
}

export interface SpeakResult {
  ok: boolean
  skipped?: boolean
  engine?: string
  voice?: string
  error?: string
}

export interface DictationResult {
  ok: boolean
  text?: string
  lang?: string
  seconds?: number
  error?: string
}

/**
 * Wraps resources/voice.py (edge-tts + faster-whisper) and mirrors the
 * behaviour of the local oc-voice / oc-dictate plugins.
 */
export class Voice extends EventEmitter {
  private python: string | null = null
  private ffplay: string | null = null
  private player: ChildProcess | null = null
  private recorder: ChildProcess | null = null

  constructor() {
    super()
  }

  private resolvePython(): string {
    if (this.python) return this.python
    for (const candidate of ["python", "py", "python3"]) {
      const probe = spawnSync(candidate, ["-c", "import sys; print(sys.version_info[0])"], {
        windowsHide: true,
        encoding: "utf8",
        timeout: 10_000,
      })
      if (probe.status === 0 && probe.stdout?.trim().startsWith("3")) {
        this.python = candidate
        return candidate
      }
    }
    throw new Error("Python 3 не найден — нужен для голоса и диктовки")
  }

  /** Defaults inherited from the oc-voice / oc-dictate plugin configs. */
  defaults(): VoiceDefaults {
    const voice = readPluginConfig("oc-voice")
    const dictate = readPluginConfig("oc-dictate")
    const voices = (voice.voices ?? {}) as Record<string, string>
    return {
      engine: (voice.engine as VoiceDefaults["engine"]) ?? "auto",
      voice: voices.ru ?? "ru-RU-SvetlanaNeural",
      rate: typeof voice.rate === "string" ? voice.rate : "+8%",
      volume: typeof voice.volume === "string" ? voice.volume : "+0%",
      pitch: typeof voice.pitch === "string" ? voice.pitch : "+0Hz",
      maxChars: typeof voice.maxChars === "number" ? voice.maxChars : 420,
      speakReplies: voice.enabled !== false,
      sttModel: typeof dictate.model === "string" ? dictate.model : "small",
      sttLanguage: typeof dictate.language === "string" ? dictate.language : "auto",
      micDevice: typeof dictate.device === "string" ? dictate.device : "",
      maxSeconds: typeof dictate.maxSeconds === "number" ? dictate.maxSeconds : 120,
    }
  }

  private scriptPath(): string {
    // Packaged: extraResources/voice.py. Dev: <project>/resources/voice.py
    const packaged = join(process.resourcesPath ?? "", "voice.py")
    if (process.resourcesPath && existsSync(packaged)) return packaged
    return join(__dirname, "../../resources/voice.py")
  }

  private runJson(
    args: string[],
    timeoutMs: number,
  ): Promise<Record<string, unknown> & { ok: boolean }> {
    const python = this.resolvePython()
    return new Promise((resolve) => {
      const child = spawn(python, [this.scriptPath(), ...args], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      })
      let out = ""
      let settled = false
      const done = (value: Record<string, unknown> & { ok: boolean }) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      child.stdout?.setEncoding("utf8")
      child.stdout?.on("data", (chunk) => (out += chunk))
      child.stderr?.on("data", () => {})
      child.on("error", (err) => done({ ok: false, error: err.message }))
      child.on("close", () => {
        const lines = out.split("\n").filter((line) => line.trim().startsWith("{"))
        for (const line of lines.reverse()) {
          try {
            const parsed = JSON.parse(line) as Record<string, unknown> & { ok: boolean }
            if ("ok" in parsed) return done(parsed)
          } catch {
            /* keep looking */
          }
        }
        done({ ok: false, error: out.trim() || "voice helper produced no output" })
      })
      setTimeout(() => {
        child.kill()
        done({ ok: false, error: "timeout" })
      }, timeoutMs).unref?.()
    })
  }

  async devices(): Promise<{ devices: Array<{ index: number; name: string }>; default: number | null; error?: string }> {
    const result = await this.runJson(["devices"], 30_000)
    return {
      devices: (result.devices as Array<{ index: number; name: string }>) ?? [],
      default: (result.default as number | null) ?? null,
      error: typeof result.error === "string" ? result.error : undefined,
    }
  }

  async voices(): Promise<Array<{ id: string; name: string; gender?: string; locale?: string }>> {
    const result = await this.runJson(["voices"], 45_000)
    return (result.voices as Array<{ id: string; name: string }>) ?? []
  }

  async speak(
    text: string,
    options: Partial<VoiceDefaults> & { playbackVolume?: number } = {},
  ): Promise<SpeakResult> {
    const base = this.defaults()
    const merged = { ...base, ...options }
    if (!text.trim()) return { ok: true, skipped: true }

    const dir = scratchDir()
    const stamp = Date.now()
    const textFile = join(dir, `say-${stamp}.txt`)
    const outFile = join(dir, `say-${stamp}.mp3`)

    const { writeFileSync, mkdirSync } = await import("node:fs")
    mkdirSync(dir, { recursive: true })
    writeFileSync(textFile, text, "utf8")

    let spoken: string | undefined
    try {
      const result = await this.runJson(
        [
          "tts",
          "--text-file", textFile,
          "--out", outFile,
          "--engine", merged.engine,
          "--voice", merged.voice,
          "--rate", merged.rate,
          "--volume", merged.volume,
          "--pitch", merged.pitch,
          "--max-chars", String(merged.maxChars),
        ],
        120_000,
      )

      const file = (result.file as string | undefined) ?? outFile
      spoken = file
      if (!result.ok || !existsSync(file)) {
        return { ok: false, error: (result.error as string) ?? "синтез не удался" }
      }
      await this.play(file, options.playbackVolume ?? 100)
      return {
        ok: true,
        engine: (result.engine as string) ?? merged.engine,
        voice: (result.voice as string) ?? merged.voice,
      }
    } finally {
      // The text has been read and the audio has been played: the scratch
      // files have served their purpose. The audio is only removed after the
      // playback ended, so the player always finds its file.
      removeScratch(textFile, outFile, spoken)
    }
  }

  private resolveFfplay(): string | null {
    if (this.ffplay) return this.ffplay
    const probe = spawnSync("where", ["ffplay"], {
      windowsHide: true,
      encoding: "utf8",
      timeout: 8000,
    })
    const first = probe.stdout?.trim().split(/\r?\n/)[0]
    if (probe.status === 0 && first) {
      this.ffplay = first
      return first
    }
    return null
  }

  private play(file: string, volume: number): Promise<void> {
    this.stopPlayback()
    return new Promise((resolve) => {
      const exe = this.resolveFfplay()
      if (!exe) {
        resolve()
        return
      }
      const child = spawn(
        exe,
        ["-nodisp", "-autoexit", "-loglevel", "quiet", "-volume", String(volume), file],
        { windowsHide: true, stdio: "ignore" },
      )
      this.player = child
      child.on("close", () => {
        if (this.player === child) this.player = null
        resolve()
      })
      child.on("error", () => {
        if (this.player === child) this.player = null
        resolve()
      })
    })
  }

  stopPlayback(): void {
    try {
      this.player?.kill()
    } catch {
      /* already gone */
    }
    this.player = null
  }

  /** Long-lived capture; resolves with the transcript once stopped. */
  startDictation(
    onState: (state: "recording" | "transcribing") => void,
    options: Partial<VoiceDefaults> = {},
  ): Promise<DictationResult> {
    this.cancelDictation()
    const base = this.defaults()
    const merged = { ...base, ...options }

    return new Promise((resolve) => {
      let python: string
      try {
        python = this.resolvePython()
      } catch (err) {
        resolve({ ok: false, error: err instanceof Error ? err.message : String(err) })
        return
      }

      const stamp = Date.now()
      const outFile = join(scratchDir(), `take-${stamp}.wav`)
      const { mkdirSync } = require("node:fs") as typeof import("node:fs")
      mkdirSync(scratchDir(), { recursive: true })

      const child = spawn(
        python,
        [
          this.scriptPath(),
          "dictate",
          "--out", outFile,
          "--device", merged.micDevice,
          "--model", merged.sttModel,
          "--language", merged.sttLanguage,
          "--max-seconds", String(merged.maxSeconds),
        ],
        {
          windowsHide: true,
          stdio: ["pipe", "pipe", "ignore"],
          env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
        },
      )
      this.recorder = child
      onState("recording")

      let out = ""
      child.stdout?.setEncoding("utf8")
      child.stdout?.on("data", (chunk) => {
        out += chunk
      })
      child.on("error", (err) => {
        this.recorder = null
        resolve({ ok: false, error: err.message })
        removeScratch(outFile)
      })
      child.on("close", () => {
        this.recorder = null
        const lines = out.split("\n").filter((line) => line.trim().startsWith("{"))
        let transcript: DictationResult | null = null
        for (const line of lines.reverse()) {
          try {
            const parsed = JSON.parse(line) as DictationResult
            if ("text" in parsed) {
              transcript = parsed
              break
            }
            if (parsed.ok === false && parsed.error) {
              transcript = { ok: false, error: parsed.error }
            }
          } catch {
            /* keep looking */
          }
        }
        resolve(transcript ?? { ok: false, error: "нет расшифровки" })
        // The helper is gone and the recording has been read: the file has
        // nothing left to do in %TEMP%.
        removeScratch(outFile)
      })
    })
  }

  /** Ask the capture to finish and transcribe. */
  stopDictation(): void {
    try {
      this.recorder?.stdin?.write("stop\n")
    } catch {
      /* child already gone */
    }
  }

  cancelDictation(): void {
    if (!this.recorder) return
    try {
      // Closing stdin without a stop line tells the helper to discard.
      this.recorder.stdin?.end()
    } catch {
      /* ignore */
    }
    try {
      this.recorder.kill()
    } catch {
      /* ignore */
    }
    this.recorder = null
  }

  dispose(): void {
    this.stopPlayback()
    this.cancelDictation()
  }
}

export const voice = new Voice()