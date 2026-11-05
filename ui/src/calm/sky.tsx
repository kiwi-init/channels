import { useEffect, useRef, useState } from "react"

import { startClouds } from "~/calm/clouds"

const STILL = "(prefers-reduced-motion: reduce)"
const FILL = { position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", background: "linear-gradient(to top, #a8cdf2 0%, #2157b8 100%)" } as const

export default function Sky() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [still, setStill] = useState(() => window.matchMedia(STILL).matches)
  const [drawn, setDrawn] = useState(true)

  useEffect(() => {
    const query = window.matchMedia(STILL)
    const changed = () => setStill(query.matches)
    query.addEventListener("change", changed)
    return () => query.removeEventListener("change", changed)
  }, [])

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const clouds = startClouds(el, { still })
    setDrawn(!!clouds)
    return () => clouds?.stop()
  }, [still])

  return (
    <div className="calm-sky" aria-hidden="true" style={FILL}>
      {drawn && <canvas ref={canvas} key={still ? "still" : "moving"} style={{ ...FILL, background: "transparent", display: "block" }} />}
    </div>
  )
}
