import "~/styles/mods.css"

import { useCallback } from "react"

import { Empty } from "~/kit/empty"
import { PanelHead } from "~/panels/frame"
import { askAgain, modsNow, runningMod, showModIn, useModsVersion } from "~/mods/host"

export function ModPanel({ name }: { name: string }) {
  useModsVersion()
  const mod = modsNow().find((m) => m.name === name)
  const run = runningMod(name)
  const slot = useCallback(
    (el: HTMLDivElement | null) => {
      showModIn(name, el)
      return () => showModIn(name, null)
    },
    [name]
  )
  if (!mod)
    return (
      <>
        <PanelHead title={name} />
        <Empty title="This mod is gone." />
      </>
    )
  if (mod.state === "asks")
    return (
      <>
        <PanelHead title={name} sub={mod.version ? `mod ${mod.version}` : "mod"} />
        <Empty title="It waits for you to allow it.">
          <button type="button" className="btn is-primary" onClick={() => askAgain(name)}>
            See what it asks for
          </button>
        </Empty>
      </>
    )
  if (mod.state === "off" || run?.failed)
    return (
      <>
        <PanelHead title={name} sub="mod" />
        <Empty title={mod.state === "off" ? "This mod is off." : "This mod stopped."}>
          <p className="mod-why">{mod.why ?? run?.failed}</p>
        </Empty>
      </>
    )
  return (
    <>
      <PanelHead title={run?.title ?? name} sub="mod" />
      <div ref={slot} className="panel-body mod-slot" />
    </>
  )
}
