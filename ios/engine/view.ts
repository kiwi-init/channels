import { ignored, isQuiet, ROBOT_FACES, type ChannelIcon, type Message } from "@kiwi/core/protocol.ts";
import { answersDecisions, decidersOf, MAIN, openRound, placeFromKey, placeKey, taskId, type ChannelState } from "@kiwi/core/state.ts";
import { inGeneral } from "@kiwi/core/state/places.ts";
import type { FoldMember } from "@kiwi/core/state/types.ts";

import { askLabel, asksFor, chosenOf, heldAsks } from "@kiwi/app/asks.ts";
import { avatarIndex } from "@kiwi/app/avatar-pick.ts";
import { chipsFor } from "@kiwi/app/reactions.ts";
import type { Online } from "@kiwi/channel/online.ts";
import { knownHarness, monoHarness } from "@kiwi/app/harness.ts";
import { named, namedMarkdown } from "@kiwi/app/mentions.ts";
import { lastPreview } from "@kiwi/app/preview.ts";
import { reviewsFor } from "@kiwi/channel/task-actions.ts";
import type { AskView, Connection, IconView, MemberView, MessageView, PlaceView, ReviewView, RoomView, TaskView } from "./wire.ts";

const SHOWN = 300;
const QUOTE_CHARS = 140;

export interface RoomInput {
  code: string;
  title: string;
  icon: ChannelIcon | null;
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

const iconView = (icon: ChannelIcon | null, title: string): IconView => icon ?? { kind: "robot", robot: ROBOT_FACES[avatarIndex(title.trim().toLowerCase(), ROBOT_FACES.length)]! };

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
  const here = key === placeKey(MAIN) ? inGeneral(state, m.seq) : placeKey(state.placeOf.get(m.seq) ?? MAIN) === key;
  if (!here) return false;
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
  const nicknames = new Map([...state.members.values()].map((m) => [m.name, m.display || m.name]));
  const said = (text: string) => namedMarkdown(text, nicknames);
  const plain = (text: string) => named(text, nicknames);

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
      shown: said(m.body),
      plain: plain(m.body),
      event: m.kind === "event",
      mine: m.from === me,
      quote: quoted && quoted.kind !== "event" ? { seq: quoted.seq, from: quoted.from, words: oneLine(plain(quoted.body), QUOTE_CHARS) } : null,
      choices: m.choices ?? [],
      chosen: chosen ? { choice: chosen.choice, by: chosen.by } : null,
      waiting: waiting.has(m.seq),
      images: m.imgs?.length ?? 0,
      task: place?.kind === "task" ? place.task : (m.task ?? null),
      reactions: chipsFor(state, m.seq, me, (name) => state.members.get(name)?.display ?? name),
    };
  };

  const messages = shown.map((m, i) => messageView(m, i > 0 ? shown[i - 1] : visible[visible.length - shown.length - 1]));
  const sideKey = state.lead && state.lead !== me ? `dm:${[me, state.lead].sort().join("~")}` : null;
  const sideAll = sideKey ? r.messages.filter((m) => shownIn(m, state, sideKey)) : [];
  const sideShown = sideAll.slice(-SHOWN);
  const side = sideShown.map((m, i) => messageView(m, i > 0 ? sideShown[i - 1] : sideAll[sideAll.length - sideShown.length - 1]));
  const lastChat = general.findLast((m) => m.kind !== "event");
  const lastIn = new Map<string, Message>();
  for (const m of r.messages) {
    if (m.kind === "event" || isQuiet(m) || ignored(state.trust.get(m.seq))) continue;
    lastIn.set(placeKey(state.placeOf.get(m.seq) ?? MAIN), m);
  }
  const nameOf = (name: string) => state.members.get(name)?.display ?? name;
  const keyOf = (m: Message) => placeKey(state.placeOf.get(m.seq) ?? MAIN);
  const latest = lastPreview(
    r.messages.filter((m) => keyOf(m) !== sideKey),
    (seq) => state.trust.get(seq),
  );
  const latestIn = latest ? keyOf(latest) : "main";
  const placeView = (key: string): PlaceView | null => {
    const p = placeFromKey(key);
    if (!p) return null;
    const last = lastIn.get(key);
    const summary = state.places.get(key);
    const withMe = p.kind !== "dm" || p.with.includes(me);
    const title =
      p.kind === "main"
        ? r.title
        : p.kind === "task"
          ? `${taskId(p.task)} ${state.tasks.get(p.task)?.title ?? ""}`.trim()
          : withMe
            ? nameOf(p.with.find((n) => n !== me) ?? me)
            : p.with.map(nameOf).join(" & ");
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
  const placeKeys = ["main", ...(sideKey ? [sideKey] : []), ...(here !== "main" ? [here] : [])];
  const places = [...new Set(placeKeys)].flatMap((k) => {
    const v = placeView(k);
    return v ? [v] : [];
  });
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
      shown: said(m.body),
      plain: plain(m.body),
      at: m.rts ?? m.ts,
      label: askLabel(m, me),
      choices: m.choices ?? [],
      task: place?.kind === "task" ? place.task : null,
      place: placeKey(place ?? MAIN),
    };
  });

  const mine = state.members.get(me);
  const person = (mine?.kind ?? (mine?.owner ? "human" : "agent")) === "human";
  const reviews: ReviewView[] = reviewsFor(state.tasks.values(), me, person).map((t) => ({
    task: t.id,
    title: t.title,
    by: t.owner ?? t.workedBy.at(-1) ?? null,
    at: openRound(t)?.ts ?? t.updatedAt,
  }));

  return {
    code: r.code,
    title: r.title,
    icon: iconView(r.icon, r.title),
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
    side,
    sideKey,
    tasks,
    asks,
    reviews,
    last: lastChat ? messageView(lastChat, undefined) : null,
    latest: latest ? messageView(latest, undefined) : null,
    latestIn,
    place: here,
    places,
  };
}
