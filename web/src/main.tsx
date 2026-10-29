import { StrictMode, useEffect } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { Boundary } from "@/components/kit"
import { noteSignInGone } from "@kiwi/channel/session.ts"
import { applyStoredAppearance, followAccent, showFrost, stepTextSize } from "@/lib/theme"
import { startBackdrop } from "@/lib/backdrop"
import { bridge } from "@kiwi/secrets/secrets.ts"
import { migrateChannelsToStore } from "@/lib/channel"
import { initAccessibility } from "@/lib/accessibility"
import { noteSoftwareDrawing } from "@/lib/drawing"
import { hasBridge } from "@kiwi/secrets/relay.ts"
import { whenIdle } from "@/lib/later"
import { loadMarkdown, loadPermission, loadSurfaces } from "@/components/lazy"
import { ops } from "@kiwi/channel/channel-ops.ts"
import { nudgeOnWake } from "@/lib/wake"
import { uiBooted, watchUiBoot } from "@/lib/ui-boot"

watchUiBoot()

function Booted() {
  useEffect(uiBooted, [])
  return null
}

applyStoredAppearance()
followAccent()
startBackdrop()
bridge()?.onTextStep(stepTextSize)
bridge()?.onFrost(showFrost)
// The desktop app on a Mac has no title bar: its traffic lights sit on the list's header (index.css shell-mac).
if (hasBridge() && /Mac/.test(navigator.platform)) document.documentElement.dataset.shell = "mac"
else if (hasBridge() && /Linux/.test(navigator.platform)) document.documentElement.dataset.shell = "linux"
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
      <Booted />
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
