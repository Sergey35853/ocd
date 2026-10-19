import { resolve } from "node:path"
import { defineConfig, externalizeDepsPlugin } from "electron-vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/preload/index.ts"),
          // Guests of the preview pane get their own preload, attached in
          // main via will-attach-webview (see installPreviewGuestPreload).
          previewGuest: resolve("src/preload/previewGuest.ts"),
        },
      },
    },
  },
  renderer: {
    root: resolve("src/renderer"),
    resolve: {
      alias: {
        "@": resolve("src/renderer/src"),
        "@shared": resolve("src/shared"),
      },
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          // Main deck.
          index: resolve("src/renderer/index.html"),
          // Heads-up display: a second, much smaller entry that renders the
          // same status without the chat, sidebar or tab strip.
          hud: resolve("src/renderer/hud.html"),
          // The finished-reply card that appears in the bottom-right corner.
          notice: resolve("src/renderer/notice.html"),
        },
      },
    },
  },
})