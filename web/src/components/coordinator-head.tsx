// The coordinator's face: an animated robot head (robot-heads, MIT) whose screen shows what it's doing
// (coordinator-mood.ts). Every other member keeps its monogram. The library is loaded on first use, so
// it isn't in the first bundle; until then, and wherever a head would be too many, a plain circle
// stands in.

import { lazy, Suspense, useEffect, useState } from "react"

import type { Mood } from "@/lib/coordinator-mood"
import { cx } from "@/lib/utils"

const RobotHead = lazy(() => import("robot-heads").then((m) => ({ default: m.RobotHead })))

/** A design token as a colour a canvas can use: CSS resolves light-dark() and the theme, not the canvas. */
function resolve(token: string): string {
  const probe = document.createElement("span")
  probe.style.color = `var(${token})`
  probe.style.display = "none"
  document.body.appendChild(probe)
  const c = getComputedStyle(probe).color
  probe.remove()
  return c
}

interface Tones {
  shell: string
  screen: string
  trim: string
}

const read = (): Tones => ({ shell: resolve("--head-shell"), screen: resolve("--head-screen"), trim: resolve("--head-trim") })

/** The head's colours from the tokens, following the theme (the system's, or the one picked in Settings). */
function useTones(): Tones {
  const [tones, setTones] = useState(read)
  useEffect(() => {
    const update = () => setTones(read())
    const media = matchMedia("(prefers-color-scheme: dark)")
    media.addEventListener("change", update)
    const watch = new MutationObserver(update)
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] })
    return () => {
      media.removeEventListener("change", update)
      watch.disconnect()
    }
  }, [])
  return tones
}

export function CoordinatorHead({
  size,
  mood,
  live = false,
  interactive = false,
  seed,
  className,
  label,
}: {
  size: number
  mood?: Mood
  /** Animate it. Off, it rests on its current face: a list of heads shouldn't all move at once. */
  live?: boolean
  /** Follow the pointer and hop on a click: only the big heads. */
  interactive?: boolean
  seed?: number
  className?: string
  label?: string
}) {
  const tones = useTones()
  // A still head first plays its entrance and settles on its resting face, then stops: frozen on its
  // first frame it would be caught mid-entrance, cut off or squashed.
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), 1600)
    return () => clearTimeout(t)
  }, [])
  // Small heads sit a little inside their box, so a glance or a breath never reaches its edge.
  const inner = size <= 32 ? size - 4 : size
  const fallback = <span className={cx("block shrink-0 rounded-full bg-accent", className)} style={{ width: size, height: size }} aria-hidden />
  return (
    <Suspense fallback={fallback}>
      <span className={cx("inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }}>
        <RobotHead
          size={inner}
          state={live ? (mood?.state ?? "idle") : mood?.state === "sleeping" ? "sleeping" : "idle"}
          paused={(!live && settled) || !!mood?.paused}
          interactive={interactive}
          antenna={size > 40}
          floorShadow={size > 64}
          color={tones.shell}
          screenColor={tones.screen}
          trimColor={tones.trim}
          seed={seed}
          className="shrink-0"
          role="img"
          aria-label={label ?? `Coordinator, ${mood?.state ?? "idle"}`}
        />
      </span>
    </Suspense>
  )
}

/**
 * The coordinator as a contact: its head inside a round avatar, on a soft blue field. At the sizes a
 * face is in a list, a bubble's foot or a header, a head on its own reads as a blob; in a circle it
 * reads as someone. Still unless `live`.
 */
export function CoordinatorAvatar({ size, mood, live = false, seed, className, label }: { size: number; mood?: Mood; live?: boolean; seed?: number; className?: string; label?: string }) {
  return (
    <span
      className={cx("relative inline-flex shrink-0 items-end justify-center overflow-hidden rounded-full bg-[linear-gradient(180deg,var(--head-bg-top),var(--head-bg-bottom))]", className)}
      style={{ width: size, height: size }}
    >
      <CoordinatorHead size={Math.round(size * 0.86)} mood={mood} live={live} seed={seed} label={label} className="translate-y-[6%]" />
    </span>
  )
}
