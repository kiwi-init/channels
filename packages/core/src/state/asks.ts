import { asksPeople } from "../personality.ts";
import { isDecisionKind, wellFormedArea, type DecisionKind, type Message, type Step } from "../protocol.ts";
import { isPerson } from "./people.ts";
import { placeKey } from "./places.ts";
import { commentedSpec } from "./specs.ts";
import type { AskHead, ChannelState, Task } from "./types.ts";

const ASK_WORDS_MAX = 200;

type Lookup = Pick<ChannelState, "askHeads" | "threadOf" | "placeOf" | "tasks" | "specs">;

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
  const spec = commentedSpec(look.specs, seq);
  if (spec !== undefined) return spec;
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
  state: Pick<ChannelState, "members" | "askHeads" | "threadOf" | "placeOf" | "tasks" | "specs">,
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

export function askedOfPeopleByOthers(state: Pick<ChannelState, "openAsks" | "members">, me: string): Message[] {
  return state.openAsks.filter((a) => a.from !== me && !!a.to?.length && !a.to.includes(me) && a.to.some((n) => isPeopleTarget(state, n)));
}

export function openAsksOnWork(state: Pick<ChannelState, "openAsks" | "members" | "tasks" | "askHeads">, holds: readonly number[]): Message[] {
  if (!holds.length) return [];
  return state.openAsks.filter(
    (a) => a.esc && !a.permission && !a.handoff && !a.step && a.decision !== "irreversible" && !!a.to?.some((n) => isPeopleTarget(state, n)) && heldBy(state, a).some((id) => holds.includes(id)),
  );
}

export function asksOnSameWork(state: Pick<ChannelState, "openAsks" | "members" | "tasks" | "askHeads">, me: string, to: readonly string[], holds: readonly number[]): Message[] {
  if (!holds.length) return [];
  return askedOfPeopleByOthers(state, me).filter((a) => a.to?.some((n) => to.includes(n)) && heldBy(state, a).some((id) => holds.includes(id)));
}

export function leadForAsk(state: Pick<ChannelState, "members" | "lead">, me: string): string | null {
  const self = state.members.get(me);
  const lead = state.lead === null || state.lead === me ? undefined : state.members.get(state.lead);
  if (!self?.persona || asksPeople(self.persona) || !lead?.active || isPerson(lead)) return null;
  return lead.name;
}

export function directThreadStart(state: Pick<ChannelState, "placeOf">, seq: number): number | null {
  const place = state.placeOf.get(seq);
  if (place?.kind !== "dm") return null;
  const key = placeKey(place);
  let first = seq;
  for (const [at, p] of state.placeOf) if (at < first && p.kind === "dm" && placeKey(p) === key) first = at;
  return first;
}

interface HandedOver {
  choices?: readonly string[];
  holds?: readonly string[];
  decision?: DecisionKind;
  area?: string;
  step?: Step;
}

export function handedOver(from: string, body: string, ask: HandedOver): string {
  const list = (title: string, items: readonly string[] | undefined): string[] => (items?.length ? [title, ...items.map((i) => `- ${i}`)] : []);
  const step = ask.step;
  return [
    body.trim(),
    "",
    ...(step
      ? [
          `A step for a person: ${step.why}`,
          `Why an agent can't do it: ${step.needsPerson}`,
          ...list("Do:", step.do),
          ...list("Run:", step.run),
          ...(step.expect ? [`Expect: ${step.expect}`] : []),
          ...list("Links:", step.links),
        ]
      : []),
    ...list("Options:", ask.choices),
    ...(ask.decision ? [`Kind: ${ask.decision}`] : []),
    ...(ask.area ? [`Area: ${ask.area}`] : []),
    ...(ask.holds?.length ? [`Holds: ${ask.holds.join(", ")}`] : []),
    `Handed to you, the Lead: ${from} doesn't ask people. ${step ? "Pass it to a person with kiwi ask-human --step, or say why it isn't needed." : "Decide it yourself, or ask a person with kiwi ask-human."}`,
  ].join("\n");
}

