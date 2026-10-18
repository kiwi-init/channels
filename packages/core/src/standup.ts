import { inlineText } from "./membership.ts";
import { MAIN, placeFromKey, placeKey, threadMembers, type ChannelState, type Task } from "./state.ts";
import type { Message } from "./protocol.ts";
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
