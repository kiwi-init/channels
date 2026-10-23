import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { Boundary } from "@/components/kit"
import { noteSignInGone } from "@/lib/session"
import { applyStoredAppearance, stepTextSize } from "@/lib/theme"
import { bridge } from "@/lib/secrets"
import { migrateChannelsToStore } from "@/lib/channel"
import { initAccessibility } from "@/lib/accessibility"
import { noteSoftwareDrawing } from "@/lib/drawing"
import { hasBridge } from "@/lib/relay"
import { whenIdle } from "@/lib/later"
import { loadMarkdown, loadPermission, loadSurfaces } from "@/components/lazy"
import { ops } from "@/lib/channel-ops"
import { nudgeOnWake } from "@/lib/wake"

applyStoredAppearance()
bridge()?.onTextStep(stepTextSize)
// The desktop app on a Mac has no title bar: its traffic lights sit on the list's header (index.css shell-mac).
if (hasBridge() && /Mac/.test(navigator.platform)) document.documentElement.dataset.shell = "mac"
// Member keys an older renderer left in localStorage move to the app's secrets store, once.
void migrateChannelsToStore().catch(() => {})
initAccessibility()
nudgeOnWake(() => ops().nudge())

// A call nobody caught that failed because the sign-in ended: ask to sign in again, quietly.
window.addEventListener("unhandledrejection", (e) => {
  if (noteSignInGone(e.reason)) e.preventDefault()
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Boundary whole>
      <App />
    </Boundary>
  </StrictMode>
)

requestAnimationFrame(() =>
  setTimeout(() => {
    loadMarkdown()
    loadPermission()
    whenIdle(loadSurfaces)
    whenIdle(noteSoftwareDrawing)
  }, 0)
)
