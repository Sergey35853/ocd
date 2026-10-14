import React from "react"
import { createRoot } from "react-dom/client"
import { NoticeCard } from "./components/NoticeCard"
import "./styles.css"

/**
 * Entry point for the finished-reply card.
 *
 * A bare renderer like the HUD: no store, no routing, no context. Main owns
 * the state and pushes it, and this window's only action is "open that
 * conversation".
 */
const container = document.getElementById("root")
if (!container) throw new Error("Root container missing")

createRoot(container).render(
  <React.StrictMode>
    <NoticeCard />
  </React.StrictMode>,
)
