import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { taskId } from "@kiwi/core/state.ts";
import type { Owed } from "@kiwi/core/state/checkpoint-asks.ts";
import { home } from "../config.ts";
import { COMMANDS } from "../brief.ts";

const NAMED_TASKS = 8;

function markFile(alias: string, as: string, session: string): string {
  return join(home(), "hook-state", `${encodeURIComponent(alias)}.${encodeURIComponent(as)}.${encodeURIComponent(session)}.checkpoint-ask`);
}

export const owedMark = (owed: Owed): string => `${owed.ask.seq}:${owed.tasks.join(",")}:${owed.lead ? "lead" : ""}`;

export function owedShown(alias: string, as: string, session: string): string | null {
  try {
    return readFileSync(markFile(alias, as, session), "utf8");
  } catch {
    // No mark yet means nothing was shown in this session.
    return null;
  }
}

export function noteOwedShown(alias: string, as: string, session: string, mark: string): void {
  try {
    mkdirSync(join(home(), "hook-state"), { recursive: true, mode: 0o700 });
    writeFileSync(markFile(alias, as, session), mark);
  } catch {
    // Without the mark the same request may be shown once more at the next stop: a repeat, never a loop.
  }
}

function asker(owed: Owed): string {
  return owed.ask.occurrence ? `The daily checkpoint request (#${owed.ask.seq})` : `${owed.ask.by} (#${owed.ask.seq})`;
}

export function owedText(owed: Owed, mc: string): string | null {
  const [first] = owed.tasks;
  if (first === undefined && !owed.lead) return null;
  const named = owed.tasks.slice(0, NAMED_TASKS).map(taskId);
  const which = owed.tasks.length > named.length ? `${named.join(", ")} and ${owed.tasks.length - named.length} more` : named.join(", ");
  const asks = [
    ...(first === undefined ? [] : [`where each of ${which} stands with \`${COMMANDS.checkpoint(mc, taskId(first))}\`: branch, last commit, done, next, traps`]),
    ...(owed.lead ? [`where the channel stands as you lead it with \`${COMMANDS.leadCheckpoint(mc)}\``] : []),
  ];
  return `${asker(owed)} asks for your checkpoints. Before you end this turn, write ${asks.join("; and ")}. It shows as saved once each one is stored.`;
}
