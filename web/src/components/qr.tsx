import { encode } from "uqr"

const QUIET = 2

export function QrCode({ text, size = 176, label }: { text: string; size?: number; label: string }) {
  const { data } = encode(text, { ecc: "M", border: 0 })
  const n = data.length
  const span = n + QUIET * 2
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${span} ${span}`} shapeRendering="crispEdges" className="rounded-card">
      <rect width={span} height={span} fill="#ffffff" />
      {data.flatMap((row, y) => row.map((on, x) => (on ? <rect key={`${x}-${y}`} x={x + QUIET} y={y + QUIET} width={1} height={1} fill="#000000" /> : null)))}
    </svg>
  )
}
