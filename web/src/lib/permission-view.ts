import type { PermissionShown } from "@kiwi/core/permission.ts"

const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"])

export function permissionTitle(p: PermissionShown): string {
  if (p.mcp) return `wants to use ${p.mcp.server} · ${p.mcp.tool}`
  if (p.tool === "Bash") return "wants to run a command"
  if (p.tool === "Write") return "wants to write a file"
  if (EDITS.has(p.tool)) return (p.paths?.length ?? 0) > 1 ? "wants to edit files" : "wants to edit a file"
  if (p.tool === "WebFetch") return "wants to fetch a page"
  return `wants to use ${p.tool}`
}

const HIDDEN = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g

export function visibleText(text: string): string {
  return text.replace(HIDDEN, (c) => `\\u{${c.codePointAt(0)!.toString(16).padStart(4, "0")}}`)
}

export function permissionCode(p: PermissionShown): string {
  if (p.mcp) {
    const { server, tool, args, values } = p.mcp
    return visibleText(`${server}.${tool}(${args.map((a, i) => (values?.[i] !== undefined ? `${a}: ${values[i]}` : a)).join(", ")})`)
  }
  if (p.command !== undefined) return visibleText(p.command)
  if (p.paths?.length) return p.paths.map(visibleText).join("\n")
  if (p.url) return visibleText(p.url)
  return visibleText(p.tool)
}

export function permissionNotes(p: PermissionShown): string[] {
  return [
    ...(p.sandbox === "off" ? ["It asks to run outside the sandbox: allow that in the terminal."] : []),
    ...(p.background ? ["It runs in the background."] : []),
    ...(p.replaceAll ? ["It replaces every occurrence in the file."] : []),
    ...(!p.canAllow && p.sandbox !== "off" ? ["Too long to show all of it here: to allow it, answer in the terminal."] : []),
  ]
}
