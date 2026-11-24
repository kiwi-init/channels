import { useEffect, useId, useState } from "react"
import { CHARACTERS, type Face } from "~/kit/characters"
import { ART, LOGOS } from "~/kit/logos"
import type { Mood } from "~/kit/mood"
import type { Harness } from "~/model"

export type { Face } from "~/kit/characters"

const BADGE = 35
const GAP = 5.2

export const faceOf = (role: string | undefined): Face => (role && Object.hasOwn(CHARACTERS, role) ? (role as Face) : "default")

const inner = (transform: string | undefined): number => Number(/scale\(([\d.]+)\)/.exec(transform ?? "")?.[1] ?? 1)

type EyeShape = "dot" | "bar" | "shut" | "joy" | "chev"

const SHOWN: Readonly<Record<Mood, EyeShape | null>> = {
  free: "dot",
  thinking: "dot",
  waiting: "dot",
  tool: "bar",
  overloaded: "chev",
  offline: "shut",
  done: "joy",
  error: null,
}

interface Entering {
  shape: EyeShape | null
  mark: Mood | null
}

const MARKED: ReadonlySet<Mood> = new Set(["error", "waiting", "done"])

const shapesOf = (seen: ReadonlySet<Mood>): ReadonlySet<EyeShape> => new Set([...seen].flatMap((m) => SHOWN[m] ?? []))

function useSeen(mood: Mood): { seen: ReadonlySet<Mood>; entering: Entering | null } {
  const [seen, setSeen] = useState<ReadonlySet<Mood>>(() => new Set([mood]))
  const [entering, setEntering] = useState<Entering | null>(null)
  if (!seen.has(mood)) {
    const shape = SHOWN[mood]
    setSeen(new Set([...seen, mood]))
    setEntering({ shape: shape && !shapesOf(seen).has(shape) ? shape : null, mark: MARKED.has(mood) ? mood : null })
  }
  useEffect(() => {
    if (!entering) return
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setEntering(null))
    })
    return () => cancelAnimationFrame(frame)
  }, [entering])
  return { seen, entering }
}

function Eye({ x, side, shapes, entering }: { x: number; side: -1 | 1; shapes: ReadonlySet<EyeShape>; entering: EyeShape | null }) {
  const named = (shape: EyeShape, kind: string) => `eye ${kind}eye-${shape}${shape === entering ? " eye-enter" : ""}`
  return (
    <g transform={`translate(${x} 0)`}>
      {shapes.has("dot") && <ellipse className={named("dot", "")} rx={4.3} ry={5.3} />}
      {shapes.has("bar") && <rect className={named("bar", "")} x={-5} y={-1.8} width={10} height={3.6} rx={1.8} />}
      {shapes.has("shut") && <path className={named("shut", "eye-line ")} d="M-4.8 -1Q0 3.8 4.8 -1" />}
      {shapes.has("joy") && <path className={named("joy", "eye-line ")} d="M-4.8 2.2Q0 -4.4 4.8 2.2" />}
      {shapes.has("chev") && <path className={named("chev", "eye-line ")} d={side < 0 ? "M-3 -3.8L3.4 0L-3 3.8" : "M3 -3.8L-3.4 0L3 3.8"} />}
    </g>
  )
}

export function RoleFace({ role, harness, mood = "free" }: { role?: string | undefined; harness?: Harness | undefined; mood?: Mood }) {
  const id = useId()
  const { seen, entering } = useSeen(mood)
  const shapes = shapesOf(seen)
  const enteringShape = entering?.shape ?? null
  const mark = (on: Mood, name: string) => `${name}${on === entering?.mark ? " face-enter" : ""}`
  const c = CHARACTERS[faceOf(role)]
  const logo = harness ? LOGOS[harness] : undefined
  const art = harness ? ART[harness] : undefined
  const scale = BADGE / 24
  const half = c.eyes.spacing / 2 / c.eyes.scale
  const eyes = `translate(${c.eyes.x} ${c.eyes.y}) scale(${c.eyes.scale})`
  return (
    <svg className="face" viewBox="0 0 100 100" data-mood={mood} data-character={c.id} aria-hidden="true">
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x="-10" y="-10" width="120" height="120">
          <rect x="-10" y="-10" width="120" height="120" fill="#fff" />
          <g transform={eyes}>
            <g className="face-look">
              <Eye x={-half} side={-1} shapes={shapes} entering={enteringShape} />
              <Eye x={half} side={1} shapes={shapes} entering={enteringShape} />
            </g>
          </g>
          {logo && (
            <g transform={`scale(${scale})`}>
              {logo.map((p, i) => (
                <path key={i} d={p.d} transform={p.transform} fill="#000" stroke="#000" strokeWidth={(2 * GAP) / scale / inner(p.transform)} strokeLinejoin="round" />
              ))}
            </g>
          )}
        </mask>
      </defs>
      <g className="face-rig">
        <path className="face-body" d={c.body} mask={`url(#${CSS.escape(id)})`} />
        {seen.has("error") && <path className={mark("error", "face-cross")} transform={eyes} d={`M${-half - 3.6} -3.6l7.2 7.2m0 -7.2l-7.2 7.2M${half - 3.6} -3.6l7.2 7.2m0 -7.2l-7.2 7.2`} />}
        {seen.has("waiting") && <path className={mark("waiting", "face-ask")} d="M89.8 5h4.4l-1 11h-2.4zM92 18a2.6 2.6 0 1 1 0 5.2a2.6 2.6 0 1 1 0-5.2z" />}
        {seen.has("done") && <path className={mark("done", "face-spark")} d="M90 3l2.3 6.7L99 12l-6.7 2.3L90 21l-2.3-6.7L81 12l6.7-2.3z" />}
      </g>
      {logo && (
        <g className="face-badge" data-harness={harness} transform={`scale(${scale})`}>
          {art ? <image {...art} /> : logo.map((p, i) => <path key={i} d={p.d} transform={p.transform} fillRule={p.rule} opacity={p.opacity} />)}
        </g>
      )}
    </svg>
  )
}
