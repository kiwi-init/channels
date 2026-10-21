export interface PermissionLike {
  tool: string
  command?: string
  description?: string
  paths?: string[]
  url?: string
  mcp?: { server: string; tool: string; args: string[] }
  cwd: string
}

export const ALLOW_ONCE = "A: Allow once"
export const DENY = "B: Deny"

const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"])

export function permissionTitle(p: PermissionLike): string {
  if (p.mcp) return `wants to use ${p.mcp.server} · ${p.mcp.tool}`
  if (p.tool === "Bash") return "wants to run a command"
  if (EDITS.has(p.tool)) return (p.paths?.length ?? 0) > 1 ? "wants to edit files" : "wants to edit a file"
  if (p.tool === "WebFetch") return "wants to fetch a page"
  return `wants to use ${p.tool}`
}

const HIDDEN = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g

export function visibleText(text: string): string {
  return text.replace(HIDDEN, (c) => `\\u{${c.codePointAt(0)!.toString(16).padStart(4, "0")}}`)
}

export function permissionShown(p: PermissionLike): string {
  if (p.mcp) return visibleText(`${p.mcp.server}.${p.mcp.tool}(${p.mcp.args.join(", ")})`)
  if (p.command !== undefined) return visibleText(p.command)
  if (p.paths?.length) return p.paths.map(visibleText).join("\n")
  if (p.url) return visibleText(p.url)
  return visibleText(p.tool)
}

export type Settled = { kind: "allowed" | "denied"; by: string; at: number } | { kind: "terminal" | "timeout" | "ended"; at: number }

export interface ReplyLike {
  seq: number
  from: string
  body: string
  ts: number
  settled?: string
}

const HOOK_SETTLED = new Set(["terminal", "timeout", "ended"])

export function settledOf(ask: { from: string }, replies: readonly ReplyLike[], mayAnswer: (name: string) => boolean): Settled | null {
  for (const r of [...replies].sort((a, b) => a.seq - b.seq)) {
    if (r.from === ask.from && r.settled && HOOK_SETTLED.has(r.settled)) return { kind: r.settled as "terminal" | "timeout" | "ended", at: r.ts }
    if (r.from !== ask.from && mayAnswer(r.from) && (r.body === ALLOW_ONCE || r.body === DENY)) return { kind: r.body === ALLOW_ONCE ? "allowed" : "denied", by: r.from, at: r.ts }
  }
  return null
}

const text = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.length <= max ? v : undefined)

export function permissionOf(m: object): PermissionLike | null {
  const raw = (m as { permission?: unknown }).permission
  if (!raw || typeof raw !== "object") return null
  const x = raw as Record<string, unknown>
  const tool = text(x["tool"], 200)
  const cwd = text(x["cwd"], 4096)
  if (!tool || cwd === undefined) return null
  const paths = Array.isArray(x["paths"]) ? x["paths"].filter((p): p is string => typeof p === "string").slice(0, 50) : undefined
  const mcpRaw = x["mcp"] && typeof x["mcp"] === "object" ? (x["mcp"] as Record<string, unknown>) : null
  const mcp =
    mcpRaw && typeof mcpRaw["server"] === "string" && typeof mcpRaw["tool"] === "string" && Array.isArray(mcpRaw["args"])
      ? { server: mcpRaw["server"], tool: mcpRaw["tool"], args: mcpRaw["args"].filter((a): a is string => typeof a === "string") }
      : undefined
  const command = text(x["command"], 4000)
  const description = text(x["description"], 1000)
  const url = text(x["url"], 4000)
  return { tool, cwd, ...(command !== undefined ? { command } : {}), ...(description ? { description } : {}), ...(paths?.length ? { paths } : {}), ...(url ? { url } : {}), ...(mcp ? { mcp } : {}) }
}
