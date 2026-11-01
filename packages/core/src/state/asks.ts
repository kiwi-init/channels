import type { Message } from "../protocol.ts";
import { isPerson } from "./people.ts";
import type { AskHead, ChannelState, Task } from "./types.ts";

const ASK_WORDS_MAX = 200;

type Lookup = Pick<ChannelState, "askHeads" | "threadOf" | "placeOf" | "tasks">;

export function askHeadOf(m: Pick<Message, "seq" | "from" | "body">, at: number): AskHead {
  return {
    id: m.seq,
    by: m.from,
    words: String(m.body ?? "")
      .trim()
      .slice(0, ASK_WORDS_MAX),
    at,
  };
}

export function askOfMessage(look: Lookup, seq: number): number | undefined {
  const root = look.threadOf.get(seq) ?? seq;
  for (const said of root === seq ? [seq] : [seq, root]) {
    const place = look.placeOf.get(said);
    const held = place?.kind === "task" ? look.tasks.get(place.task)?.ask : undefined;
    if (held !== undefined) return held;
  }
  if (look.askHeads.has(root)) return root;
  return look.askHeads.has(seq) ? seq : undefined;
}

export function fileTask(look: Lookup, task: Task, re: number | undefined, byPerson: boolean, at: number): number | undefined {
  const fromMessage = re !== undefined ? askOfMessage(look, re) : undefined;
  if (fromMessage !== undefined) return fromMessage;
  const fromParent = task.from !== undefined ? look.tasks.get(task.from)?.ask : undefined;
  if (fromParent !== undefined) return fromParent;
  if (!byPerson && !task.issue) return undefined;
  look.askHeads.set(task.id, { id: task.id, by: task.createdBy, words: task.title.slice(0, ASK_WORDS_MAX), at });
  return task.id;
}

export function askRefusal(
  state: Pick<ChannelState, "members" | "askHeads" | "threadOf" | "placeOf" | "tasks">,
  me: string,
  anchors: { re?: number; from?: number; issue?: boolean },
  fix: string,
): string | null {
  const member = state.members.get(me);
  if ((member && isPerson(member)) || anchors.from !== undefined || anchors.issue) return null;
  if (anchors.re === undefined) return `a task is filed under the ask it serves: ${fix}`;
  if (!state.placeOf.has(anchors.re) || askOfMessage(state, anchors.re) !== undefined) return null;
  return `#${anchors.re} isn't a person's message or a reply under one, so no ask holds it: ${fix}`;
}

export function mayNameGoal(state: Pick<ChannelState, "members" | "lead">, me: string, head: AskHead): boolean {
  return state.lead === me || !!state.members.get(me)?.owner || head.by === me;
}

export interface AskGroup {
  head: AskHead | null;
  tasks: Task[];
}

export function askGroups(state: Pick<ChannelState, "askHeads">, tasks: Task[]): AskGroup[] {
  const groups = new Map<number | null, Task[]>();
  for (const t of tasks) {
    const key = t.ask !== undefined && state.askHeads.has(t.ask) ? t.ask : null;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return [...groups].sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a - b)).map(([key, list]) => ({ head: key === null ? null : state.askHeads.get(key)!, tasks: list }));
}

export function heldBy(state: Pick<ChannelState, "tasks" | "askHeads">, m: Pick<Message, "task" | "holds">): number[] {
  return [...new Set([...(m.task !== undefined ? [m.task] : []), ...(m.holds ?? [])])].filter((id) => {
    const t = state.tasks.get(id);
    return t ? t.state !== "done" : state.askHeads.has(id);
  });
}

export function holdsWork(state: Pick<ChannelState, "tasks" | "askHeads" | "members">, m: Pick<Message, "from" | "task" | "holds" | "permission" | "handoff">): boolean {
  const from = state.members.get(m.from);
  return (!!from && isPerson(from)) || !!m.permission || !!m.handoff || heldBy(state, m).length > 0;
}
