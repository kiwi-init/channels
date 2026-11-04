import { describe, expect, test } from "bun:test";
import { newChannelKey, newRoomId } from "@kiwi/core/crypto.ts";
import { agentBlock, PRESENCE_FIELD, watchWakes, wakesMe, type DocWake, type WakeRule } from "@kiwi/core/doc/agent.ts";
import { appendToBlock, blocksOf, markBack, markPosted, newBlock, newDocId, threadText } from "@kiwi/core/doc/blocks.ts";
import { ThreadDoc } from "@kiwi/core/doc/thread-doc.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import { wants } from "../src/agent/wants.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";

const me = await generateIdentity("olivia");
const key = newChannelKey();

const room = () =>
  new ThreadDoc({
    roomId: newRoomId(),
    th: newDocId(),
    me,
    keys: { current: async () => ({ key }), opening: async () => [key] },
    links: { send: () => {}, aware: () => {} },
  });

const watch = (w: ReturnType<typeof room>, rule: Partial<WakeRule> = {}) => {
  const wakes: DocWake[] = [];
  const stop = watchWakes(w, { me: "olivia", names: ["olivia"], owns: false, ...rule }, (x) => wakes.push(x));
  return { wakes, stop };
};

describe("an agent wakes for a finished block in the thread doc (T500)", () => {
  test("a mention wakes it once the author writes their next line; the wake carries the thread and the block", () => {
    const w = room();
    newBlock(w.doc, "text", "jow", "an old line before the agent listened");
    const { wakes, stop } = watch(w);
    const asked = newBlock(w.doc, "text", "jow", "@olivia can you look at the relay?");
    expect(wakes).toHaveLength(0);
    const next = newBlock(w.doc, "text", "jow", "");
    expect(wakes).toHaveLength(0);
    appendToBlock(w.doc, next.id, "and the CLI");
    expect(wakes).toHaveLength(1);
    expect(wakes[0]!.block).toMatchObject({ id: asked.id, author: "jow", text: "@olivia can you look at the relay?" });
    expect(wakes[0]!.thread).toBe(threadText(w.doc));
    expect(wakes[0]!.thread).toContain("an old line before the agent listened");
    expect(wakes[0]!.selection).toBeNull();
    appendToBlock(w.doc, asked.id, " also the CLI");
    newBlock(w.doc, "text", "jow", "more");
    expect(wakes).toHaveLength(1);
    stop();
  });

  test("a draft never wakes it, however long it sits, nor does an empty line after it from the author's other window: only their next line sends it (T2106)", async () => {
    const w = room();
    const { wakes, stop } = watch(w);
    const b = newBlock(w.doc, "text", "jow", "@olivia");
    const other = newBlock(w.doc, "text", "jow", "");
    appendToBlock(w.doc, b.id, " still typing");
    await Bun.sleep(50);
    expect(wakes).toHaveLength(0);
    appendToBlock(w.doc, other.id, "sent from the other window");
    expect(wakes.map((x) => x.block.text)).toEqual(["@olivia still typing"]);
    stop();
  });

  test("an agent's block wakes it once the agent ends it: a whole send at once, a stream when it ends", () => {
    const w = room();
    const { wakes, stop } = watch(w);
    const sent = agentBlock(w.doc, "atlas");
    sent.write("@olivia the relay is merged");
    sent.end();
    expect(wakes.map((x) => x.block.text)).toEqual(["@olivia the relay is merged"]);
    const streaming = agentBlock(w.doc, "rodrigo");
    streaming.write("@olivia looking");
    streaming.write(" at the CLI");
    expect(wakes).toHaveLength(1);
    streaming.end();
    expect(wakes.map((x) => x.block.text)).toEqual(["@olivia the relay is merged", "@olivia looking at the CLI"]);
    stop();
  });

  test("a block a message carries wakes nobody from the doc, since the message wakes them; a block from a 2026.11.7 sender, with no message, still does (T1388)", () => {
    const w = room();
    const { wakes, stop } = watch(w, { owns: true });
    const posted = agentBlock(w.doc, "atlas");
    posted.write("@olivia the relay is merged");
    posted.post();
    expect(blocksOf(w.doc).find((b) => b.id === posted.id)).toMatchObject({ sent: true, posted: true });
    expect(wakes).toHaveLength(0);
    const old = agentBlock(w.doc, "atlas");
    old.write("@olivia and the CLI");
    old.end();
    expect(wakes.map((x) => x.block.text)).toEqual(["@olivia and the CLI"]);
    stop();
  });

  test("a line given back to its author as a draft wakes nobody, whatever they write after it, until they send it again (T1678)", () => {
    const w = room();
    const { wakes, stop } = watch(w, { owns: true });
    const asked = newBlock(w.doc, "text", "jow", "@olivia ship it");
    markPosted(w.doc, asked.id);
    const next = newBlock(w.doc, "text", "jow", "");
    markBack(w.doc, asked.id);
    appendToBlock(w.doc, next.id, "next line");
    newBlock(w.doc, "text", "jow", "and on");
    expect(blocksOf(w.doc).find((b) => b.id === asked.id)).toMatchObject({ back: true });
    expect(wakes.map((x) => x.block.id)).toEqual([next.id]);
    markPosted(w.doc, asked.id);
    expect(blocksOf(w.doc).find((b) => b.id === asked.id)?.back).toBeUndefined();
    expect(wakes.map((x) => x.block.id)).toEqual([next.id]);
    stop();
  });

  test("another author's block after it doesn't finish it; the author's own next block does, even with others between", async () => {
    const w = room();
    const { wakes, stop } = watch(w);
    newBlock(w.doc, "text", "jow", "@olivia first half");
    newBlock(w.doc, "text", "rodrigo", "a reply");
    await Bun.sleep(50);
    expect(wakes).toHaveLength(0);
    newBlock(w.doc, "text", "jow", "second half");
    expect(wakes.map((x) => x.block.text)).toEqual(["@olivia first half"]);
    stop();
  });

  test("no wake: its own block, a tool block, an empty block, a mention of someone else; in a task it owns, any block by another wakes it", () => {
    const w = room();
    const { wakes, stop } = watch(w);
    for (const [kind, author, text] of [
      ["text", "olivia", "@olivia note to self"],
      ["tool", "jow", "@olivia ran bun test"],
      ["text", "jow", "  "],
      ["text", "jow", "@oliviana not you"],
    ] as const) {
      newBlock(w.doc, kind, author, text);
      newBlock(w.doc, "text", author, "next");
    }
    expect(wakes).toHaveLength(0);
    stop();

    expect(wakesMe({ id: "a", kind: "text", author: "jow", at: 1, text: "no mention" }, { me: "olivia", names: ["olivia"], owns: true })).toBe(true);
    expect(wakesMe({ id: "b", kind: "agent", author: "warm-orca", at: 1, text: "@Olivia over to you" }, { me: "olivia", names: ["olivia"], owns: false })).toBe(true);
  });

  test("the author's selection, from their presence, rides the wake", () => {
    const w = room();
    w.awareness.states.set(7, { [PRESENCE_FIELD]: { author: "jow", selection: { block: "b1", text: "this line" } } });
    const { wakes, stop } = watch(w);
    newBlock(w.doc, "text", "jow", "@olivia what does this do?");
    newBlock(w.doc, "text", "jow", "next");
    expect(wakes[0]!.selection).toEqual({ block: "b1", text: "this line" });
    stop();
  });

  test("a block sent while it was away wakes it unless it's known; stop ends the watch", () => {
    const w = room();
    newBlock(w.doc, "text", "jow", "@olivia while you were away", 100);
    newBlock(w.doc, "text", "rodrigo", "@olivia before that", 10);
    newBlock(w.doc, "text", "rodrigo", "and then", 11);
    newBlock(w.doc, "text", "jow", "and then", 101);
    const { wakes, stop } = watch(w, { known: (b) => b.at <= 50 });
    expect(wakes.map((x) => x.block.text)).toEqual(["@olivia while you were away"]);
    stop();
    newBlock(w.doc, "text", "jow", "@olivia after stop");
    newBlock(w.doc, "text", "jow", "next");
    expect(wakes).toHaveLength(1);
  });
});

