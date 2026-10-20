import type { Message } from "@kiwi/core/protocol.ts"

export function logLines(messages: readonly Message[]): string {
  return messages.map((m) => `${JSON.stringify(m)}\n`).join("")
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
