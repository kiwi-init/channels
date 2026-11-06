import "~/styles/mods.css"

import { PuzzleIcon } from "@hugeicons/core-free-icons"

import { cx } from "~/kit/bits"
import { GlyphIcon } from "~/kit/icons"
import { modsNow, useModsVersion } from "~/mods/host"
import { useApp } from "~/nav"

export default function RailMods() {
  useModsVersion()
  const { nav, go } = useApp()
  const on = nav.page === "settings" && nav.section === "mods"
  const waiting = modsNow().filter((m) => m.state === "asks").length
  const label = waiting ? `Mods, ${waiting} waiting for you` : "Mods"
  return (
    <button
      type="button"
      className={cx("rail-gear rail-mods", on && "is-on")}
      aria-label={label}
      aria-current={on ? "page" : undefined}
      title={label}
      onClick={() => (on ? go({ to: "back" }) : go({ to: "settings", section: "mods" }))}
    >
      <GlyphIcon glyph={PuzzleIcon} size={18} />
      {waiting > 0 && <span className="rail-mods-dot" />}
    </button>
  )
}
