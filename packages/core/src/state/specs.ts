import type { Message, SpecVerdict } from "../protocol.ts";
import { askOfMessage } from "./asks.ts";
import { answersDecisions, isPerson, sameAuthor } from "./people.ts";
import { openRound } from "./tasks.ts";
import type { AskHead, ChannelState, Member, Spec, Task } from "./types.ts";

const MAX_BACKS = 20;
const MAX_EDITORS = 40;

export type SpecStage = "draft" | "queued" | "working" | "delivered" | "accepted" | "dropped";

type SpecEvent = { op: "spec.set"; ask: number; text: string } | { op: "spec.approve"; ask: number; v: number } | { op: "spec.result"; ask: number; verdict: SpecVerdict; note?: string };

export const specLease = (ask: number): string => `spec/${ask}`;

export function specGate(specs: ReadonlyMap<number, Spec>, ask: number | undefined): string | null {
  if (ask === undefined) return "a task is a step of a spec: file it under the person's message whose approved spec it serves (--ask N)";
  const spec = specs.get(ask);
  if (!spec) return `#${ask} has no spec yet: write one (kiwi spec write ${ask} --file spec.md), and a person approves it before any task is filed`;
  if (spec.result) return `#${ask}'s spec is ${spec.result.verdict === "accepted" ? "accepted" : "dropped"}: no new work goes under it`;
  if (!spec.approved) return `#${ask}'s spec isn't approved yet: a person approves it, then its tasks are filed`;
  if (changedSinceApproval(spec)) return `#${ask}'s spec changed since it was approved: a person approves the change before new work goes under it`;
  return null;
}

export function taskSpecRefusal(state: Pick<ChannelState, "specs" | "specsOnly" | "askHeads" | "threadOf" | "placeOf" | "tasks">, anchors: { re?: number; from?: number }): string | null {
  if (state.specsOnly === null) return null;
  const ask = anchors.re !== undefined ? askOfMessage(state, anchors.re) : anchors.from !== undefined ? state.tasks.get(anchors.from)?.ask : undefined;
  return specGate(state.specs, ask);
}

export function judgesSpec(members: ReadonlyMap<string, Member>, head: Pick<AskHead, "by">, name: string): boolean {
  const m = members.get(name);
  if (!m?.active || !isPerson(m)) return false;
  return m.owner || sameAuthor(members.get(head.by), m) || answersDecisions(members, name);
}

export function foldSpec(
  specs: Map<number, Spec>,
  askHeads: ReadonlyMap<number, AskHead>,
  members: ReadonlyMap<string, Member>,
  m: Pick<Message, "seq" | "from">,
  ev: SpecEvent,
  at: number,
): string | null {
  const head = askHeads.get(ev.ask);
  if (!head || !(ev.ask < m.seq)) return `#${ev.ask} isn't a person's message that a spec is written for`;
  const spec = specs.get(ev.ask);
  if (spec?.result) return `#${ev.ask}'s spec is ${spec.result.verdict === "accepted" ? "accepted" : "dropped"}, so it no longer changes`;
  const mark = { seq: m.seq, by: m.from, at };
  if (ev.op === "spec.set") {
    if (!spec) {
      specs.set(ev.ask, { ask: ev.ask, text: ev.text, v: m.seq, by: m.from, at, started: mark, edits: 1, editors: [m.from], backs: [] });
      return null;
    }
    const editors = spec.editors.includes(m.from) ? spec.editors : [...spec.editors, m.from].slice(-MAX_EDITORS);
    specs.set(ev.ask, { ...spec, text: ev.text, v: m.seq, by: m.from, at, edits: spec.edits + 1, editors });
    return null;
  }
  if (!spec) return `#${ev.ask} has no spec yet`;
  if (!judgesSpec(members, head, m.from)) return "only the person who asked, the owner or a person who answers decisions approves a spec or judges what it delivered";
  if (ev.op === "spec.approve") {
    if (ev.v !== spec.v) return `#${ev.ask}'s spec changed since that version: read it again, then approve`;
    specs.set(ev.ask, { ...spec, approved: { ...mark, v: ev.v, text: spec.text } });
    return null;
  }
  if (ev.verdict === "back") {
    if (!spec.approved) return `#${ev.ask}'s spec isn't approved, so nothing was delivered to send back`;
    specs.set(ev.ask, { ...spec, backs: [...spec.backs, { ...mark, note: ev.note ?? "" }].slice(-MAX_BACKS) });
    return null;
  }
  specs.set(ev.ask, { ...spec, result: { ...mark, verdict: ev.verdict, ...(ev.note ? { note: ev.note } : {}) } });
  return null;
}

