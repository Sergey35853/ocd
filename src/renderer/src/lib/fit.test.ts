import { describe, expect, it } from "vitest"
import { judgeFit, type HardwareFacts } from "./fit"

/** A discrete card with room to spare, next to a machine with plenty of RAM. */
const roomy: HardwareFacts = {
  uma: false,
  vramTotalBytes: 8 * 1024 ** 3,
  vramUsableBytes: Math.floor(8 * 1024 ** 3 * 0.85),
  ramTotalBytes: 32 * 1024 ** 3,
  ramAvailableBytes: 16 * 1024 ** 3,
  diskFreeBytes: 400 * 1024 ** 3,
}

const gb = (n: number) => n * 1024 ** 3

describe("judgeFit", () => {
  it("calls a model that fits in video memory a fit", () => {
    expect(judgeFit(gb(4), roomy)).toBe("fits-gpu")
  })

  it("calls a model that will spill into RAM a partial fit", () => {
    // 9 GB of weights against 6.8 GB of video memory and 16 GB of RAM.
    expect(judgeFit(gb(9), roomy)).toBe("needs-ram")
  })

  it("refuses a model that cannot fit anywhere", () => {
    expect(judgeFit(gb(64), roomy)).toBe("too-big")
  })

  it("leaves headroom for the KV cache rather than judging the weights alone", () => {
    // 6.8 GB of usable video memory, and the overhead allowance pushes this
    // over. Judging the file size alone would have said it fits, and it would
    // then have failed to load.
    const atTheLine = Math.floor(roomy.vramUsableBytes / 1.1) + 1024
    expect(judgeFit(atTheLine, roomy)).not.toBe("fits-gpu")
  })

  it("treats unified memory as one pool", () => {
    const apple: HardwareFacts = {
      ...roomy,
      uma: true,
      vramTotalBytes: 0,
      vramUsableBytes: 0,
      ramTotalBytes: 16 * 1024 ** 3,
      ramAvailableBytes: 16 * 1024 ** 3,
    }
    // With one pool there is nowhere else for it to go, so RAM is the whole
    // budget and the partial band cannot exist.
    expect(judgeFit(gb(8), apple)).toBe("fits-gpu")
    expect(judgeFit(gb(24), apple)).toBe("too-big")
  })

  it("treats a machine with no discrete card as RAM-only", () => {
    const cpuOnly: HardwareFacts = { ...roomy, vramTotalBytes: 0, vramUsableBytes: 0 }
    expect(judgeFit(gb(9), cpuOnly)).toBe("needs-ram")
  })
})
