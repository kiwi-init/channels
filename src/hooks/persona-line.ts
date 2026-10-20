import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { personaLines, type Persona } from "@kiwi/core/personality.ts";
import { home } from "../config.ts";

export function personaMark(p: Persona | undefined): string {
  if (!p) return "none";
  return createHash("sha256")
    .update(JSON.stringify([p.name, p.role, p.capabilities, p.areas, p.instructions]))
    .digest("hex")
    .slice(0, 32);
}

function toldFile(alias: string, as: string, session: string): string {
  return join(home(), "hook-state", `${encodeURIComponent(alias)}.${encodeURIComponent(as)}.${encodeURIComponent(session)}.persona`);
}

export function personaTold(alias: string, as: string, session: string): string | null {
  try {
    return readFileSync(toldFile(alias, as, session), "utf8").trim() || null;
  } catch {
    // This session was never told a personality by the hook: one it has now is told once.
    return null;
  }
}

export function notePersonaTold(alias: string, as: string, session: string, mark: string): void {
  try {
    mkdirSync(join(home(), "hook-state"), { recursive: true, mode: 0o700 });
    writeFileSync(toldFile(alias, as, session), mark);
  } catch {
    // Without the mark the change is told once more at the next hook: a repeat, never a loop.
  }
}

export function personaChange(told: string | null, now: Persona | undefined, mc: string, max: number): string | null {
  if (told === personaMark(now) || (told === null && !now)) return null;
  const text = now ? ["The owner changed your personality:", ...personaLines(now, true)].join("\n") : "The owner took your personality away: its role and instructions no longer apply.";
  if (text.length <= max) return text;
  const tail = `(\`${mc} prompt\` has all of it)`;
  const room = max - tail.length - 3;
  return room > 0 ? `${text.slice(0, room)} …\n${tail}` : null;
}
