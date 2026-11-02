import { inlineRuns } from "~/specs/read"

export function Inline({ text }: { text: string }) {
  return <>{inlineRuns(text).map((r, i) => (r.kind === "code" ? <code key={i}>{r.text}</code> : r.kind === "bold" ? <strong key={i}>{r.text}</strong> : <span key={i}>{r.text}</span>))}</>
}
