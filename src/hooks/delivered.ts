import * as Effect from "effect/Effect";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentSession } from "../agent.ts";
import { Cursor, home } from "../config.ts";

function deliveredFile(alias: string, as: string, session: string): string {
  return join(home(), "listen-hooks", `${encodeURIComponent(alias)}.${encodeURIComponent(as)}.${encodeURIComponent(session)}.delivered`);
}

export function deliveredUpTo(alias: string, as: string, session: string): number {
  try {
    return Number(readFileSync(deliveredFile(alias, as, session), "utf8")) || 0;
  } catch {
    return 0;
  }
}

export function noteDelivered(alias: string, as: string, session: string, seq: number): void {
  mkdirSync(join(home(), "listen-hooks"), { recursive: true, mode: 0o700 });
  writeFileSync(deliveredFile(alias, as, session), String(Math.max(seq, deliveredUpTo(alias, as, session))));
}

export const commitDelivered = Effect.fn("Hooks.commitDelivered")(function* (s: AgentSession, session: string) {
  const upTo = deliveredUpTo(s.alias, s.me, session);
  if (!upTo) return;
  const cursor = yield* Cursor;
  if (((yield* cursor.read(s.alias, s.me)) ?? 0) < upTo) yield* cursor.write(s.alias, s.me, upTo);
  rmSync(deliveredFile(s.alias, s.me, session), { force: true });
  yield* s.markRead(upTo);
});
