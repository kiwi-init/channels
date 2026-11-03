import { useId } from "react"
import { CHARACTERS, type Face } from "~/kit/characters"
import { LOGOS } from "~/kit/logos"
import type { Mood } from "~/kit/mood"
import type { Harness } from "~/model"

export type { Face } from "~/kit/characters"

const BADGE = 35
const GAP = 5.2

export const faceOf = (role: string | undefined): Face => (role && Object.hasOwn(CHARACTERS, role) ? (role as Face) : "default")

const inner = (transform: string | undefined): number => Number(/scale\(([\d.]+)\)/.exec(transform ?? "")?.[1] ?? 1)

function Eye({ x, side }: { x: number; side: -1 | 1 }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <ellipse className="eye eye-dot" rx={4.3} ry={5.3} />
      <rect className="eye eye-bar" x={-5} y={-1.8} width={10} height={3.6} rx={1.8} />
      <path className="eye eye-line eye-shut" d="M-4.8 -1Q0 3.8 4.8 -1" />
      <path className="eye eye-line eye-joy" d="M-4.8 2.2Q0 -4.4 4.8 2.2" />
      <path className="eye eye-line eye-chev" d={side < 0 ? "M-3 -3.8L3.4 0L-3 3.8" : "M3 -3.8L-3.4 0L3 3.8"} />
    </g>
  )
}

export function RoleFace({ role, harness, mood = "free" }: { role?: string | undefined; harness?: Harness | undefined; mood?: Mood }) {
  const id = useId()
  const c = CHARACTERS[faceOf(role)]
  const logo = harness ? LOGOS[harness] : undefined
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
              <Eye x={-half} side={-1} />
              <Eye x={half} side={1} />
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
        <path className="face-cross" transform={eyes} d={`M${-half - 3.6} -3.6l7.2 7.2m0 -7.2l-7.2 7.2M${half - 3.6} -3.6l7.2 7.2m0 -7.2l-7.2 7.2`} />
        <path className="face-ask" d="M89.8 5h4.4l-1 11h-2.4zM92 18a2.6 2.6 0 1 1 0 5.2a2.6 2.6 0 1 1 0-5.2z" />
        <path className="face-spark" d="M90 3l2.3 6.7L99 12l-6.7 2.3L90 21l-2.3-6.7L81 12l6.7-2.3z" />
      </g>
      {logo && (
        <g className="face-badge" data-harness={harness} transform={`scale(${scale})`}>
          {logo.map((p, i) => (
            <path key={i} d={p.d} transform={p.transform} fillRule={p.rule} opacity={p.opacity} />
          ))}
        </g>
      )}
    </svg>
  )
}
