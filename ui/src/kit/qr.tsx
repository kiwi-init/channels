import { encode } from "uqr"

const QUIET = 2

export default function QrCode({ text, label }: { text: string; label: string }) {
  const { data } = encode(text, { ecc: "M", border: 0 })
  const span = data.length + QUIET * 2
  const d = data.flatMap((row, y) => row.flatMap((on, x) => (on ? [`M${x + QUIET} ${y + QUIET}h1v1h-1z`] : []))).join("")
  return (
    <svg role="img" aria-label={label} className="qr" viewBox={`0 0 ${span} ${span}`} shapeRendering="crispEdges">
      <rect className="qr-paper" width={span} height={span} />
      <path className="qr-ink" d={d} />
    </svg>
  )
}
