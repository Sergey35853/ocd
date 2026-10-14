import { describe, expect, it } from "vitest"
import { fileUrl, ollamaRef, quantLabel } from "./hfBrowse"

/**
 * The quantisation a file name declares.
 *
 * The label is not decoration: it becomes the tag the engine is asked for, and
 * Ollama refuses a tag that is not a real quantisation. A label cut short here
 * offered `Q4_K` for a file that is `Q4_K_M`, and the download failed
 * complaining about a tag rather than about a file.
 */
describe("quantLabel", () => {
  it("takes the whole token, not a prefix of it", () => {
    // The exact case that broke: Q4_K and Q4_K_M are different builds.
    expect(quantLabel("qwen2.5-0.5b-instruct-q4_k_m.gguf")).toBe("Q4_K_M")
    expect(quantLabel("qwen2.5-0.5b-instruct-q3_k_m.gguf")).toBe("Q3_K_M")
    expect(quantLabel("qwen2.5-0.5b-instruct-q2_k.gguf")).toBe("Q2_K")
    expect(quantLabel("qwen2.5-0.5b-instruct-q4_0.gguf")).toBe("Q4_0")
    expect(quantLabel("qwen2.5-0.5b-instruct-q8_0.gguf")).toBe("Q8_0")
  })

  it("keeps the IQ series, which is written without a separator", () => {
    expect(quantLabel("model-IQ3_XXS.gguf")).toBe("IQ3_XXS")
    expect(quantLabel("DeepSeek-V4-Pro-IQ2XXS-Instruct.gguf")).toBe("IQ2XXS")
  })

  it("keeps the float builds", () => {
    expect(quantLabel("qwen-fp16.gguf")).toBe("FP16")
    expect(quantLabel("qwen-bf16.gguf")).toBe("BF16")
  })

  it("does not cut a longer name in half", () => {
    // `Q4KExperts` and `F16Compressor` are quantisation format names used
    // inside a real weight filename. Matching `q4` or `f16` out of them would
    // produce a label that is not a build anyone ships.
    expect(quantLabel("DeepSeek-V4-Flash-Q4KExperts-F16HC-F16Compressor.gguf")).toBe(
      "DeepSeek-V4-Flash-Q4KExperts-F16HC-F16Compressor.gguf",
    )
  })

  it("falls back to the file name when there is nothing to read", () => {
    expect(quantLabel("weights.gguf")).toBe("weights.gguf")
    expect(quantLabel("sub/dir/model.gguf")).toBe("model.gguf")
  })
})

describe("ollamaRef", () => {
  it("addresses one quantisation of a repository", () => {
    expect(ollamaRef("Qwen/Qwen2.5-0.5B-Instruct-GGUF", "Q4_K_M")).toBe(
      "hf.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF:q4_k_m",
    )
  })

  it("flattens whatever punctuation the label carries", () => {
    expect(ollamaRef("owner/repo", "IQ3-XXS")).toBe("hf.co/owner/repo:iq3_xxs")
  })
})

describe("fileUrl", () => {
  it("builds a resolvable link and escapes each segment", () => {
    expect(fileUrl("owner/repo", "model.gguf")).toBe(
      "https://huggingface.co/owner/repo/resolve/main/model.gguf",
    )
    // A space in a directory name has to be encoded, and the separators
    // between segments must survive: encoding the whole path turns the slash
    // into %2F and the route answers 400.
    expect(fileUrl("owner/my repo", "a b.gguf")).toBe(
      "https://huggingface.co/owner/my%20repo/resolve/main/a%20b.gguf",
    )
  })
})
