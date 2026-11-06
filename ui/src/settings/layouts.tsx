import { useEffect } from "react"

import { pickLayout, startLayouts, useLayouts } from "~/layout/live"
import { Row, Seg } from "~/settings/controls"
import { tilde } from "~/settings/themes"

export function LayoutRow() {
  const { dir, layouts, skipped, chosen } = useLayouts()
  useEffect(startLayouts, [])
  if (!dir || (!layouts.length && !skipped.length && !chosen)) return null
  const gone = !!chosen && !layouts.some((l) => l.file === chosen)
  const options: [string, string][] = [["", "Default"], ...layouts.map((l): [string, string] => [l.file, l.name])]
  if (gone) options.push([chosen, chosen.slice(0, -".json".length)])
  return (
    <Row
      label="Layout"
      hint={
        <>
          From <span className="set-mono">{tilde(dir)}</span>
          {gone && !skipped.some((s) => s.file === chosen) && (
            <span className="set-note">
              <span className="set-mono">{chosen}</span> isn't there, so the default shows
            </span>
          )}
          {skipped.map((s) => (
            <span key={s.file} className="set-note">
              <span className="set-mono">{s.file}</span> {s.why}
            </span>
          ))}
        </>
      }
    >
      <Seg label="Layout" value={chosen ?? ""} options={options} onChange={(file) => pickLayout(file || null)} />
    </Row>
  )
}
