import { useCallback, useEffect, useMemo, useState } from "react"

import { rememberOnboarded } from "~/start/onboarded"
import { DEMO_PREFS } from "~/demo/data"
import { DEMO_HANDLES, navWithDemoHandles, renamedAgents, withDemoHandles } from "~/demo/handles"
import { useDemo } from "~/demo/provider"
import { SHOTS } from "~/demo/shots"
import { seedThreadDoc } from "~/demo/thread-doc"
import { docThread } from "@kiwi/core/doc/threads.ts"
import type { Prefs } from "~/model"
import { navigate, startNav, useKeepPlace, type Go, type Nav } from "~/nav"
import { Root } from "~/shell/root"
import { hashTarget } from "~/live/links"
import { openFromNote } from "~/live/open-message"
import { parseHash } from "@kiwi/channel/hash.ts"
import { uiBooted } from "@kiwi/app/ui-boot.ts"

const params = new URLSearchParams(location.search)
const shot = SHOTS[params.get("shot") ?? ""] ?? SHOTS.channel
const theme = params.get("theme")
const look: Partial<Prefs> = { ...shot?.prefs, ...(theme === "light" || theme === "dark" ? { theme } : {}) }

export const demoPrefs: Prefs = { ...DEMO_PREFS, ...look }

const seeded = shot?.nav?.where
if (shot?.docs !== undefined && shot.channel && seeded && seeded.kind !== "dm" && seeded.kind !== "theirs") seedThreadDoc(shot.channel, docThread(seeded), shot.docs, shot.streams)

if (!shot?.onboarding) rememberOnboarded(false)

const SWITCH_AFTER_MS = 400

function threadAt(param: string | null): { seq: number; focus: number } | null {
  const found = /^(\d{1,9}):(\d{1,9})$/.exec(param ?? "")
  return found ? { seq: Number(found[1]), focus: Number(found[2]) } : null
}

const switchTo = threadAt(params.get("switch"))

export function DemoApp() {
  const [nav, setNav] = useState<Nav>(() => ({ ...(shot?.channel ? navigate(startNav(null), { to: "channel", code: shot.channel }) : startNav(null)), ...shot?.nav }))
  const app = useDemo(shot?.scenario ?? "full", nav.channel, look)
  const go = useCallback((g: Go) => setNav((n) => navigate(n, g)), [])
  useEffect(uiBooted, [])
  useKeepPlace(nav)
  useEffect(() => {
    const fromHash = () => {
      const { hash, seq } = hashTarget(location.hash)
      const { code } = parseHash(hash)
      if (!code || !seq) return
      history.replaceState(null, "", `${location.pathname}${location.search}`)
      openFromNote(code, seq, (c) => go({ to: "channel", code: c, jump: true }))
    }
    window.addEventListener("hashchange", fromHash)
    return () => window.removeEventListener("hashchange", fromHash)
  }, [go])
  useEffect(() => {
    if (!switchTo) return
    const timer = setTimeout(() => go({ to: "panel", panel: { kind: "thread", ...switchTo } }), SWITCH_AFTER_MS)
    return () => clearTimeout(timer)
  }, [go])
  const shown = useMemo(() => (DEMO_HANDLES ? withDemoHandles(app) : app), [app])
  useEffect(() => {
    if (DEMO_HANDLES) document.documentElement.dataset.demoHandles = String(renamedAgents(shown))
  }, [shown])
  return <Root app={shown} nav={DEMO_HANDLES ? navWithDemoHandles(nav, app) : nav} go={go} />
}