describe("an agent streams its answer into its own block (T500)", () => {
  test("chunks land in one agent block, and lines become paragraphs", () => {
    const { doc: a } = room();
    newBlock(a, "text", "jow", "@olivia hi");
    const out = agentBlock(a, "olivia");
    for (const chunk of ["Looking", " at it", ".\nFirst: the relay", "\n\nDone."]) expect(out.write(chunk)).toBe(true);
    expect(out.write("")).toBe(false);
    const mine = blocksOf(a).find((x) => x.id === out.id);
    expect(mine).toMatchObject({ kind: "agent", author: "olivia", text: "Looking at it.\nFirst: the relay\n\nDone." });
    expect(threadText(a)).toBe("jow: @olivia hi\n\nolivia (agent): Looking at it.\nFirst: the relay\n\nDone.");
  });
});

describe("a quoted mention wakes nobody, in the doc or as a message (T1741)", () => {
  test("jow quotes atlas's '@olivia can you review #1621?' and writes 'I'll review it myself': neither the doc line nor its message wakes olivia", () => {
    const quote = "@olivia can you review #1621?";
    const block = { id: "b1", kind: "text" as const, author: "jow", at: 1, sent: true as const, re: 40, quote, text: "I'll review it myself" };
    const body = `> ${quote}\n\nI'll review it myself`;
    const m = { v: 1, id: "x", seq: 41, from: "jow", kind: "msg", ts: 1, re: [40], to: ["atlas"], body } as unknown as Message;
    expect(wakesMe(block, { me: "olivia", names: ["olivia"], owns: false })).toBe(false);
    expect(wants("olivia", m, null, {})).toBe(false);
    const asked = { ...m, body: `> ${quote}\n\n@olivia yes please` } as Message;
    expect(wants("olivia", asked, null, {})).toBe(true);
  });
});
