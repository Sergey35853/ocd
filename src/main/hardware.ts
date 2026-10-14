import { execFileSync } from "node:child_process"
import { arch, cpus, totalmem, freemem, platform } from "node:os"
import { existsSync, statfsSync } from "node:fs"

/** What this machine can actually hold a model in. */
export interface HardwareFacts {
  /** Unified memory: Apple silicon or an AMD APU where CPU and GPU share RAM. */
  uma: boolean
  /** Total device memory a GPU offers, bytes. 0 when there is no discrete GPU. */
  vramTotalBytes: number
  /** What can realistically be filled: total less what the driver keeps. */
  vramUsableBytes: number
  ramTotalBytes: number
  ramAvailableBytes: number
  /** Free space where models are stored; a full disk fails the download later. */
  diskFreeBytes: number
  gpuName?: string
  vramUsedBytes?: number
  vendor?: string
}

/**
 * Weight memory plus what inference needs around it.
 *
 * A GGUF file is not the whole cost: the KV cache, the compute buffers and the
 * context window are allocated on top of the weights. Roughly ten percent is the
 * number the ecosystem uses, and being generous here is the safe direction — a
 * model judged to fit should not then fail to load.
 */
const KV_AND_OVERHEAD = 0.1

/** Keys the runtime keeps for itself; the rest is fair game for a model. */
const V_RESERVED = 0.85

/**
 * Read the machine's budget.
 *
 * Deliberately reads *capacity* rather than what is free right now: a machine
 * with another model loaded should still show the big ones as plausible, or
 * every row would grey out whenever something else is running.
 */
export function probeHardware(): HardwareFacts {
  const ramTotalBytes = totalmem()
  const ramAvailableBytes = freemem()
  const nvidia = probeNvidia()

  // Apple silicon reports one pool, and a discrete GPU plus system RAM is two.
  const unified = platform() === "darwin" && arch() === "arm64"
  const vramTotalBytes = nvidia?.vramTotalBytes ?? 0

  return {
    uma: unified,
    vramTotalBytes,
    vramUsableBytes: Math.floor(vramTotalBytes * V_RESERVED),
    ramTotalBytes,
    ramAvailableBytes,
    diskFreeBytes: freeDisk(),
    gpuName: nvidia?.name,
    vramUsedBytes: nvidia?.usedBytes,
    vendor: nvidia ? "nvidia" : undefined,
  }
}

/** NVIDIA's report, or null when there is no card or no `nvidia-smi`. */
function probeNvidia(): { name: string; vramTotalBytes: number; usedBytes: number } | null {
  const smi = findNvidiaSmi()
  if (!smi) return null
  try {
    const output = execFileSync(
      smi,
      ["--query-gpu=name,memory.total,memory.used", "--format=csv,noheader,nounits"],
      { timeout: 5000, encoding: "utf8", windowsHide: true },
    ).trim()
    const line = output.split(/\r?\n/)[0]
    if (!line) return null
    const [name, totalMiB, usedMiB] = line.split(",").map((part) => part.trim())
    return {
      name,
      // nvidia-smi reports mebibytes; the arithmetic below is all in bytes.
      vramTotalBytes: Number(totalMiB) * 1024 * 1024,
      usedBytes: Number(usedMiB) * 1024 * 1024,
    }
  } catch {
    return null
  }
}

function findNvidiaSmi(): string | null {
  const roots = [
    process.env["ProgramFiles"] && `${process.env["ProgramFiles"]}\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe`,
    "C:\\Windows\\System32\\nvidia-smi.exe",
  ].filter(Boolean) as string[]
  for (const candidate of roots) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

function freeDisk(): number {
  try {
    const stats = statfsSync(process.cwd())
    return Number(stats.bavail) * Number(stats.bsize)
  } catch {
    return 0
  }
}

/** How a model of this size would run here. */
export type Fit = "fits-gpu" | "needs-ram" | "too-big"

export interface FitVerdict {
  fit: Fit
  /** Bytes needed including the overhead allowance. */
  needBytes: number
  /** Short reason, shown next to the pill. */
  detail: string
}

/**
 * Judge a model against this machine before it is downloaded.
 *
 * Coarse by design — it works from the file size alone, before the GGUF header
 * has been read. That is the point: the verdict has to exist while the user is
 * still looking at a list, not after a multi-gigabyte download.
 */
export function judgeFit(totalBytes: number, hw: HardwareFacts): FitVerdict {
  const needBytes = Math.ceil(totalBytes * (1 + KV_AND_OVERHEAD))

  if (hw.uma) {
    // One pool: system RAM is the whole budget.
    if (needBytes <= hw.ramTotalBytes) {
      return { fit: "fits-gpu", needBytes, detail: "в общей памяти" }
    }
    return { fit: "too-big", needBytes, detail: "больше, чем памяти в системе" }
  }

  if (hw.vramTotalBytes > 0 && needBytes <= hw.vramUsableBytes) {
    return { fit: "fits-gpu", needBytes, detail: "помещается в видеопамять" }
  }
  if (needBytes <= hw.vramUsableBytes + hw.ramAvailableBytes) {
    return { fit: "needs-ram", needBytes, detail: "частично в оперативной памяти" }
  }
  return { fit: "too-big", needBytes, detail: "не поместится" }
}

/** Cores, for the hint about a CPU-only fit running slowly. */
export function coreCount(): number {
  return cpus().length
}
