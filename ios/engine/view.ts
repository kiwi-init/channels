import type { Frozen } from "@kiwi/core/state.ts";
import { decodeJoinCode } from "@kiwi/core/crypto.ts";
import { GENERAL_ROOM, ignored, isQuiet, ROBOT_FACES, type ChannelIcon, type Message } from "@kiwi/core/protocol.ts";
import { isPerson, personOf, rootOf, sentTo, type Seat } from "@kiwi/core/room-rules.ts";
import { answersAsk, answersDecisions, decidersOf, dmPlace, MAIN, openRound, placeFromKey, placeKey, taskId, type ChannelState } from "@kiwi/core/state.ts";
import { roomOfMessage } from "@kiwi/core/state/rooms.ts";
import type { FoldMember, Room } from "@kiwi/core/state/types.ts";

import { askLabel, asksFor, chosenOf, heldAsks } from "@kiwi/app/asks.ts";
import { avatarIndex } from "@kiwi/app/avatar-pick.ts";
import { chipsFor } from "@kiwi/app/reactions.ts";
import type { Online } from "@kiwi/channel/online.ts";
import { knownHarness, monoHarness } from "@kiwi/app/harness.ts";
import { named, namedMarkdown } from "@kiwi/app/mentions.ts";
import { lastPreview } from "@kiwi/app/preview.ts";
import { preview } from "../../ui/src/chat/preview.ts";
import { reviewsFor } from "@kiwi/channel/task-actions.ts";
import { hiddenBy, standBoard, standsIn, standView, type StandScope } from "./stand.ts";
import type { AskView, Connection, IconView, MemberView, MessageView, NeedView, PlaceView, ReviewView, RoomView, TaskView } from "./wire.ts";

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
  needs?: NeedView[];
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
    face: (m.kind ?? (m.owner ? "human" : "agent")) === "human" ? null : state.lead === m.name ? "lead" : (m.persona?.role ?? null),
    owner: m.owner,
    lead: state.lead === m.name,
    color: m.color ?? null,
    here: !!here,
    activity: activity && activity.state !== "unknown" ? { state: activity.state, tool: activity.tool ?? null, since: activity.since ?? null } : null,
    sponsor: m.sponsor?.name ?? null,
    model: m.runs?.model ?? null,
    harness,
    mono: harness !== null && monoHarness(harness),
    doing: [...state.tasks.values()].filter((t) => t.owner === m.name && t.state === "doing").map((t) => t.id),
    person: personOf(m, [...state.members.values()]),
    picture: pictureOf(m, state),
  };
}

function pictureOf(m: FoldMember, state: ChannelState): string | null {
  if (!isPerson(m)) return null;
  if (m.picture) return m.picture.data;
  const seats = [...state.members.values()];
  const who = personOf(m, seats);
  if (!who.startsWith("person:")) return null;
  return seats.find((s) => s.active && isPerson(s) && s.picture && personOf(s, seats) === who)?.picture?.data ?? null;
}

const roomIdOf = (code: string): string | null => {
  try {
    return decodeJoinCode(code).roomId;
  } catch {
    // A code that doesn't decode leaves the room without an id; it then gets no Live Activity.
    return null;
  }
};

const ROOM_KEY = /^room:(.+)$/;

export const isRoomKey = (key: string): boolean => ROOM_KEY.test(key);

const roomKey = (id: string): string => `room:${id}`;

interface Seen {
  rooms: ReadonlyMap<string, Room>;
  members: ReadonlyMap<string, Seat>;
}

export function roomsFor(state: Frozen<Seen>, me: string): Frozen<Room[]> {
  return [...state.rooms.values()].filter((r) => r.id !== GENERAL_ROOM && !r.dm && !r.self && sentTo(r, me, state.members));
}

export const roomKeysFor = (state: Frozen<Seen>, me: string): string[] => roomsFor(state, me).map((r) => roomKey(r.id));

export function roomOfKey(state: Frozen<Seen>, me: string, key: string): Frozen<Room | null> {
  const id = ROOM_KEY.exec(key)?.[1];
  return id ? (roomsFor(state, me).find((r) => r.id === id) ?? null) : null;
}

function spotOf(state: Pick<ChannelState, "placeOf" | "roomOf">, m: Pick<Message, "seq" | "room">): string {
  const place = state.placeOf.get(m.seq) ?? MAIN;
  if (place.kind !== "main") return placeKey(place);
  const room = roomOfMessage(state, m);
  return room === GENERAL_ROOM ? "main" : roomKey(room);
}

function shownIn(m: Message, state: ChannelState, key: string): boolean {
  return spotOf(state, m) === key && !isQuiet(m) && !ignored(state.trust.get(m.seq));
}

