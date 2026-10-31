import { useEffect, useEffectEvent, useSyncExternalStore } from "react";
import { bridge } from "@kiwi/secrets/secrets.ts";
import { pendingWrite, writeLater } from "./write-behind.ts";

// What's new where. For each channel this browser keeps the last seq it saw there, and how many
// questions there were waiting on this person when they last looked. A closed channel can only say
// "new" (the listing carries its head, not its messages); the open one counts exactly.

/** One channel, as this browser last saw it. */
export interface Mark {
  /** The newest seq seen while the channel was open and in view. */
  seen: number;
  /** Questions to this person still unanswered when they left. */
  needs: number;
}

/** The open channel, counted from its messages (only what reaches this person). */
export interface OpenNews {
  room: string;
  /** Arrived while this tab was in the background, or in a room of it that isn't in view. */
  unread: number;
  needs: number;
  mentions: number;
}

/** Put polled heads onto list rows so unread dots can compare `head` to the mark. */
export function withHeads<T extends { room: string; head?: number }>(rows: T[], heads: Record<string, number>): T[] {
  return rows.map((r) => (heads[r.room] !== undefined ? { ...r, head: heads[r.room] } : r));
}

/** What a row in the channel list shows. */
export interface RowNews {
  /** This is the open channel. */
  open: boolean;
  /** Something arrived since this browser last looked. */
  fresh: boolean;
  /** Exact, for the open channel only. */
  count: number;
  needs: number;
  mentions: number;
}

const KEY = "mc.news";
const listeners = new Set<() => void>();
let marks: Record<string, Mark> | null = null;
let open: OpenNews | null = null;

function readMarks(): Record<string, Mark> {
  if (!marks) {
    try {
      marks = (JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Mark>) ?? {};
    } catch {
      marks = {};
    }
  }
  return marks;
}

function emit() {
  for (const l of listeners) l();
}

function writeMark(room: string, next: Mark) {
  marks = { ...readMarks(), [room]: next };
  writeLater(KEY, JSON.stringify(marks));
  emit();
}

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

if (typeof window !== "undefined") {
  // Another tab read a channel: its dot goes here too.
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY || pendingWrite(KEY) !== undefined) return;
    marks = null;
    emit();
  });
}

/** The channel was in view up to `seq`, with `needs` questions waiting on this person. */
export function markSeen(room: string, seq: number, needs: number) {
  const prev = readMarks()[room];
  if (prev && prev.seen >= seq && prev.needs === needs) return;
  writeMark(room, { seen: Math.max(prev?.seen ?? 0, seq), needs });
}

/** A channel seen for the first time starts with nothing new: its first listing isn't a backlog. */
export function startMarks(heads: { room: string; head?: number }[]) {
  const known = readMarks();
  const fresh = heads.filter((h) => h.head !== undefined && !known[h.room]);
  if (!fresh.length) return;
  marks = { ...known, ...Object.fromEntries(fresh.map((h) => [h.room, { seen: h.head!, needs: 0 }])) };
  writeLater(KEY, JSON.stringify(marks));
  emit();
}

export function setOpenNews(next: OpenNews | null) {
  if (open === next || (open && next && open.room === next.room && open.unread === next.unread && open.needs === next.needs && open.mentions === next.mentions)) return;
  open = next;
  emit();
}

export const useMarks = () => useSyncExternalStore(subscribe, readMarks);
export const useOpenNews = () => useSyncExternalStore(subscribe, () => open);

/** What a channel row shows: the open channel counts, the others compare their head with the mark. */
export function rowNews(row: { room: string; head?: number }, marks: Record<string, Mark>, open: OpenNews | null): RowNews {
  if (open?.room === row.room) return { open: true, fresh: open.unread > 0, count: open.unread, needs: open.needs, mentions: open.mentions };
  const mark = marks[row.room];
  return { open: false, fresh: !!mark && row.head !== undefined && row.head > mark.seen, count: 0, needs: mark?.needs ?? 0, mentions: 0 };
}

/** The tab's number: what's unread in the open channel, plus one for each other channel with news. */
export function newsTotal(news: RowNews[]): number {
  return news.reduce((n, r) => n + (r.open ? r.count : r.fresh || r.needs ? 1 : 0), 0);
}

export function badgeTotal(news: RowNews[], notify: "all" | "mentions" | "none"): number {
  if (notify === "none") return 0;
  if (notify === "all") return newsTotal(news);
  return news.reduce((n, r) => n + (r.open ? r.mentions + r.needs : r.needs ? 1 : 0), 0);
}

/** The next channel with news after `from`, going `dir` through the list and around. */
export function nextWithNews<T>(rows: T[], news: Pick<RowNews, "open" | "fresh" | "needs">[], from: number, dir: 1 | -1): T | null {
  const len = rows.length;
  // Nothing open: start just outside the list, so the first step lands on its first (or last) row.
  if (from < 0) from = dir === 1 ? -1 : len;
  for (let i = 1; i <= len; i++) {
    const at = (((from + dir * i) % len) + len) % len;
    const n = news[at]!;
    if (at !== from && !n.open && (n.fresh || n.needs)) return rows[at]!;
  }
  return null;
}

/** The total in the tab: its title, and a dot on its icon. */
export function useTabNews(total: number, badge: number) {
  useEffect(() => {
    document.title = total > 0 ? `(${total}) Channels` : "Channels";
    void markIcon(total > 0);
  }, [total]);
  useEffect(() => {
    void bridge()
      ?.setBadge(badge)
      .catch(() => undefined);
  }, [badge]);
}

let plainIcon: string | null = null;
let iconTurn = 0;
async function markIcon(on: boolean) {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  plainIcon ??= link.href;
  const turn = ++iconTurn;
  if (!on) {
    link.href = plainIcon;
    return;
  }
  const img = new Image();
  img.src = plainIcon;
  try {
    await img.decode();
  } catch {
    return;
  }
  if (turn !== iconTurn) return;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  if (!g) return;
  g.drawImage(img, 0, 0, 64, 64);
  // A dark dot in a light ring, top right: reads on any tab strip.
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(50, 14, 14, 0, 2 * Math.PI);
  g.fill();
  g.fillStyle = "#18181b";
  g.beginPath();
  g.arc(50, 14, 10, 0, 2 * Math.PI);
  g.fill();
  link.href = c.toDataURL("image/png");
}

/** Alt+↓ / Alt+↑: the next (or previous) channel with news. */
export function useNewsKeys<T>(rows: T[], news: RowNews[], current: number, open: (row: T) => void) {
  const go = useEffectEvent((dir: 1 | -1) => {
    const next = nextWithNews(rows, news, current, dir);
    if (next) open(next);
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
      // Ahead of whatever has focus: an arrow on a menu button would open its menu instead.
      e.preventDefault();
      e.stopPropagation();
      go(e.key === "ArrowDown" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}
