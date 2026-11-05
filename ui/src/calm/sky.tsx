import { useEffect, useRef, useState } from "react"

import loop from "~/calm/idle-loop.mp4"
import still from "~/calm/idle-still.jpg"

const STILL = "(prefers-reduced-motion: reduce)"
const FILL = { position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", objectFit: "cover" } as const

export default function Sky() {
  const video = useRef<HTMLVideoElement>(null)
  const [reduced, setReduced] = useState(() => window.matchMedia(STILL).matches)
  const [src, setSrc] = useState(loop)

  useEffect(() => {
    const query = window.matchMedia(STILL)
    const changed = () => setReduced(query.matches)
    query.addEventListener("change", changed)
    return () => query.removeEventListener("change", changed)
  }, [])

  useEffect(() => {
    if (reduced) return
    let url: string | null = null
    let gone = false
    void fetch(loop)
      .then((r) => r.arrayBuffer())
      .then((bytes) => {
        if (gone) return
        url = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" }))
        setSrc(url)
      })
      .catch(() => {
        // A loop that can't load leaves the still frame behind it in place.
      })
    return () => {
      gone = true
      if (url) URL.revokeObjectURL(url)
      setSrc(loop)
    }
  }, [reduced])

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
    const stayHidden = () => {
      if (document.hidden) el.pause()
    }
    document.addEventListener("visibilitychange", shown)
    el.addEventListener("play", stayHidden)
    el.addEventListener("playing", stayHidden)
    shown()
    return () => {
      document.removeEventListener("visibilitychange", shown)
      el.removeEventListener("play", stayHidden)
      el.removeEventListener("playing", stayHidden)
      el.pause()
      el.removeAttribute("src")
      el.load()
    }
  }, [src])

  return (
    <div className="calm-sky" aria-hidden="true" style={{ ...FILL, background: `#1b2236 url(${still}) center / cover no-repeat` }}>
      {!reduced && <video ref={video} src={src} poster={still} muted loop playsInline preload="auto" disablePictureInPicture style={FILL} />}
    </div>
  )
}
