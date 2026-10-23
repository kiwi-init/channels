import { asSent, type Message } from "@kiwi/core/protocol.ts"

export interface LogExport {
  text: string
  messages: readonly Message[]
  missing: number[]
  dropped: number
}

export type ExportKind = "log" | "transcript"

export function logLines(messages: readonly Message[]): string {
  return messages.map((m) => `${JSON.stringify(asSent(m))}\n`).join("")
}

export function logExport({ head, messages, first }: { head: number; messages: readonly Message[]; first: number | null }): LogExport {
  const kept = new Set(messages.map((m) => m.seq))
  const from = first ?? head + 1
  const missing: number[] = []
  for (let seq = from; seq <= head; seq++) if (!kept.has(seq)) missing.push(seq)
  return { text: logLines(messages), messages, missing, dropped: Math.max(0, Math.min(from, head + 1) - 1) }
}

const dropped = (n: number): string => (n ? `The relay had already dropped the oldest ${n === 1 ? "message" : `${n} messages`} to stay under its storage cap.` : "")

function unread(missing: readonly number[]): string {
  const listed = missing
    .slice(0, 5)
    .map((s) => `#${s}`)
    .join(", ")
  const more = missing.length > 5 ? ` and ${missing.length - 5} more` : ""
  return `${missing.length === 1 ? "1 message" : `${missing.length} messages`} this app couldn’t read ${missing.length === 1 ? "is" : "are"} missing (${listed}${more})`
}

export function exportNote(log: Pick<LogExport, "missing" | "dropped">): { text: string; complete: boolean } {
  const older = log.dropped ? ` ${dropped(log.dropped)}` : ""
  if (!log.missing.length) return { text: `Downloaded.${older}`, complete: true }
  return { text: `Downloaded, but ${unread(log.missing)}. Update the app and download again.${older}`, complete: false }
}

const pad = (n: number): string => String(n).padStart(2, "0")

export function localStamp(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

function utcOffset(at: Date): string {
  const minutes = -at.getTimezoneOffset()
  const sign = minutes < 0 ? "−" : "+"
  return `UTC${sign}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`
}

export function transcript({ title, log, nameOf, at }: { title: string | undefined; log: LogExport; nameOf: (from: string) => string; at: Date }): string {
  const gaps = [log.missing.length ? `${unread(log.missing).replace(/^./, (c) => c.toUpperCase())}.` : "", dropped(log.dropped)].filter(Boolean)
  const head = [
    `# ${title || "Channel"}`,
    [
      `Downloaded ${localStamp(at)} (${utcOffset(at)}): ${log.messages.length === 1 ? "1 message" : `${log.messages.length} messages`}, each with its number, the date and time it was sent here, and who sent it.`,
      ...gaps,
    ].join(" "),
  ]
  const entries = log.messages.map((m) => {
    const kind = m.kind && m.kind !== "msg" ? ` (${m.kind})` : ""
    const images = (m.imgs ?? []).map((i) => `[image: ${i.name}]`)
    const text = [m.body ?? "", ...images].filter(Boolean).join("\n\n")
    return `**#${m.seq} · ${localStamp(new Date(m.ts))} · ${nameOf(m.from)}**${kind}\n\n${text || "_(no text)_"}`
  })
  return `${[...head, ...entries].join("\n\n")}\n`
}

export function logFileName(title: string | undefined, at: Date, kind: ExportKind = "log"): string {
  const slug =
    (title ?? "")
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "-")
      .slice(0, 60)
      .replace(/-+$/, "") || "channel"
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`
  return `${slug}-${kind}-${stamp}.${kind === "log" ? "jsonl" : "md"}`
}