export function leadChatKey(state: Pick<ChannelState, "lead" | "members">, me: string): string | null {
  const root = rootOf(me, state.members);
  return state.lead && state.lead !== me && state.lead !== root ? placeKey(dmPlace(root, state.lead)) : null;
}

export function standLabel(state: ChannelState, me: string, key: string): string {
  if (isRoomKey(key)) return `#${roomOfKey(state, me, key)?.name ?? "room"}`;
  const p = placeFromKey(key);
  if (!p || p.kind === "main") return "#general";
  if (p.kind === "task") return taskId(p.task);
  const root = rootOf(me, state.members);
  const others = p.with.filter((n) => n !== root);
  return others.length === 1 ? `@${others[0]}` : p.with.map((n) => `@${n}`).join(" & ");
}

function standScope(state: ChannelState, me: string, key: string): StandScope {
  if (isRoomKey(key)) return { kind: "none" };
  const p = placeFromKey(key);
  if (!p || p.kind === "main") return { kind: "all" };
  if (p.kind === "task") return { kind: "task", task: p.task };
  const root = rootOf(me, state.members);
  const others = p.with.filter((n) => n !== root);
  return others.length === 1 ? { kind: "owner", owner: others[0]! } : { kind: "none" };
}

export function roomView(r: RoomInput): RoomView {
  const { state, me } = r;
  const bySeq = new Map(r.messages.map((m) => [m.seq, m]));
  const repliesTo = new Map<number, Message[]>();
  for (const m of r.messages) for (const seq of m.re ?? []) repliesTo.set(seq, [...(repliesTo.get(seq) ?? []), m]);
  const decides = answersDecisions(state.members, me);
  const { decisions, escalations, questions } = asksFor(
    heldAsks(state).filter((m) => !m.permission),
    me,
    decides,
  );
  const askedOfMe = (m: Frozen<Message>): boolean =>
    !m.permission && m.from !== me && answersAsk(state.members, m, me) && (!m.to?.length || m.to.includes(me) || m.to.includes("*") || (decides && !!m.esc && !m.handoff));
  const waiting = new Set(state.openAsks.filter(askedOfMe).map((m) => m.seq));
  const counted = (m: Message, replies: readonly Message[]): readonly Message[] =>
    replies.filter((r) => !ignored(state.trust.get(r.seq)) && (!state.tapToAnswer || !m.esc || !!r.pick || !!r.stepReply));
  const stepAnswerOf = (m: Message): MessageView["stepAnswer"] => {
    const r = counted(m, repliesTo.get(m.seq) ?? []).find((x) => x.kind !== "event" && x.from !== m.from && answersAsk(state.members, m, x.from));
    return r ? { by: r.from, outcome: r.stepReply?.outcome ?? null } : null;
  };
  const root = rootOf(me, state.members);
  const myself = (name: string) => name === me || rootOf(name, state.members) === root;
  const here = placeFromKey(r.place) || roomOfKey(state, me, r.place) ? r.place : "main";
  const lead = state.lead && !myself(state.lead) ? state.lead : null;
  const stands = standsIn(r.messages, lead, myself);
  const hidden = hiddenBy(stands);
  const visible = r.messages.filter((m) => shownIn(m, state, here) && !hidden(m));
  const general = here === "main" ? visible : r.messages.filter((m) => shownIn(m, state, "main") && !hidden(m));
  const shown = visible.slice(-SHOWN);
  const nicknames = new Map([...state.members.values()].map((m) => [m.name, m.display || m.name]));
  const said = (text: string) => namedMarkdown(text, nicknames);
  const plain = (text: string) => named(preview(text), nicknames);

  const messageView = (m: Message, prev: Message | undefined): MessageView => {
    const re = m.re?.length === 1 ? m.re[0]! : null;
    const quoted = re !== null && prev?.seq !== re ? bySeq.get(re) : undefined;
    const chosen = m.choices?.length ? chosenOf(m, counted(m, repliesTo.get(m.seq) ?? []), decidersOf(state, m)) : undefined;
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
      mine: myself(m.from),
      quote: quoted && quoted.kind !== "event" ? { seq: quoted.seq, from: quoted.from, words: oneLine(plain(quoted.body), QUOTE_CHARS) } : null,
      choices: m.choices ?? [],
      chosen: chosen ? { choice: chosen.choice, by: chosen.by } : null,
      waiting: waiting.has(m.seq),
      step: m.step ?? null,
      stepAnswer: m.step ? stepAnswerOf(m) : null,
      images: m.imgs?.length ?? 0,
      task: place?.kind === "task" ? place.task : (m.task ?? null),
      reactions: chipsFor(state, m.seq, me, (name) => state.members.get(name)?.display ?? name),
    };
  };

  const messages = shown.map((m, i) => messageView(m, i > 0 ? shown[i - 1] : visible[visible.length - shown.length - 1]));
  const sideKey = leadChatKey(state, me);
  const sideAll = sideKey ? r.messages.filter((m) => shownIn(m, state, sideKey) && !hidden(m)) : [];
  const sideShown = sideAll.slice(-SHOWN);
  const side = sideShown.map((m, i) => messageView(m, i > 0 ? sideShown[i - 1] : sideAll[sideAll.length - sideShown.length - 1]));
  const lastChat = general.findLast((m) => m.kind !== "event");
  const lastIn = new Map<string, Message>();
  const countIn = new Map<string, number>();
  for (const m of r.messages) {
    if (m.kind === "event" || isQuiet(m) || ignored(state.trust.get(m.seq)) || hidden(m)) continue;
    const key = spotOf(state, m);
    lastIn.set(key, m);
    countIn.set(key, (countIn.get(key) ?? 0) + 1);
  }
  const nameOf = (name: string) => state.members.get(name)?.display ?? name;
  const keyOf = (m: Message) => spotOf(state, m);
  const roomKeys = roomKeysFor(state, me);
  const latest = lastPreview(
    r.messages.filter((m) => keyOf(m) !== sideKey && !hidden(m)),
    (seq) => state.trust.get(seq),
  );
  const latestIn = latest ? keyOf(latest) : "main";
  const rank = (key: string) => (key === "main" ? 0 : key === sideKey ? 1 : isRoomKey(key) ? 2 : 3);
  const roomPlace = (key: string): PlaceView | null => {
    const room = roomOfKey(state, me, key);
    if (!room) return null;
    const last = lastIn.get(key);
    return {
      key,
      kind: "room",
      title: room.name,
      with: [],
      withMe: true,
      task: null,
      lastSeq: last?.seq ?? 0,
      last: last ? messageView(last, undefined) : null,
      count: countIn.get(key) ?? 0,
      done: false,
    };
  };
  const placeView = (key: string): PlaceView | null => {
    if (isRoomKey(key)) return roomPlace(key);
    const p = placeFromKey(key);
    if (!p || (p.kind === "task" && key !== here && state.tasks.get(p.task)?.archived)) return null;
    const last = lastIn.get(key);
    const summary = p.kind === "main" ? undefined : state.places.get(key);
    const withMe = p.kind !== "dm" || p.with.includes(root);
    const title =
      p.kind === "main"
        ? r.title
        : p.kind === "task"
          ? `${taskId(p.task)} ${state.tasks.get(p.task)?.title ?? ""}`.trim()
          : withMe
            ? nameOf(p.with.find((n) => n !== root) ?? root)
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
      count: summary?.count ?? countIn.get(key) ?? 0,
      done: p.kind === "task" && (!!summary?.done || state.tasks.get(p.task)?.state === "done"),
    };
  };
  const others = [...state.places.keys(), ...lastIn.keys()].filter((k) => k !== "main" && k !== sideKey);
  const placeKeys = ["main", ...(sideKey ? [sideKey] : []), ...roomKeys, ...(here !== "main" ? [here] : []), ...others];
  const places = [...new Set(placeKeys)]
    .flatMap((k) => {
      const v = placeView(k);
      return v ? [v] : [];
    })
    .sort((a, b) => rank(a.key) - rank(b.key) || b.lastSeq - a.lastSeq);
  const tasks: TaskView[] = [...state.tasks.values()]
    .filter((t) => !t.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((t) => ({
      id: t.id,
      title: t.title,
      state: t.state === "landing" ? "review" : t.state,
      owner: t.owner ?? null,
      review: t.review ?? null,
      updatedAt: t.updatedAt,
      createdAt: t.createdAt,
      last: t.notes.at(-1)?.text ?? null,
      archived: !!t.archived,
      since: t.state === "doing" && t.owner && t.clock?.key.startsWith(`${t.owner}|work|`) ? t.clock.at : null,
    }));
  const asks: Frozen<AskView[]> = [...decisions, ...escalations, ...questions].map((m) => {
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
      place: spotOf(state, m),
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
    roomId: roomIdOf(r.code),
    title: r.title,
    icon: iconView(r.icon, r.title),
    me,
    root,
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
    needs: r.needs ?? [],
    last: lastChat ? messageView(lastChat, undefined) : null,
    latest: latest ? messageView(latest, undefined) : null,
    latestIn,
    place: here,
    places,
    stand: standView(standLabel(state, me, here), lead, stands, r.messages, plain, standBoard(tasks, standScope(state, me, here))),
  };
}
