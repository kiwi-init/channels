import { useId } from "react"
import { LOGOS } from "~/kit/icons"
import type { Harness } from "~/model"

export type Face = "lead" | "builder" | "reviewer" | "bug-hunter" | "explorer" | "releaser" | "default"

const FACES: Record<Face, { body: string; ink?: string }> = {
  lead: {
    body: "M12.051 5.891A1.6 1.6 0 0 1 14.949 5.891L16.358 8.898A0.6 0.6 0 0 0 16.832 9.239L19.9 9.6A1.574 1.574 0 0 1 20.783 12.32L18.449 14.471A0.6 0.6 0 0 0 18.267 15.031L18.901 18.154A1.591 1.591 0 0 1 16.55 19.85L13.799 18.271A0.6 0.6 0 0 0 13.201 18.271L10.45 19.85A1.591 1.591 0 0 1 8.099 18.154L8.733 15.031A0.6 0.6 0 0 0 8.551 14.471L6.217 12.32A1.574 1.574 0 0 1 7.1 9.6L10.168 9.239A0.6 0.6 0 0 0 10.642 8.898ZM11.35 13.2a1.25 1.25 0 1 0 2.5 0a1.25 1.25 0 1 0 -2.5 0ZM15.15 13.2a1.25 1.25 0 1 0 2.5 0a1.25 1.25 0 1 0 -2.5 0Z",
  },
  builder: {
    body: "M3 8.6A4.6 4.6 0 0 1 7.6 4L17.4 4A4.6 4.6 0 0 1 22 8.6L22 17.9A4.6 4.6 0 0 1 17.4 22.5L7.6 22.5A4.6 4.6 0 0 1 3 17.9ZM10.6 12.8A1.2 1.2 0 0 1 11.8 11.6L12.6 11.6A1.2 1.2 0 0 1 13.8 12.8L13.8 12.9A1.2 1.2 0 0 1 12.6 14.1L11.8 14.1A1.2 1.2 0 0 1 10.6 12.9ZM15.6 12.8A1.2 1.2 0 0 1 16.8 11.6L17.6 11.6A1.2 1.2 0 0 1 18.8 12.8L18.8 12.9A1.2 1.2 0 0 1 17.6 14.1L16.8 14.1A1.2 1.2 0 0 1 15.6 12.9Z",
  },
  reviewer: {
    body: "M11.196 3.414A2.8 2.8 0 0 1 14.004 3.414L20.004 6.891A2.8 2.8 0 0 1 21.4 9.314L21.4 16.686A2.8 2.8 0 0 1 20.004 19.109L14.004 22.586A2.8 2.8 0 0 1 11.196 22.586L5.196 19.109A2.8 2.8 0 0 1 3.8 16.686L3.8 9.314A2.8 2.8 0 0 1 5.196 6.891ZM8.6 12.8a2.3 2.3 0 1 0 4.6 0a2.3 2.3 0 1 0 -4.6 0ZM14.4 12.8a2.3 2.3 0 1 0 4.6 0a2.3 2.3 0 1 0 -4.6 0Z",
    ink: "M10.5 13.6a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0 -2.2 0ZM16.3 13.6a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0 -2.2 0Z",
  },
  "bug-hunter": {
    body: "M9.612 8.082A3.6 3.6 0 0 1 15.988 8.082L20.836 17.328A3.6 3.6 0 0 1 17.648 22.6L7.952 22.6A3.6 3.6 0 0 1 4.764 17.328ZM12.176 15.907A0.725 0.725 0 0 0 11.632 14.563L9.824 15.293A0.725 0.725 0 0 0 10.368 16.637ZM16.432 16.637A0.725 0.725 0 0 0 16.976 15.293L15.168 14.563A0.725 0.725 0 0 0 14.624 15.907Z",
  },
  explorer: {
    body: "M10.172 4.428A4 4 0 0 1 15.828 4.428L21.372 9.972A4 4 0 0 1 21.372 15.628L15.828 21.172A4 4 0 0 1 10.172 21.172L4.628 15.628A4 4 0 0 1 4.628 9.972ZM13.4 12.4a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0 -2.8 0ZM17.6 12.4a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0 -2.8 0Z",
  },
  releaser: {
    body: "M12.8 1.0C16.8 3.6 18.6 8.4 18.6 13.2L18.6 17.4L21.9 20.5C22.4 21.0 22.1 21.9 21.4 21.9L4.2 21.9C3.5 21.9 3.2 21.0 3.7 20.5L7.0 17.4L7.0 13.2C7.0 8.4 8.8 3.6 12.8 1.0ZM11.696 10.542A0.675 0.675 0 0 0 10.504 9.908L10.104 10.658A0.675 0.675 0 0 0 11.296 11.292ZM15.396 10.542A0.675 0.675 0 0 0 14.204 9.908L13.804 10.658A0.675 0.675 0 0 0 14.996 11.292Z",
  },
  default: {
    body: "M5.4 10.5A7.3 7.3 0 0 1 12.7 3.2L12.7 3.2A7.3 7.3 0 0 1 20 10.5L20 15.5A7.3 7.3 0 0 1 12.7 22.8L12.7 22.8A7.3 7.3 0 0 1 5.4 15.5ZM9.25 12.2a1.35 1.35 0 1 0 2.7 0a1.35 1.35 0 1 0 -2.7 0ZM14.05 12.2a1.35 1.35 0 1 0 2.7 0a1.35 1.35 0 1 0 -2.7 0Z",
  },
}

const FIT = "translate(0.6 0.4) scale(0.97)"
const BADGE = 8.4
const GAP = 1.25

export const faceOf = (role: string | undefined): Face => (role && Object.hasOwn(FACES, role) ? (role as Face) : "default")

const inner = (transform: string | undefined): number => Number(/scale\(([\d.]+)\)/.exec(transform ?? "")?.[1] ?? 1)

export function RoleFace({ role, harness }: { role?: string | undefined; harness?: Harness | undefined }) {
  const id = useId()
  const shape = FACES[faceOf(role)]
  const logo = harness ? LOGOS[harness] : undefined
  const scale = BADGE / 24
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {logo && (
        <defs>
          <mask id={id} maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28">
            <rect x="-2" y="-2" width="28" height="28" fill="#fff" />
            <g transform={`scale(${scale})`}>
              {logo.map((p, i) => (
                <path key={i} d={p.d} transform={p.transform} fill="#000" stroke="#000" strokeWidth={(2 * GAP) / scale / inner(p.transform)} strokeLinejoin="round" />
              ))}
            </g>
          </mask>
        </defs>
      )}
      <g className="face-body" mask={logo ? `url(#${CSS.escape(id)})` : undefined} transform={FIT}>
        <path d={shape.body} fillRule="evenodd" />
        {shape.ink && <path d={shape.ink} />}
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
