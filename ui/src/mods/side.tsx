import "~/styles/mods.css"

import { useCallback } from "react"

import { Heading } from "~/kit/bits"
import { modSides, showModIn, useModsVersion } from "~/mods/host"

export function ModSides() {
  useModsVersion()
  return modSides().map((s) => <ModSide key={s.name} {...s} />)
}

function ModSide({ name, title, height }: { name: string; title: string; height: number }) {
  const slot = useCallback(
    (el: HTMLDivElement | null) => {
      showModIn(name, el, "sidebar")
      return () => showModIn(name, null, "sidebar")
    },
    [name]
  )
  return (
    <section className="mod-side" aria-label={title}>
      <Heading>{title}</Heading>
      <div ref={slot} className="mod-side-slot" style={{ height }} />
    </section>
  )
}
