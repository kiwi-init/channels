import type { Message } from "@kiwi/core/protocol.ts"

export interface LogExport {
  text: string
  missing: number[]
  dropped: number
}

export function logLines(messages: readonly Message[]): string {
  return messages.map((m) => `${JSON.stringify(m)}\n`).join("")
}

export function logExport({ head, messages, first }: { head: number; messages: readonly Message[]; first: number | null }): LogExport {
  const kept = new Set(messages.map((m) => m.seq))
  const from = first ?? head + 1
  const missing: number[] = []
  for (let seq = from; seq <= head; seq++) if (!kept.has(seq)) missing.push(seq)
  return { text: logLines(messages), missing, dropped: Math.max(0, Math.min(from, head + 1) - 1) }
}

export function exportNote({ missing, dropped }: Pick<LogExport, "missing" | "dropped">): { text: string; complete: boolean } {
  const older = dropped ? ` The relay had already dropped the oldest ${dropped === 1 ? "message" : `${dropped} messages`} to stay under its storage cap.` : ""
  if (!missing.length) return { text: `Log downloaded.${older}`, complete: true }
  const listed = missing
    .slice(0, 5)
    .map((s) => `#${s}`)
    .join(", ")
  const more = missing.length > 5 ? ` and ${missing.length - 5} more` : ""
  return {
    text: `Downloaded, but ${missing.length === 1 ? "1 message" : `${missing.length} messages`} this app couldn’t read ${missing.length === 1 ? "is" : "are"} missing (${listed}${more}). Update the app and download again before closing.${older}`,
    complete: false,
  }
}

export function logFileName(title: string | undefined, at: Date): string {
  const slug =
    (title ?? "")
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "-")
      .slice(0, 60)
      .replace(/-+$/, "") || "channel"
  return `${slug}-log-${at.toISOString().slice(0, 10)}.jsonl`
}
