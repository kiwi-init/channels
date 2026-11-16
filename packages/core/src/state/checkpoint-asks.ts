import { withinWindow, type CheckpointDaily } from "../checkpoint-schedule.ts";
import type { CheckpointOwed, Message } from "../protocol.ts";
import { leadCheckpointKey } from "./lead.ts";
import { isPerson } from "./people.ts";
import type { CheckpointAsk, Fact, FoldMember, Task } from "./types.ts";

export const CHECKPOINT_ASKS_KEPT = 20;
export const CHECKPOINT_ASK_TTL_MS = 86_400_000;

interface AskView {
  members: Map<string, FoldMember>;
  trusted: (pk: string, member: FoldMember) => boolean;
  checkpointDaily: CheckpointDaily | null;
  checkpointAsks: CheckpointAsk[];
}

interface AskEvent {
  asks: CheckpointOwed[];
  unreachable: string[];
  occurrence?: string;
}

function namedRefusal(c: AskView, ev: AskEvent): string | null {
  for (const name of [...ev.asks.map((a) => a.agent), ...ev.unreachable]) {
    const named = c.members.get(name);
    if (!named?.active) return `no member named ${name}`;
    if (isPerson(named)) return `${name} is a person: only agents are asked for checkpoints`;
  }
  return null;
}

function dailyRefusal(c: AskView, rts: number | undefined, occurrence: string): string | null {
  if (!c.checkpointDaily) return "this channel has no daily checkpoint time";
  if (rts === undefined || !withinWindow(c.checkpointDaily, occurrence, rts)) return `the daily checkpoint request for ${occurrence} came outside its time`;
  if (c.checkpointAsks.some((a) => a.occurrence === occurrence)) return `the daily checkpoint request for ${occurrence} was already made`;
  return null;
}

export function checkpointAskRefusal(c: AskView, m: Pick<Message, "pk" | "rts">, ev: AskEvent, member: FoldMember): string | null {
  const named = namedRefusal(c, ev);
  if (named) return named;
  if (ev.occurrence !== undefined) return dailyRefusal(c, m.rts, ev.occurrence);
  if (member.owner || c.trusted(m.pk ?? "", member)) return null;
  return "only the owner or a person they trust asks every agent for its checkpoints";
}

export const keepAsk = (kept: readonly CheckpointAsk[], ask: CheckpointAsk): CheckpointAsk[] => [...kept, ask].slice(-CHECKPOINT_ASKS_KEPT);

export type CheckpointItem = { kind: "task"; task: number; state: "saved" | "pending" | "closed" } | { kind: "lead"; state: "saved" | "pending" };

export type AgentCheckpoints = { agent: string; reach: "asked"; items: CheckpointItem[]; saved: boolean } | { agent: string; reach: "unreachable" };

interface StatusView {
  tasks: ReadonlyMap<number, Task>;
  facts: ReadonlyMap<string, Fact>;
}

function taskItem(view: StatusView, agent: string, id: number, after: number): CheckpointItem {
  const t = view.tasks.get(id);
  if (t?.notes.some((n) => n.checkpoint && n.by === agent && n.seq > after)) return { kind: "task", task: id, state: "saved" };
  if (!t || t.state === "done" || t.archived) return { kind: "task", task: id, state: "closed" };
  return { kind: "task", task: id, state: "pending" };
}

function leadItem(view: StatusView, agent: string, after: number): CheckpointItem {
  const fact = view.facts.get(leadCheckpointKey(agent));
  return { kind: "lead", state: fact && fact.by === agent && fact.seq > after ? "saved" : "pending" };
}

function owedItems(view: StatusView, owed: CheckpointOwed, after: number): CheckpointItem[] {
  return [...owed.tasks.map((id) => taskItem(view, owed.agent, id, after)), ...(owed.lead ? [leadItem(view, owed.agent, after)] : [])];
}

export function checkpointAskStatus(view: StatusView, ask: CheckpointAsk): AgentCheckpoints[] {
  return [
    ...ask.asks.map((owed): AgentCheckpoints => {
      const items = owedItems(view, owed, ask.seq);
      return { agent: owed.agent, reach: "asked", items, saved: items.every((i) => i.state !== "pending") };
    }),
    ...ask.unreachable.map((agent): AgentCheckpoints => ({ agent, reach: "unreachable" })),
  ];
}

export interface Owed {
  ask: CheckpointAsk;
  tasks: number[];
  lead: boolean;
}

export function owedBy(view: StatusView & { checkpointAsks: readonly CheckpointAsk[] }, me: string, now: number): Owed | null {
  const ask = view.checkpointAsks.findLast((a) => a.asks.some((o) => o.agent === me));
  if (!ask || now - ask.at >= CHECKPOINT_ASK_TTL_MS) return null;
  const owed = ask.asks.find((o) => o.agent === me);
  if (!owed) return null;
  const pending = owedItems(view, owed, ask.seq).filter((i) => i.state === "pending");
  if (!pending.length) return null;
  return { ask, tasks: pending.flatMap((i) => (i.kind === "task" ? [i.task] : [])), lead: pending.some((i) => i.kind === "lead") };
}
