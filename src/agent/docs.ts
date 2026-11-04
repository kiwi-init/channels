import type { Channel } from "@kiwi/core/client.ts";
import { agentBlock } from "@kiwi/core/doc/agent.ts";
import { threadText } from "@kiwi/core/doc/blocks.ts";
import type { ThreadDoc } from "@kiwi/core/doc/thread-doc.ts";
import { docThread } from "@kiwi/core/doc/threads.ts";
import { MAIN, type ChannelState } from "@kiwi/core/state.ts";
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

export function docPlaceOf(state: Pick<ChannelState, "docs">, where: Destination): DocPlace | null {
  if (where.dm || where.re?.length) return null;
  if (where.task === undefined && where.room && where.room.toLowerCase() !== "general") return null;
  const key = docThread(where.task === undefined ? MAIN : { kind: "task", task: where.task });
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
    if (Date.now() > until) throw new Error("the relay didn't take the doc update in time");
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

export const writeBlock = (ch: Channel, from: number, at: DocPlace, author: string, body: string, agent: boolean): Promise<string> =>
  inThreadDoc(ch, from, at, (td) => {
    const block = agentBlock(td.doc, author, agent ? "agent" : "text");
    block.write(body);
    block.end();
    return block.id;
  });

export const readDoc = (ch: Channel, from: number, at: DocPlace, ms = DOC_WAIT_MS): Promise<string> => inThreadDoc(ch, from, at, (td) => threadText(td.doc, (a) => a), ms);

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
