import type { Channel } from "@kiwi/core/client.ts";
import { agentBlock } from "@kiwi/core/doc/agent.ts";
import { removeBlock, rewriteBlock, threadText, type BlockMedia } from "@kiwi/core/doc/blocks.ts";
import type { ThreadDoc } from "@kiwi/core/doc/thread-doc.ts";
import { docThread } from "@kiwi/core/doc/threads.ts";
import { GENERAL_ROOM } from "@kiwi/core/protocol.ts";
import { MAIN, type ChannelState, type Place } from "@kiwi/core/state.ts";
import type { DocWakeItem } from "../config/doc-wakes.ts";

const DOC_WAIT_MS = 15_000;
const SENT_POLL_MS = 20;

export interface DocPlace {
  key: string;
  th: string;
}

export interface Destination {
  task?: number;
  dm?: boolean;
  room?: string;
  re?: readonly number[];
}

function placeOfReply(state: Pick<ChannelState, "placeOf" | "roomOf">, seq: number): Place | null {
  const place = state.placeOf.get(seq) ?? MAIN;
  if (place.kind === "dm") return null;
  return place.kind === "main" && (state.roomOf.get(seq) ?? GENERAL_ROOM) !== GENERAL_ROOM ? null : place;
}

export function docPlaceOf(state: Pick<ChannelState, "docs" | "placeOf" | "roomOf">, where: Destination): DocPlace | null {
  if (where.dm) return null;
  const re = where.re?.[0];
  const place = re === undefined ? (where.task === undefined ? MAIN : { kind: "task" as const, task: where.task }) : placeOfReply(state, re);
  if (!place || (place.kind === "main" && where.room && where.room.toLowerCase() !== "general")) return null;
  const key = docThread(place);
  const th = state.docs.get(key);
  return th ? { key, th } : null;
}

async function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const late = new Promise<never>((_, fail) => {
    timer = setTimeout(() => fail(new Error(`${what} took over ${Math.round(ms / 1000)} s`)), ms);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function sent(td: ThreadDoc, until: number): Promise<void> {
  await td.flush();
  while (td.save().unsent) {
    if (Date.now() > until) throw new Error(`the relay didn't take the doc update in time${td.refused ? `: ${td.refused}` : ""}`);
    await new Promise((done) => setTimeout(done, SENT_POLL_MS));
  }
}

async function inThreadDoc<T>(ch: Channel, from: number, at: DocPlace, work: (td: ThreadDoc) => T, ms = DOC_WAIT_MS): Promise<T> {
  const until = Date.now() + ms;
  const stop = new AbortController();
  const streaming = new Promise<void>((ready, fail) => {
    ch.stream(from, () => {}, { signal: stop.signal, onReady: () => ready() }).then(
      () => fail(new Error("the channel's socket closed")),
      (e: unknown) => fail(e instanceof Error ? e : new Error("the channel's socket failed")),
    );
  });
  try {
    await within(streaming, ms, "opening the channel's socket");
    const td = await ch.threadDoc(at.key, at.th);
    await within(td.whenSynced(), Math.max(1, until - Date.now()), "reading the thread's doc");
    const out = work(td);
    await sent(td, until);
    return out;
  } finally {
    ch.closeDoc(at.key);
    stop.abort();
  }
}

export const writeBlock = (ch: Channel, from: number, at: DocPlace, author: string, body: string, agent: boolean, posted = false, media: readonly BlockMedia[] = []): Promise<string> =>
  inThreadDoc(ch, from, at, (td) => {
    const block = agentBlock(td.doc, author, agent ? "agent" : "text");
    block.write(body);
    block.attach(media);
    if (posted) block.post();
    else block.end();
    return block.id;
  });

export const dropBlock = (ch: Channel, from: number, at: DocPlace, id: string): Promise<boolean> => inThreadDoc(ch, from, at, (td) => removeBlock(td.doc, id));

export const editBlock = (ch: Channel, from: number, at: DocPlace, id: string, text: string): Promise<boolean> => inThreadDoc(ch, from, at, (td) => rewriteBlock(td.doc, id, text));

export function docPlaceOfBlock(state: Pick<ChannelState, "docs">, th: string): DocPlace | null {
  for (const [key, id] of state.docs) if (id === th) return { key, th };
  return null;
}

export const readDoc = (ch: Channel, from: number, at: DocPlace, ms = DOC_WAIT_MS, drafts = false): Promise<string> =>
  inThreadDoc(ch, from, at, (td) => threadText(td.doc, (a) => a, drafts ? (b) => !b.posted : undefined), ms);

const LINE_TEXT = 800;
const LINE_CONTEXT = 400;
const LINE_SELECTION = 200;

function placeName(key: string): string {
  if (key === "main") return "#general";
  const t = /^task:(\d+)$/.exec(key);
  return t ? `T${t[1]}` : key;
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)} …` : s);

function wakeLines(w: DocWakeItem): string[] {
  const lines = [`▸ ${w.author} in ${placeName(w.key)}'s shared doc: ${clip(w.text.trim(), LINE_TEXT)}`];
  if (w.selection) lines.push(`  about: "${clip(w.selection.trim(), LINE_SELECTION)}"`);
  if (w.context.trim()) lines.push(`  before it: ${clip(w.context.trim(), LINE_CONTEXT)}`);
  return lines;
}

export function docWakeLine(w: DocWakeItem, mc: string): string {
  const where = placeName(w.key);
  return [...wakeLines(w), `  answer in the doc: ${mc} send --to ${where} "…" (${mc} show ${where === "#general" ? "general" : where} has all of it)`].join("\n");
}

export function docWakeToolLine(w: DocWakeItem): string {
  const where = placeName(w.key);
  const to = where === "#general" ? '"main":true' : `"task":"${where}"`;
  return [...wakeLines(w), `  answer in the doc: send {"text":"…",${to}}`].join("\n");
}
