import { GENERAL_ROOM, ignored, type Trust } from "../protocol.ts";
import { taskId } from "./tasks.ts";
import type { ChannelState, Place, PlaceSummary, Task } from "./types.ts";

export const MAIN: Place = { kind: "main" };

export function placeKey(p: Place): string {
  return p.kind === "main" ? "main" : p.kind === "task" ? `task:${p.task}` : `dm:${p.with[0]}~${p.with[1]}`;
}

export function placeFromKey(key: string): Place | null {
  if (key === "main") return MAIN;
  const t = /^task:(\d+)$/.exec(key);
  if (t) return { kind: "task", task: Number(t[1]) };
  const d = /^dm:([^~]+)~([^~]+)$/.exec(key);
  return d ? { kind: "dm", with: [d[1]!, d[2]!] } : null;
}

export function dmPlace(a: string, b: string): Place {
  return { kind: "dm", with: a < b ? [a, b] : [b, a] };
}

export function threadMembers(state: Pick<ChannelState, "members" | "tasks" | "lead">, place: Place): string[] {
  const active = (n: string | undefined): n is string => !!n && !!state.members.get(n)?.active;
  if (place.kind === "main") return [...state.members.values()].filter((m) => m.active).map((m) => m.name);
  if (place.kind === "dm") return place.with.filter(active);
  const t = state.tasks.get(place.task);
  if (!t) return [];
  return [...new Set([t.owner, ...t.workedBy, t.review !== "*" ? t.review : undefined, state.lead ?? undefined, ...(t.posters ?? [])].filter(active))];
}

export function summarize(placeOf: Map<number, Place>, tasks: Map<number, Task>, trust: Map<number, Trust>, before: Iterable<[Place, number, number]> = []): Map<string, PlaceSummary> {
  const out = new Map<string, PlaceSummary>();
  const add = (place: Place, count: number, last: number) => {
    const real = place.kind === "task" && !tasks.has(place.task) ? MAIN : place;
    const key = placeKey(real);
    const s = out.get(key);
    if (s) {
      s.count += count;
      s.last = Math.max(s.last, last);
    } else out.set(key, { place: real, last, count, ...(real.kind === "task" && tasks.get(real.task)?.state === "done" ? { done: true } : {}) });
  };
  for (const [place, count, last] of before) add(place, count, last);
  for (const [seq, place] of placeOf) if (!ignored(trust.get(seq))) add(place, 1, seq);
  return out;
}

export interface ThreadAsk {
  task?: number;
  main?: boolean;
  dm?: string;
  reply?: boolean;
}

export interface ThreadChoice {
  task?: number;
  dm?: true;
  to?: string[];
  doing?: number;
  several?: number[];
}

export function chooseThread(state: Pick<ChannelState, "tasks" | "lead">, me: string, a: ThreadAsk): ThreadChoice | string {
  if ([a.task !== undefined, !!a.main, !!a.dm].filter(Boolean).length > 1) return "say one place: a task (--to T7), #general (--to #general) or a direct thread (--to @name)";
  if (a.dm) return { to: [a.dm], dm: true };
  if (a.task !== undefined) return { task: a.task };
  if (a.main || a.reply || state.lead === me) return {};
  const doing = [...state.tasks.values()].filter((t) => t.owner === me && t.state === "doing").map((t) => t.id);
  if (doing.length === 1) return { task: doing[0]!, doing: doing[0]! };
  return doing.length > 1 ? { several: doing } : {};
}

export function wentTo(c: ThreadChoice): string {
  if (c.dm && c.to) return ` to ${c.to[0]} (direct)`;
  if (c.task !== undefined) return ` in ${taskId(c.task)}'s thread${c.doing !== undefined ? " (the task you're doing; --to #general for the main conversation)" : ""}`;
  if (c.several) return ` in the main conversation: you're doing ${c.several.map(taskId).join(" and ")}, so say which with --to T7`;
  return "";
}

const GENERAL_LINES = 6;
const GENERAL_CHARS = 600;

export function inGeneral(state: Pick<ChannelState, "placeOf" | "roomOf">, seq: number): boolean {
  return placeKey(state.placeOf.get(seq) ?? MAIN) === placeKey(MAIN) && (state.roomOf.get(seq) ?? GENERAL_ROOM) === GENERAL_ROOM;
}

export function longForGeneral(state: Pick<ChannelState, "tasks" | "members">, me: string, body: string): string | null {
  if (state.members.get(me)?.kind === "human") return null;
  const said = body.trim();
  if (said.split("\n").length <= GENERAL_LINES && said.length <= GENERAL_CHARS) return null;
  const doing = [...state.tasks.values()].filter((t) => t.owner === me && t.state === "doing");
  const thread = doing.length === 1 ? taskId(doing[0]!.id) : "T7";
  return `That ran long for #general: people read it like a group chat and see ${GENERAL_LINES} lines before Show more. Next time, a line or two there and the detail in the task's thread (kiwi send --to ${thread} "…").`;
}

export function tasksAwaitingPeople(state: Pick<ChannelState, "openAsks" | "placeOf">): Set<number> {
  return new Set(
    state.openAsks
      .filter((m) => m.esc)
      .flatMap((m) => {
        const place = state.placeOf.get(m.seq);
        return place?.kind === "task" ? [place.task] : [];
      }),
  );
}
