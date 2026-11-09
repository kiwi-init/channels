import type { PermissionShown } from "@kiwi/core/permission.ts";

const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

export type PermissionWant =
  | { kind: "mcp"; server: string; tool: string }
  | { kind: "command" }
  | { kind: "write" }
  | { kind: "edit"; files: boolean }
  | { kind: "fetch" }
  | { kind: "tool"; tool: string };

export function permissionWant(p: PermissionShown): PermissionWant {
  if (p.mcp) return { kind: "mcp", server: p.mcp.server, tool: p.mcp.tool };
  if (p.tool === "Bash") return { kind: "command" };
  if (p.tool === "Write") return { kind: "write" };
  if (EDITS.has(p.tool)) return { kind: "edit", files: (p.paths?.length ?? 0) > 1 };
  if (p.tool === "WebFetch") return { kind: "fetch" };
  return { kind: "tool", tool: p.tool };
}

export function permissionTitle(p: PermissionShown): string {
  const want = permissionWant(p);
  switch (want.kind) {
    case "mcp":
      return `wants to use ${want.server} · ${want.tool}`;
    case "command":
      return "wants to run a command";
    case "write":
      return "wants to write a file";
    case "edit":
      return want.files ? "wants to edit files" : "wants to edit a file";
    case "fetch":
      return "wants to fetch a page";
    case "tool":
      return `wants to use ${want.tool}`;
  }
}

const HIDDEN = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

export function visibleText(text: string): string {
  return text.replace(HIDDEN, (c) => `\\u{${c.codePointAt(0)!.toString(16).padStart(4, "0")}}`);
}

export function permissionCode(p: PermissionShown): string {
  if (p.mcp) {
    const { server, tool, args, values } = p.mcp;
    return visibleText(`${server}.${tool}(${args.map((a, i) => (values?.[i] !== undefined ? `${a}: ${values[i]}` : a)).join(", ")})`);
  }
  if (p.command !== undefined) return visibleText(p.command);
  if (p.paths?.length) return p.paths.map(visibleText).join("\n");
  if (p.url) return visibleText(p.url);
  return visibleText(p.tool);
}

export type PermissionNote = "sandbox" | "background" | "replace-all" | "too-long";

const NOTES: Record<PermissionNote, string> = {
  sandbox: "It asks to run outside the sandbox: allow that in the terminal.",
  background: "It runs in the background.",
  "replace-all": "It replaces every occurrence in the file.",
  "too-long": "Too long to show all of it here: to allow it, answer in the terminal.",
};

export function permissionNoteKinds(p: PermissionShown): PermissionNote[] {
  return [
    ...(p.sandbox === "off" ? (["sandbox"] as const) : []),
    ...(p.background ? (["background"] as const) : []),
    ...(p.replaceAll ? (["replace-all"] as const) : []),
    ...(!p.canAllow && p.sandbox !== "off" ? (["too-long"] as const) : []),
  ];
}

export const permissionNotes = (p: PermissionShown): string[] => permissionNoteKinds(p).map((n) => NOTES[n]);
