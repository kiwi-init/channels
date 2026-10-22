import { ignored, isQuiet, type Message } from "@kiwi/core/protocol.ts";
import { answersDecisions, decidersOf, MAIN, placeFromKey, placeKey, taskId, type ChannelState } from "@kiwi/core/state.ts";
import type { FoldMember } from "@kiwi/core/state/types.ts";

import { askLabel, asksFor, chosenOf, heldAsks } from "../../web/src/lib/asks.ts";
import { chipsFor } from "../../web/src/lib/reactions.ts";
import type { Online } from "../../web/src/lib/channel/online.ts";
import { knownHarness, monoHarness } from "../../web/src/lib/harness.ts";
import type { AskView, Connection, MemberView, MessageView, PlaceView, RoomView, TaskView } from "./wire.ts";

const SHOWN = 300;
const QUOTE_CHARS = 140;

export interface RoomInput {
  code: string;
  title: string;
  me: string;
  isOwner: boolean;
  connection: Connection;
  gone: "removed" | "closed" | null;
  error: string | null;
  head: number;
  whole: boolean;
  messages: readonly Message[];
  state: ChannelState;
  online: ReadonlyMap<string, Online>;
  place: string;
}

const oneLine = (s: string, max: number): string => {
  const line = s.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

function memberView(m: FoldMember, state: ChannelState, online: ReadonlyMap<string, Online>): MemberView {
  const here = online.get(m.name);
  const activity = here?.activity;
  const harness = knownHarness(m.runs?.harness ?? m.card?.harness);
  return {
    name: m.name,
    display: m.display ?? m.name,
    kind: m.kind ?? (m.owner ? "human" : "agent"),
    role: m.role ?? null,
    owner: m.owner,
    lead: state.lead === m.name,
    color: m.color ?? null,
    here: !!here,
    activity: activity ? { state: activity.state, tool: activity.tool ?? null, since: activity.since ?? null } : null,
    sponsor: m.sponsor?.name ?? null,
    model: m.runs?.model ?? null,
    harness,
    mono: harness !== null && monoHarness(harness),
    doing: [...state.tasks.values()].filter((t) => t.owner === m.name && t.state === "doing").map((t) => t.id),
  };
}

function shownIn(m: Message, state: ChannelState, key: string): boolean {
  if (placeKey(state.placeOf.get(m.seq) ?? MAIN) !== key) return false;
  return !isQuiet(m) && !ignored(state.trust.get(m.seq));
}

export function roomView(r: RoomInput): RoomView {
  const { state, me } = r;
  const bySeq = new Map(r.messages.map((m) => [m.seq, m]));
  const repliesTo = new Map<number, Message[]>();
  for (const m of r.messages) for (const seq of m.re ?? []) repliesTo.set(seq, [...(repliesTo.get(seq) ?? []), m]);
  const { decisions, escalations, questions } = asksFor(heldAsks(state), me, answersDecisions(state.members, me));
  const waiting = new Set([...decisions, ...escalations].map((m) => m.seq));
  const here = placeFromKey(r.place) ? r.place : "main";
  const visible = r.messages.filter((m) => shownIn(m, state, here));
  const general = here === "main" ? visible : r.messages.filter((m) => shownIn(m, state, "main"));
  const shown = visible.slice(-SHOWN);

  const messageView = (m: Message, prev: Message | undefined): MessageView => {
    const re = m.re?.length === 1 ? m.re[0]! : null;
    const quoted = re !== null && prev?.seq !== re ? bySeq.get(re) : undefined;
    const chosen = m.choices?.length ? chosenOf(m, repliesTo.get(m.seq) ?? [], decidersOf(state, m)) : undefined;
    const place = state.placeOf.get(m.seq);
    return {
      seq: m.seq,
      from: m.from,
      at: m.rts ?? m.ts,
      kind: m.kind,
      body: m.body,
      event: m.kind === "event",
      mine: m.from === me,
      quote: quoted && quoted.kind !== "event" ? { seq: quoted.seq, from: quoted.from, words: oneLine(quoted.body, QUOTE_CHARS) } : null,
      choices: m.choices ?? [],
      chosen: chosen ? { choice: chosen.choice, by: chosen.by } : null,
      waiting: waiting.has(m.seq),
      images: m.imgs?.length ?? 0,
      task: place?.kind === "task" ? place.task : (m.task ?? null),
      reactions: chipsFor(state, m.seq, me, (name) => state.members.get(name)?.display ?? name),
    };
  };

  const messages = shown.map((m, i) => messageView(m, i > 0 ? shown[i - 1] : visible[visible.length - shown.length - 1]));
  const lastChat = general.findLast((m) => m.kind !== "event");
  const lastIn = new Map<string, Message>();
  for (const m of r.messages) {
    if (m.kind === "event" || isQuiet(m) || ignored(state.trust.get(m.seq))) continue;
    lastIn.set(placeKey(state.placeOf.get(m.seq) ?? MAIN), m);
  }
  const nameOf = (name: string) => state.members.get(name)?.display ?? name;
  const placeView = (key: string): PlaceView | null => {
    const p = placeFromKey(key);
    if (!p) return null;
    const last = lastIn.get(key);
    const summary = state.places.get(key);
    const withMe = p.kind !== "dm" || p.with.includes(me);
    const title =
      p.kind === "main" ? r.title : p.kind === "task" ? `${taskId(p.task)} ${state.tasks.get(p.task)?.title ?? ""}`.trim() : withMe ? nameOf(p.with.find((n) => n !== me) ?? me) : p.with.map(nameOf).join(" & ");
    return {
      key,
      kind: p.kind,
      title,
      with: p.kind === "dm" ? [...p.with] : [],
      withMe,
      task: p.kind === "task" ? p.task : null,
      lastSeq: summary?.last ?? last?.seq ?? 0,
      last: last ? messageView(last, undefined) : null,
    };
  };
  const placeKeys = ["main", ...[...state.places.keys()].filter((k) => k.startsWith("dm:")), ...(here !== "main" && !state.places.has(here) ? [here] : [])];
  const places = [...new Set(placeKeys)].flatMap((k) => {
    const v = placeView(k);
    return v ? [v] : [];
  });
  if (here.startsWith("task:") && !places.some((p) => p.key === here)) {
    const v = placeView(here);
    if (v) places.push(v);
  }
  const tasks: TaskView[] = [...state.tasks.values()]
    .filter((t) => !t.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((t) => ({
      id: t.id,
      title: t.title,
      state: t.state,
      owner: t.owner ?? null,
      review: t.review ?? null,
      updatedAt: t.updatedAt,
      createdAt: t.createdAt,
      last: t.notes.at(-1)?.text ?? null,
      archived: !!t.archived,
    }));
  const asks: AskView[] = [...decisions, ...escalations, ...questions].map((m) => {
    const place = state.placeOf.get(m.seq);
    return {
      seq: m.seq,
      from: m.from,
      body: m.body,
      at: m.rts ?? m.ts,
      label: askLabel(m, me),
      choices: m.choices ?? [],
      task: place?.kind === "task" ? place.task : null,
    };
  });

  return {
    code: r.code,
    title: r.title,
    me,
    isOwner: r.isOwner,
    connection: r.connection,
    gone: r.gone,
    error: r.error,
    head: r.head,
    whole: r.whole,
    hold: state.hold ? (state.hold.note ?? "") : null,
    charter: state.charter?.text ?? null,
    lead: state.lead,
    members: [...state.members.values()].filter((m) => m.active).map((m) => memberView(m as FoldMember, state, r.online)),
    messages,
    tasks,
    asks,
    last: lastChat ? messageView(lastChat, undefined) : null,
    place: here,
    places,
  };
}
