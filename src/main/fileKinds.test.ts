import { describe, expect, it } from "vitest"
import { isImage, isShortcut, mimeOf, nameForBytes, samePath } from "./fileKinds"

/**
 * What kind of file this is.
 *
 * Every case here is one that shipped broken at least once. The extension
 * guessed from the MIME turned a dropped `Makefile` into `Makefile.png`; an
 * unknown extension typed as text handed the model a file of replacement
 * characters. Both are invisible until a model has already been given base64
 * where source code was meant, which is exactly why they are pinned here.
 */
describe("mimeOf", () => {
  it("names media and documents by their own type", () => {
    expect(mimeOf("photo.png")).toBe("image/png")
    expect(mimeOf("photo.JPG")).toBe("image/jpeg")
    expect(mimeOf("clip.mp4")).toBe("video/mp4")
    expect(mimeOf("song.flac")).toBe("audio/flac")
    expect(mimeOf("paper.pdf")).toBe("application/pdf")
    expect(mimeOf("book.epub")).toBe("application/epub+zip")
  })

  it("calls source and data text, so the model receives it as text", () => {
    for (const name of ["a.py", "b.ts", "c.yaml", "d.toml", "e.md", "f.csv", "g.sh", "h.ipynb"]) {
      expect(mimeOf(name), name).toBe("text/plain")
    }
  })

  it("reads a file with no extension as text", () => {
    // Makefile, Dockerfile, LICENSE: no extension, and text far more often
    // than not.
    expect(mimeOf("Makefile")).toBe("text/plain")
    expect(mimeOf("LICENSE")).toBe("text/plain")
  })

  it("does not call an unknown extension text", () => {
    // This is the case that mattered: `data.bin` is bytes, and typing it as
    // text fills the model's context with replacement characters.
    expect(mimeOf("data.bin")).toBe("application/octet-stream")
    expect(mimeOf("blob.xyz")).toBe("application/octet-stream")
    expect(mimeOf("archive.zip")).toBe("application/zip")
  })

  it("is case-insensitive, as the file system is", () => {
    expect(mimeOf("README.MD")).toBe("text/plain")
    expect(mimeOf("PHOTO.PNG")).toBe("image/png")
  })
})

describe("isImage", () => {
  it("recognises what the chat can show a thumbnail for", () => {
    expect(isImage("a.png")).toBe(true)
    expect(isImage("a.WEBP")).toBe(true)
    expect(isImage("a.svg")).toBe(true)
  })

  it("does not claim documents and archives", () => {
    expect(isImage("a.pdf")).toBe(false)
    expect(isImage("a.mp4")).toBe(false)
    expect(isImage("a.py")).toBe(false)
  })
})

describe("isShortcut", () => {
  it("recognises the two kinds of Windows pointer", () => {
    expect(isShortcut("app.lnk")).toBe(true)
    expect(isShortcut("site.URL")).toBe(true)
  })

  it("does not treat an installer or an executable as one", () => {
    expect(isShortcut("setup.exe")).toBe(false)
    expect(isShortcut("setup.msi")).toBe(false)
  })
})

describe("samePath", () => {
  it("collapses the two ways one Windows path gets written", () => {
    // A drag hands over forward slashes; a folder walk builds backslashes.
    // A Set lookup does not care about that, so the comparison must not either.
    expect(samePath("C:/Users/link_/Desktop/a.lnk")).toBe(samePath("C:\\Users\\link_\\Desktop\\a.lnk"))
    expect(samePath("C:/Users/LINK_/Desktop/a.lnk")).toBe(samePath("C:\\Users\\link_\\Desktop\\a.lnk"))
  })
})

describe("nameForBytes", () => {
  it("invents an extension for a pasted picture, which has no name of its own", () => {
    expect(nameForBytes("pasted", "image/png")).toBe("pasted.png")
    expect(nameForBytes("pasted", "image/jpeg")).toBe("pasted.jpg")
    expect(nameForBytes("pasted", "image/webp")).toBe("pasted.webp")
  })

  it("leaves a dropped file's own name alone", () => {
    // The bug: `конфиг.py` came back as `конфиг.py.png`, and a Python file was
    // announced to the model as a picture.
    expect(nameForBytes("конфиг.py", "image/png")).toBe("конфиг.py")
    expect(nameForBytes("data.bin", "application/octet-stream")).toBe("data.bin")
  })

  it("never invents one for text", () => {
    // `Makefile` has no extension and was nothing to do with pictures.
    expect(nameForBytes("Makefile", "text/plain")).toBe("Makefile")
    expect(nameForBytes("LICENSE", "application/octet-stream")).toBe("LICENSE")
  })
})
