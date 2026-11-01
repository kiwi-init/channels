import { useCallback, useEffect, useState } from "react"

import { DEMO_PREFS } from "~/demo/data"
import { useDemo } from "~/demo/provider"
import { SHOTS } from "~/demo/shots"
import type { Prefs } from "~/model"
import { navigate, startNav, type Go, type Nav } from "~/nav"
import { Root } from "~/shell/root"
import { uiBooted } from "@kiwi/app/ui-boot.ts"

const params = new URLSearchParams(location.search)
const shot = SHOTS[params.get("shot") ?? ""] ?? SHOTS.channel
const theme = params.get("theme")
const look: Partial<Prefs> = { ...shot?.prefs, ...(theme === "light" || theme === "dark" ? { theme } : {}) }

export const demoPrefs: Prefs = { ...DEMO_PREFS, ...look }

const SWITCH_AFTER_MS = 400

function threadAt(param: string | null): { seq: number; focus: number } | null {
  const found = /^(\d{1,9}):(\d{1,9})$/.exec(param ?? "")
  return found ? { seq: Number(found[1]), focus: Number(found[2]) } : null
}

const switchTo = threadAt(params.get("switch"))

export function DemoApp() {
  const [nav, setNav] = useState<Nav>(() => ({ ...startNav(shot?.channel ?? null), ...shot?.nav }))
  const app = useDemo(shot?.scenario ?? "full", nav.channel, look)
  const go = useCallback((g: Go) => setNav((n) => navigate(n, g)), [])
  useEffect(uiBooted, [])
  useEffect(() => {
    if (!switchTo) return
    const timer = setTimeout(() => go({ to: "panel", panel: { kind: "thread", ...switchTo } }), SWITCH_AFTER_MS)
    return () => clearTimeout(timer)
  }, [go])
  return <Root app={app} nav={nav} go={go} />
}
