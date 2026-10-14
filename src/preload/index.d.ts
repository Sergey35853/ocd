import type { OcdApi } from "@shared/types"

declare global {
  interface Window {
    ocd: OcdApi
  }
}

export {}