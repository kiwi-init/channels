import { describe, expect, test } from "bun:test";
import { newChannelKey, newRoomId } from "@kiwi/core/crypto.ts";
import { agentBlock, PRESENCE_FIELD, watchWakes, wakesMe, type DocWake, type WakeRule } from "@kiwi/core/doc/agent.ts";
import { appendToBlock, blocksOf, newBlock, newDocId, threadText } from "@kiwi/core/doc/blocks.ts";
import { ThreadDoc } from "@kiwi/core/doc/thread-doc.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";

const me = await generateIdentity("olivia");
const key = newChannelKey();

const room = () =>
  new ThreadDoc({
    roomId: newRoomId(),
    th: newDocId(),
    me,
    keys: { current: async () => ({ key }), at: async () => key },
    links: { send: () => {}, aware: () => {} },
  });

const watch = (w: ReturnType<typeof room>, rule: Partial<WakeRule> = {}) => {
  const wakes: DocWake[] = [];
  const stop = watchWakes(w, { me: "olivia", names: ["olivia"], owns: false, idleMs: 40, ...rule }, (x) => wakes.push(x));
  return { wakes, stop };
};

describe("an agent wakes for a finished block in the thread doc (T500)", () => {
  test("a mention wakes it once the author starts their next block; the wake carries the thread and the block", () => {
    const w = room();
    newBlock(w.doc, "text", "jow", "an old line before the agent listened");
    const { wakes, stop } = watch(w);
    const asked = newBlock(w.doc, "text", "jow", "@olivia can you look at the relay?");
    expect(wakes).toHaveLength(0);
    newBlock(w.doc, "text", "jow", "");
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

  test("3 s idle finishes a block; typing restarts the wait", async () => {
    const w = room();
    const { wakes, stop } = watch(w);
    const b = newBlock(w.doc, "text", "jow", "@olivia");
    await Bun.sleep(25);
    appendToBlock(w.doc, b.id, " still typing");
    await Bun.sleep(25);
    expect(wakes).toHaveLength(0);
    await Bun.sleep(40);
    expect(wakes.map((x) => x.block.text)).toEqual(["@olivia still typing"]);
    stop();
  });

  test("another author's block after it doesn't finish it: someone answering in place isn't the author ending theirs", async () => {
    const w = room();
    const { wakes, stop } = watch(w);
    newBlock(w.doc, "text", "jow", "@olivia first half");
    newBlock(w.doc, "text", "rodrigo", "a reply");
    expect(wakes).toHaveLength(0);
    await Bun.sleep(60);
    expect(wakes).toHaveLength(1);
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
      newBlock(w.doc, "text", author, "");
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
    newBlock(w.doc, "text", "jow", "");
    expect(wakes[0]!.selection).toEqual({ block: "b1", text: "this line" });
    stop();
  });

  test("blocks older than after wake when it's given; stop ends the watch", async () => {
    const w = room();
    newBlock(w.doc, "text", "jow", "@olivia while you were away", 100);
    newBlock(w.doc, "text", "rodrigo", "@olivia before that", 10);
    const { wakes, stop } = watch(w, { after: 50 });
    expect(wakes.map((x) => x.block.text)).toEqual([]);
    await Bun.sleep(60);
    expect(wakes.map((x) => x.block.text)).toEqual(["@olivia while you were away"]);
    stop();
    newBlock(w.doc, "text", "jow", "@olivia after stop");
    newBlock(w.doc, "text", "jow", "");
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
