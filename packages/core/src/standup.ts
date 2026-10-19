import { inlineText } from "./membership.ts";
import { MAIN, placeFromKey, placeKey, threadMembers, type ChannelState, type Task } from "./state.ts";
import { GENERAL_ROOM, type Message } from "./protocol.ts";
import { textOf, visible } from "./work.ts";

const LAST_LINE_MAX = 140;

export interface LastLine {
  from: string;
  text: string;
  seq: number;
  at: number;
}

export interface Unread {
  n: number;
  forMe: boolean;
}

export interface LiveCard {
  task: Task;
  people: string[];
  said: number;
  lastLine?: LastLine;
  waiting: boolean;
}

const taskKey = (id: number): string => placeKey({ kind: "task", task: id });

export function taskRoom(state: ChannelState, messages: readonly Message[], id: number): string {
  const key = taskKey(id);
  const first = messages.find((m) => m.kind !== "event" && placeKey(state.placeOf.get(m.seq) ?? MAIN) === key);
  return (first && state.roomOf.get(first.seq)) ?? GENERAL_ROOM;
}

export function cardShown(state: ChannelState, messages: readonly Message[], id: number, room: string): boolean {
  return room === GENERAL_ROOM || taskRoom(state, messages, id) === room;
}

export function lastLine(state: ChannelState, messages: readonly Message[], id: number): LastLine | undefined {
  const key = taskKey(id);
  let note: Message | undefined;
  let chat: Message | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (!visible(state, m)) continue;
    if (m.kind === "event") {
      if (!note && m.ev?.op === "task.update" && m.ev.task === id && !!m.ev.note && !state.rejected.has(m.seq)) note = m;
      continue;
    }
    if (placeKey(state.placeOf.get(m.seq) ?? MAIN) !== key) continue;
    if (m.kind === "status") return line(m);
    chat ??= m;
  }
  const found = note ?? chat;
  return found ? line(found) : undefined;
}

function line(m: Message): LastLine {
  return { from: m.from, text: inlineText(textOf(m), LAST_LINE_MAX), seq: m.seq, at: m.rts ?? m.ts };
}

export function unreadIn(state: ChannelState, messages: readonly Message[], viewer: string, key: string, since: number): Unread {
  const place = placeFromKey(key) ?? MAIN;
  const mine = place.kind === "main" || (place.kind === "dm" ? place.with.includes(viewer) : threadMembers(state, place).includes(viewer));
  let n = 0;
  let named = 0;
  for (const m of messages) {
    if (m.seq <= since || m.kind === "event" || m.from === viewer || placeKey(state.placeOf.get(m.seq) ?? MAIN) !== key || !visible(state, m)) continue;
    n++;
    if (m.to?.includes(viewer)) named++;
  }
  return mine ? { n, forMe: n > 0 } : { n: named || n, forMe: named > 0 };
}

export function unreadAll(state: ChannelState, messages: readonly Message[], viewer: string, seen: Readonly<Record<string, number>>): (key: string) => Unread {
  const counts = new Map<string, { n: number; named: number }>();
  for (const m of messages) {
    if (m.kind === "event" || m.from === viewer || !visible(state, m)) continue;
    const key = placeKey(state.placeOf.get(m.seq) ?? MAIN);
    if (m.seq <= (seen[key] ?? 0)) continue;
    let c = counts.get(key);
    if (!c) counts.set(key, (c = { n: 0, named: 0 }));
    c.n++;
    if (m.to?.includes(viewer)) c.named++;
  }
  return (key) => {
    const { n, named } = counts.get(key) ?? { n: 0, named: 0 };
    const place = placeFromKey(key) ?? MAIN;
    const mine = place.kind === "main" || (place.kind === "dm" ? place.with.includes(viewer) : threadMembers(state, place).includes(viewer));
    return mine ? { n, forMe: n > 0 } : { n: named || n, forMe: named > 0 };
  };
}

export interface TaskCards {
  card(id: number, viewer: string): LiveCard | undefined;
  shown(id: number, room: string): boolean;
}

export function taskCards(state: ChannelState, messages: readonly Message[]): TaskCards {
  const first = new Map<number, number>();
  const said = new Map<number, number>();
  const status = new Map<number, Message>();
  const note = new Map<number, Message>();
  const chat = new Map<number, Message>();
  for (const m of messages) {
    if (m.kind === "event") {
      if (m.ev?.op === "task.update" && !!m.ev.note && visible(state, m) && !state.rejected.has(m.seq)) note.set(m.ev.task, m);
      continue;
    }
    const place = state.placeOf.get(m.seq);
    if (place?.kind !== "task") continue;
    const id = place.task;
    if (!first.has(id)) first.set(id, m.seq);
    if (!visible(state, m)) continue;
    said.set(id, (said.get(id) ?? 0) + 1);
    chat.set(id, m);
    if (m.kind === "status") status.set(id, m);
  }
  const roomOf = (id: number): string => {
    const seq = first.get(id);
    return (seq !== undefined ? state.roomOf.get(seq) : undefined) ?? GENERAL_ROOM;
  };
  return {
    card(id, viewer) {
      const task = state.tasks.get(id);
      if (!task) return undefined;
      const found = status.get(id) ?? note.get(id) ?? chat.get(id);
      return {
        task,
        people: [...new Set([task.owner, ...task.workedBy].filter((n): n is string => !!n))],
        said: said.get(id) ?? 0,
        ...(found ? { lastLine: line(found) } : {}),
        waiting: task.state === "review" && (task.review === viewer || (task.review === "*" && !task.workedBy.includes(viewer))),
      };
    },
    shown: (id, room) => room === GENERAL_ROOM || roomOf(id) === room,
  };
}

export function liveCard(state: ChannelState, messages: readonly Message[], id: number, viewer: string): LiveCard | undefined {
  const task = state.tasks.get(id);
  if (!task) return undefined;
  const key = taskKey(id);
  const said = messages.filter((m) => m.kind !== "event" && placeKey(state.placeOf.get(m.seq) ?? MAIN) === key && visible(state, m)).length;
  const last = lastLine(state, messages, id);
  return {
    task,
    people: [...new Set([task.owner, ...task.workedBy].filter((n): n is string => !!n))],
    said,
    ...(last ? { lastLine: last } : {}),
    waiting: task.state === "review" && (task.review === viewer || (task.review === "*" && !task.workedBy.includes(viewer))),
  };
}
