import "~/styles/mods.css"

import { useCallback } from "react"

import { Empty } from "~/kit/empty"
import { modsNow, runningMod, showModIn, useModsVersion } from "~/mods/host"

export function ModTab({ name }: { name: string }) {
  useModsVersion()
  const mod = modsNow().find((m) => m.name === name)
  const run = runningMod(name)
  const slot = useCallback(
    (el: HTMLDivElement | null) => {
      showModIn(name, el, "tab")
      return () => showModIn(name, null, "tab")
    },
    [name]
  )
  if (!mod) return <Empty title={`The mod ${name} isn't installed.`} />
  if (mod.state !== "on" || run?.failed)
    return (
      <Empty title={mod.state === "asks" ? `The mod ${name} waits for you to turn it on.` : mod.state === "off" ? `The mod ${name} is off.` : `The mod ${name} stopped.`}>
        {(mod.why ?? run?.failed) && <p className="mod-why">{mod.why ?? run?.failed}</p>}
      </Empty>
    )
  return <div ref={slot} className="mod-tab-slot" />
}
