import { cleanBody, describeEvent } from "@kiwi/core/format.ts"
import { inlineText } from "@kiwi/core/membership.ts"
import { asSent, type Message } from "@kiwi/core/protocol.ts"
import type { ChannelState, FoldBase } from "@kiwi/core/state.ts"

export interface LogExport {
  text: string
  messages: readonly Message[]
  missing: number[]
  dropped: number
}

export interface Exported {
  log: LogExport
  state: ChannelState
}

export type ExportKind = "log" | "transcript"

export async function checkedState(
  history: { messages: readonly Message[]; first: number | null },
  foldFrom: (messages: Message[], base: FoldBase | null) => ChannelState,
  snapshot: () => Promise<FoldBase | null>,
  app: ChannelState
): Promise<ChannelState> {
  const first = history.first ?? history.messages[0]?.seq ?? 1
  if (first <= 1) return foldFrom([...history.messages], null)
  const base = await snapshot()
  if (base && base.n >= first - 1)
    return foldFrom(
      history.messages.filter((m) => m.seq > base.n),
      base
    )
  return app
}

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

const inert = (s: string): string => s.replace(/[\\&<[\]!]/g, (c) => `\\${c}`)

const quoted = (text: string): string =>
  inert(cleanBody(text))
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n")

const plain = (s: string, max: number): string => inlineText(s, max).replace(/[[\]()<>`*_&\\]/g, "")

const leftOut = (n: number): string =>
  n ? `${n === 1 ? "1 message is" : `${n} messages are`} left out, as the app leaves them out: forged, or against what the owner allows (the signed log still has them, each with its signature).` : ""

const unchecked = (n: number): string =>
  n
    ? `${n === 1 ? "1 older message is" : `${n} older messages are`} left out because this app can't check them any more: the relay no longer holds what came before them (the signed log still has them, each with its signature).`
    : ""

export function transcript({ title, log, state, nameOf, at }: { title: string | undefined; log: LogExport; state: ChannelState; nameOf: (from: string) => string; at: Date }): string {
  const shown = log.messages.filter((m) => state.trust.get(m.seq) === "verified")
  const notChecked = log.messages.filter((m) => !state.trust.has(m.seq)).length
  const gaps = [
    log.missing.length ? `${unread(log.missing).replace(/^./, (c) => c.toUpperCase())}.` : "",
    dropped(log.dropped),
    leftOut(log.messages.length - shown.length - notChecked),
    unchecked(notChecked),
  ].filter(Boolean)
  const head = [
    `# ${inert(inlineText(title, 80)) || "Channel"}`,
    [
      `Downloaded ${localStamp(at)} (${utcOffset(at)}): ${shown.length === 1 ? "1 message" : `${shown.length} messages`}, each with its number, the date and time it was sent here, and who sent it, then what it says, quoted.`,
      ...gaps,
    ].join(" "),
  ]
  const entries = shown.map((m) => {
    const kind = m.kind && m.kind !== "msg" ? ` (${plain(m.kind, 20)})` : ""
    const said = m.kind === "event" ? describeEvent(m, state) : (m.body ?? "")
    const images = (m.imgs ?? []).map((i) => `> [image: ${plain(i.name, 80)}]`)
    const text = [said ? quoted(said) : "", ...images].filter(Boolean).join("\n>\n")
    return `**#${m.seq} · ${localStamp(new Date(m.ts))} · ${plain(nameOf(m.from), 60)}**${kind}\n\n${text || "_(no text)_"}`
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
