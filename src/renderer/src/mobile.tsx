import React from "react"
import { createRoot } from "react-dom/client"
import { MobileApp } from "./components/MobileApp"
import "./styles.css"

/**
 * Entry point for the phone client.
 *
 * Served by the gateway, not opened by the app: the page arrives on a phone
 * over Tailscale and reaches the OpenCode server only through the gateway's
 * allowlist.
 */
const container = document.getElementById("root")
if (!container) throw new Error("Root container missing")

createRoot(container).render(
  <React.StrictMode>
    <MobileApp />
  </React.StrictMode>,
)
