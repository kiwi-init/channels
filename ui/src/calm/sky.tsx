import { useEffect, useRef, useState } from "react"

import loop from "~/calm/idle-loop.mp4"
import still from "~/calm/idle-still.jpg"

const STILL = "(prefers-reduced-motion: reduce)"
const FILL = { position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", objectFit: "cover" } as const

export default function Sky() {
  const video = useRef<HTMLVideoElement>(null)
  const [reduced, setReduced] = useState(() => window.matchMedia(STILL).matches)

  useEffect(() => {
    const query = window.matchMedia(STILL)
    const changed = () => setReduced(query.matches)
    query.addEventListener("change", changed)
    return () => query.removeEventListener("change", changed)
  }, [])

  useEffect(() => {
    const el = video.current
    if (!el) return
    const shown = () => {
      if (document.hidden) el.pause()
      else
        void el.play().catch(() => {
          // A loop that won't play leaves its poster, the same still frame, in place.
        })
    }
    document.addEventListener("visibilitychange", shown)
    shown()
    return () => {
      document.removeEventListener("visibilitychange", shown)
      el.pause()
      el.removeAttribute("src")
      el.load()
    }
  }, [reduced])

  return (
    <div className="calm-sky" aria-hidden="true" style={{ ...FILL, background: `#1b2236 url(${still}) center / cover no-repeat` }}>
      {!reduced && <video ref={video} src={loop} poster={still} muted loop playsInline preload="auto" disablePictureInPicture style={FILL} />}
    </div>
  )
}