export function specTitleOf(text: string): string | null {
  const line = text.split("\n").find((l) => /^#\s+\S/.test(l));
  return line ? line.replace(/^#\s+/, "").trim() : null;
}

export function specTitle(spec: Pick<Spec, "text" | "ask">, head?: Pick<AskHead, "goal" | "words">): string {
  return specTitleOf(spec.text) ?? head?.goal ?? (head?.words || `#${spec.ask}`);
}

const BOX_RE = /^(\s*[-*+]\s+)\[([ xX])\]\s+(.*)$/;

const unticked = (text: string): string =>
  text
    .split("\n")
    .map((l) => l.replace(BOX_RE, (_, lead: string, _mark: string, rest: string) => `${lead}[ ] ${rest}`).trimEnd())
    .join("\n")
    .trim();

export function changedSinceApproval(spec: Pick<Spec, "text" | "approved">): boolean {
  return !!spec.approved && unticked(spec.text) !== unticked(spec.approved.text);
}

export interface DoneWhen {
  text: string;
  done: boolean;
}

const DONE_HEADING_RE = /^#{1,6}\s+done\b/i;

export function doneWhen(text: string): DoneWhen[] {
  let under = false;
  const all: (DoneWhen & { under: boolean })[] = [];
  for (const line of text.split("\n")) {
    if (/^#{1,6}\s/.test(line)) {
      under = DONE_HEADING_RE.test(line);
      continue;
    }
    const box = BOX_RE.exec(line);
    if (box) all.push({ text: box[3]!.trim(), done: box[2] !== " ", under });
  }
  const listed = all.some((b) => b.under) ? all.filter((b) => b.under) : all;
  return listed.map(({ text, done }) => ({ text, done }));
}

export function specTasks(state: Pick<ChannelState, "tasks">, ask: number): Task[] {
  return [...state.tasks.values()].filter((t) => t.ask === ask).sort((a, b) => a.id - b.id);
}

const working = (t: Task): boolean => t.state !== "done" && !t.archived && !t.cancelled;

export function specStage(state: Pick<ChannelState, "tasks">, spec: Spec): SpecStage {
  if (spec.result) return spec.result.verdict === "accepted" ? "accepted" : "dropped";
  if (!spec.approved) return "draft";
  const work = specTasks(state, spec.ask).filter((t) => !t.cancelled);
  if (work.some(working)) return "working";
  const back = spec.backs.at(-1)?.seq ?? 0;
  const closed = Math.max(0, ...work.map((t) => t.closedSeq ?? 0));
  return work.length > 0 && closed > back && doneWhen(spec.text).every((b) => b.done) ? "delivered" : "queued";
}

const queuedSince = (spec: Spec): number => Math.max(spec.approved?.seq ?? 0, spec.backs.at(-1)?.seq ?? 0);

export function specQueue(state: Pick<ChannelState, "specs" | "tasks">): Spec[] {
  return [...state.specs.values()].filter((s) => specStage(state, s) === "queued" && !changedSinceApproval(s)).sort((a, b) => queuedSince(a) - queuedSince(b));
}

function specOfTask(state: Pick<ChannelState, "specs" | "tasks">, task: number): Spec | undefined {
  const ask = state.tasks.get(task)?.ask;
  return ask === undefined ? undefined : state.specs.get(ask);
}

export function setAsideBySpec(state: Pick<ChannelState, "specs" | "tasks">, task: number): boolean {
  return specOfTask(state, task)?.result?.verdict === "dropped";
}

export function freeAgents(state: Pick<ChannelState, "members" | "tasks" | "lead">): string[] {
  const busy = new Set<string>();
  for (const t of state.tasks.values()) {
    if (t.state === "done" || t.archived) continue;
    if (t.owner) busy.add(t.owner);
    if (t.review && t.review !== "*" && openRound(t)) busy.add(t.review);
  }
  return [...state.members.values()].filter((m) => m.active && !isPerson(m) && m.kind !== "computer" && m.name !== state.lead && !busy.has(m.name)).map((m) => m.name);
}

export function specPlanner(state: Pick<ChannelState, "leases">, ask: number): string | undefined {
  return state.leases.get(specLease(ask))?.holder;
}

export function tickDoneWhen(text: string, words: string, done = true): { text: string } | { why: string } {
  const want = words.trim().toLowerCase();
  if (!want) return { why: "say which box: a few words of its line" };
  const lines = text.split("\n");
  const hits = lines.flatMap((line, i) => {
    const box = BOX_RE.exec(line);
    return box && box[3]!.toLowerCase().includes(want) ? [i] : [];
  });
  if (!hits.length) return { why: `no box in the spec says “${words.trim()}”` };
  if (hits.length > 1) return { why: `${hits.length} boxes say “${words.trim()}”: use more of the line` };
  const at = hits[0]!;
  lines[at] = lines[at]!.replace(BOX_RE, (_, lead: string, _mark: string, rest: string) => `${lead}[${done ? "x" : " "}] ${rest}`);
  return { text: lines.join("\n") };
}
