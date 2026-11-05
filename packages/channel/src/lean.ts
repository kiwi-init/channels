import { omit } from "@kiwi/core/omit.ts";
import type { Message } from "@kiwi/core/protocol.ts";

export const BODY_KEEP = 600;

const KEPT_OPS: ReadonlySet<string> = new Set(["task.add", "task.claim", "task.update", "ask.close"]);
const TOKENS = /(?:^|[^\p{L}\p{N}_.-])(@[\p{L}\p{N}_.-]+)|\b(T\d+)\b/gu;

const keepsBody = (m: Message): boolean => m.kind === "ask" || m.kind === "blocking" || !!m.permission || !!m.step || !!m.choices;

export function clipped(body: string): string {
  if (body.length <= BODY_KEEP) return body;
  const tokens = [...body.slice(BODY_KEEP).matchAll(TOKENS)].flatMap((t) => t[1] ?? t[2] ?? []);
  return [body.slice(0, BODY_KEEP), ...tokens, ""].join("\n");
}

export function leanOf(m: Message): Message | null {
  if (m.kind === "event" && !(m.ev && KEPT_OPS.has(m.ev.op))) return null;
  const rest = omit(m, "imgs", "files", "sig", "newer", "opened", "sealed");
  return keepsBody(m) ? rest : { ...rest, body: clipped(m.body) };
}

export function leanTail(older: readonly Message[], more: readonly Message[], keep: number): Message[] {
  const lean = more.flatMap((m) => leanOf(m) ?? []);
  const next = older.length ? [...older, ...lean] : lean;
  return next.length > keep ? next.slice(next.length - keep) : next;
}
