import "~/styles/afk-designs.css"

import { Captions } from "~/calm/designs/captions"
import { Crew } from "~/calm/designs/crew"
import { Day } from "~/calm/designs/day"
import { Goals } from "~/calm/designs/goals"
import { Letter } from "~/calm/designs/letter"
import { MapView } from "~/calm/designs/map"
import { DESIGN_NAMES, DESIGNS, type Design } from "~/calm/designs/shared"
import { daylight } from "~/calm/daylight"
import { Track } from "~/kit/glide"
import { useNow } from "~/kit/time"

function Picker({ design, pick }: { design: Design; pick: (d: Design) => void }) {
  return (
    <Track className="afk-picker afk-float" role="group" aria-label="Design" data-afk-keep="">
      {DESIGNS.map((d, i) => (
        <button key={d} type="button" aria-pressed={d === design} onClick={() => pick(d)}>
          <span className="mono">{i + 1}</span> {DESIGN_NAMES[d]}
        </button>
      ))}
    </Track>
  )
}

export function Designs({ design, pick, open, still, since }: { design: Design; pick: (d: Design) => void; open: (code: string) => void; still: boolean; since: number }) {
  const now = useNow(60_000)
  const sky = daylight(new Date(now)).night > 0.5 ? "night" : "day"
  return (
    <div className={`afk-design is-${design}`} data-sky={sky}>
      <Picker design={design} pick={pick} />
      {design === "letter" && <Letter open={open} since={since} />}
      {design === "captions" && <Captions open={open} still={still} />}
      {design === "crew" && <Crew open={open} />}
      {design === "day" && <Day since={since} />}
      {design === "goals" && <Goals open={open} />}
      {design === "map" && <MapView open={open} />}
    </div>
  )
}
