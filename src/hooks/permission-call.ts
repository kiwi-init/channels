import { closeSync, openSync, readSync, statSync } from "node:fs";

const LOOK_BACK_BYTES = 1024 * 1024;
const READ_MAX_BYTES = 4 * 1024 * 1024;

export type Settled = { kind: "result"; error: boolean; text: string } | { kind: "moved-on" };

interface Block {
  type?: unknown;
  id?: unknown;
  name?: unknown;
  input?: unknown;
  tool_use_id?: unknown;
  is_error?: unknown;
  content?: unknown;
}

interface Entry {
  type: string;
  message: string | undefined;
  said: boolean;
  blocks: Block[];
}

function entryOf(line: string): Entry | null {
  if (!line.trim()) return null;
  try {
    const v = JSON.parse(line) as { type?: unknown; isMeta?: unknown; message?: { id?: unknown; content?: unknown } };
    if ((v.type !== "user" && v.type !== "assistant") || v.isMeta === true) return null;
    const content = v.message?.content;
    const blocks = Array.isArray(content) ? content.filter((b): b is Block => !!b && typeof b === "object") : [];
    return {
      type: v.type,
      message: typeof v.message?.id === "string" ? v.message.id : undefined,
      said: typeof content === "string" || blocks.some((b) => b.type === "text"),
      blocks,
    };
  } catch {
    // A line cut where the read began, or still being written: a later read has it whole.
    return null;
  }
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((c) => (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string" ? (c as { text: string }).text : "")).join("");
}

function wholeLines(file: string, from: number, to: number): { lines: string[]; next: number } {
  const len = Math.max(0, Math.min(to - from, READ_MAX_BYTES));
  if (!len) return { lines: [], next: from };
  const buf = Buffer.alloc(len);
  const fd = openSync(file, "r");
  try {
    readSync(fd, buf, 0, len, from);
  } finally {
    closeSync(fd);
  }
  const end = buf.lastIndexOf(0x0a) + 1;
  if (!end) return { lines: [], next: len === READ_MAX_BYTES ? from + len : from };
  return { lines: buf.subarray(0, end).toString("utf8").split("\n"), next: from + end };
}

export interface PendingCall {
  id: string;
  message: string | undefined;
  offset: number;
}

export function pendingCall(file: string, tool: string, input: unknown): PendingCall | null {
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    // No transcript to read: the call can't be told apart from another, so it stays in the terminal.
    return null;
  }
  const { lines, next } = wholeLines(file, Math.max(0, size - LOOK_BACK_BYTES), size);
  const want = canonical(input);
  const open: { id: string; message: string | undefined }[] = [];
  for (const line of lines) {
    const e = entryOf(line);
    if (!e) continue;
    if (e.type === "user" && e.said) open.length = 0;
    for (const b of e.blocks) {
      if (b.type === "tool_use" && typeof b.id === "string" && b.name === tool && canonical(b.input) === want) open.push({ id: b.id, message: e.message });
      if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
        const at = open.findIndex((o) => o.id === b.tool_use_id);
        if (at >= 0) open.splice(at, 1);
      }
    }
  }
  const last = open.at(-1);
  return last ? { ...last, offset: next } : null;
}

export function watchCall(file: string, call: PendingCall): () => Settled | null {
  let offset = call.offset;
  let found: Settled | null = null;
  return () => {
    if (found) return found;
    let size: number;
    try {
      size = statSync(file).size;
    } catch {
      // The transcript went away: nothing settled that we can see.
      return null;
    }
    if (size <= offset) return null;
    const { lines, next } = wholeLines(file, offset, size);
    offset = next;
    for (const line of lines) {
      const e = entryOf(line);
      if (!e) continue;
      const result = e.blocks.find((b) => b.type === "tool_result" && b.tool_use_id === call.id);
      if (result) found = { kind: "result", error: result.is_error === true, text: textOf(result.content) };
      else if ((e.type === "user" && e.said) || (e.type === "assistant" && e.message !== call.message)) found = { kind: "moved-on" };
      if (found) return found;
    }
    return null;
  };
}
