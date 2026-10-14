/**
 * Judge a model against this machine, before it is downloaded.
 *
 * The bands match the wording the catalog uses: a model that fits in video
 * memory, one that will spill into system RAM and run slower, and one that will
 * not load at all. Coarse on purpose — it works from the file size alone, which
 * is the only number available while the user is still looking at a list.
 */

/** KV cache and compute buffers, on top of the weights. Roughly ten percent. */
const KV_AND_OVERHEAD = 0.1

export type Fit = "fits-gpu" | "needs-ram" | "too-big"

export interface HardwareFacts {
  uma: boolean
  vramTotalBytes: number
  vramUsableBytes: number
  ramTotalBytes: number
  ramAvailableBytes: number
  diskFreeBytes: number
  gpuName?: string
  vendor?: string
}

export function judgeFit(totalBytes: number, hw: HardwareFacts): Fit {
  const need = totalBytes * (1 + KV_AND_OVERHEAD)

  // One pool: system RAM is the entire budget.
  if (hw.uma) return need <= hw.ramTotalBytes ? "fits-gpu" : "too-big"

  if (hw.vramTotalBytes > 0 && need <= hw.vramUsableBytes) return "fits-gpu"
  if (need <= hw.vramUsableBytes + hw.ramAvailableBytes) return "needs-ram"
  return "too-big"
}
