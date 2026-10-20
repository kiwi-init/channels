import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONTEXT_LINE, type ContextUse } from "@kiwi/core/protocol.ts";
import { taskId, type ChannelState } from "@kiwi/core/state.ts";
import { tokensWord } from "@kiwi/core/format.ts";
import { home } from "../config.ts";
import { COMMANDS } from "../brief.ts";

const NUDGE_IDS = 8;

export interface Crossing {
  nudge: boolean;
  over: boolean;
}

export function crossing(used: number | undefined, over: boolean): Crossing {
  if (used === undefined) return { nudge: false, over };
  if (used < CONTEXT_LINE) return { nudge: false, over: false };
  return { nudge: !over, over: true };
}

function overFile(alias: string, as: string, session: string): string {
  return join(home(), "hook-state", `${encodeURIComponent(alias)}.${encodeURIComponent(as)}.${encodeURIComponent(session)}.over-line`);
}

export function overLine(alias: string, as: string, session: string): boolean {
  return existsSync(overFile(alias, as, session));
}

export function overLineSince(alias: string, as: string, session: string): number | null {
  try {
    const at = Number(readFileSync(overFile(alias, as, session), "utf8"));
    return Number.isSafeInteger(at) && at > 0 ? at : null;
  } catch {
    return null;
  }
}

export function noteOverLine(alias: string, as: string, session: string, over: boolean): void {
  try {
    if (!over) {
      rmSync(overFile(alias, as, session), { force: true });
      return;
    }
    mkdirSync(join(home(), "hook-state"), { recursive: true, mode: 0o700 });
    writeFileSync(overFile(alias, as, session), String(Date.now()));
  } catch {
    // Without the marker the nudge may come once more at the next stop: a repeat, never a loop.
  }
}

export function openTasksOf(state: ChannelState, me: string): number[] {
  return [...state.tasks.values()]
    .filter((t) => t.owner === me && t.state !== "done" && !t.archived)
    .map((t) => t.id)
    .sort((a, b) => a - b);
}

export function nudgeText(context: ContextUse, tasks: readonly number[], mc: string): string | null {
  const [first] = tasks;
  if (first === undefined) return null;
  const named = tasks.slice(0, NUDGE_IDS).map(taskId);
  const which = tasks.length > named.length ? `${named.join(", ")} and ${tasks.length - named.length} more` : named.join(", ");
  return `Your context is at ${tokensWord(context.used)} tokens, past the ${tokensWord(CONTEXT_LINE)} line. Before you end this turn, write where each of your open tasks stands (${which}) with \`${COMMANDS.checkpoint(mc, taskId(first))}\`: branch, last commit, done, next, traps. A new session of yours starts from it.`;
}