export interface Handed {
  from: string;
  question: string;
  choices: string[];
  holds: string[];
  decision?: DecisionKind;
  area?: string;
  step?: Step;
}

const HANDED = /^Handed to you, the Lead: (.+) doesn't ask people\. /;

export function readHandedOver(body: string): Handed | null {
  const cut = body.lastIndexOf("\n\n");
  if (cut < 0) return null;
  const lines = body.slice(cut + 2).split("\n");
  const from = HANDED.exec(lines.at(-1) ?? "")?.[1];
  if (!from) return null;
  const lists: Record<string, string[]> = { "Do:": [], "Run:": [], "Links:": [], "Options:": [] };
  const said = new Map<string, string>();
  let list: string[] | undefined;
  for (const line of lines.slice(0, -1)) {
    if (line in lists) list = lists[line];
    else if (list && line.startsWith("- ")) list.push(line.slice(2));
    else {
      list = undefined;
      const at = line.indexOf(": ");
      if (at > 0) said.set(line.slice(0, at), line.slice(at + 2));
    }
  }
  const why = said.get("A step for a person");
  const needsPerson = said.get("Why an agent can't do it");
  const kind = said.get("Kind");
  const area = said.get("Area");
  const expect = said.get("Expect");
  const some = (items: string[] | undefined): string[] | undefined => (items?.length ? items : undefined);
  const step: Step | undefined =
    why !== undefined && needsPerson !== undefined
      ? {
          why,
          needsPerson,
          ...(some(lists["Do:"]) ? { do: lists["Do:"] } : {}),
          ...(some(lists["Run:"]) ? { run: lists["Run:"] } : {}),
          ...(expect ? { expect } : {}),
          ...(some(lists["Links:"]) ? { links: lists["Links:"] } : {}),
        }
      : undefined;
  return {
    from,
    question: body.slice(0, cut),
    choices: lists["Options:"] ?? [],
    holds: said.get("Holds")?.split(", ") ?? [],
    ...(isDecisionKind(kind) ? { decision: kind } : {}),
    ...(wellFormedArea(area) ? { area } : {}),
    ...(step ? { step } : {}),
  };
}

export function handedAskOf<M extends Pick<Message, "seq" | "from" | "to" | "body">>(ask: Pick<Message, "from" | "re">, find: (seq: number) => M | undefined): M | undefined {
  for (const seq of ask.re ?? []) {
    const handed = find(seq);
    if (
      handed?.to?.includes(ask.from) &&
      HANDED.exec(
        String(handed.body ?? "")
          .split("\n")
          .at(-1) ?? "",
      )?.[1] === handed.from
    )
      return handed;
  }
  return undefined;
}

export function answerAddress<M extends Pick<Message, "seq" | "from" | "to" | "body">>(
  ask: Pick<Message, "seq" | "from" | "re">,
  find: (seq: number) => M | undefined,
): { to: string[]; re: number[] } {
  const handed = handedAskOf(ask, find);
  return handed ? { to: [ask.from, handed.from], re: [ask.seq, handed.seq] } : { to: [ask.from], re: [ask.seq] };
}

export interface HandedAsk {
  ask: Message;
  handed: Handed;
}

export function handedTo(state: Pick<ChannelState, "openAsks">, me: string): HandedAsk[] {
  return state.openAsks
    .flatMap((ask) => {
      const handed = ask.from !== me && ask.to?.includes(me) ? readHandedOver(String(ask.body ?? "")) : null;
      return handed?.from === ask.from ? [{ ask, handed }] : [];
    })
    .sort((a, b) => a.ask.seq - b.ask.seq);
}

function isPeopleTarget(state: Pick<ChannelState, "members">, name: string): boolean {
  const m = state.members.get(name);
  return !!m && isPerson(m);
}

export function holdsWork(state: Pick<ChannelState, "tasks" | "askHeads" | "members">, m: Pick<Message, "from" | "task" | "holds" | "permission" | "handoff">): boolean {
  const from = state.members.get(m.from);
  return (!!from && isPerson(from)) || !!m.permission || !!m.handoff || heldBy(state, m).length > 0;
}
