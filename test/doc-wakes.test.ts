import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newChannelKey, newRoomId } from "@kiwi/core/crypto.ts";
import { markSent, newBlock, newDocId } from "@kiwi/core/doc/blocks.ts";
import { ThreadDoc } from "@kiwi/core/doc/thread-doc.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import type { ChannelState, Task } from "@kiwi/core/state.ts";
import { docWakeLine } from "../src/agent/docs.ts";
import { addDocWake, docSeen, pendingDocWakes, tellDocWakes, type DocWakeItem } from "../src/config/doc-wakes.ts";
import { docFollows, followDocs } from "../src/daemon/doc-follow.ts";

const was = process.env.KIWI_HOME;
const dir = mkdtempSync(join(tmpdir(), "kiwi-doc-wakes-"));
beforeAll(() => {
  process.env.KIWI_HOME = dir;
});
afterAll(() => {
  if (was === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = was;
  rmSync(dir, { recursive: true, force: true });
});

const task = (id: number, t: Partial<Task>): Task => ({ id, title: `t${id}`, state: "doing", workedBy: [], ...t }) as Task;

const item = (block: string, extra: Partial<DocWakeItem> = {}): DocWakeItem => ({
  key: "task:7",
  th: "t".repeat(22),
  block,
  author: "jow",
  text: "@olivia look at this",
  context: "",
  selection: null,
  at: 1,
  ...extra,
});

describe("which doc threads an agent follows (T606)", () => {
  test("#general, and open task threads it owns, works on, posted in or reviews; owned ones first, done ones not at all", () => {
    const docs = new Map([
      ["main", "m".repeat(22)],
      ["task:1", "a".repeat(22)],
      ["task:2", "b".repeat(22)],
      ["task:3", "c".repeat(22)],
      ["task:4", "d".repeat(22)],
      ["task:5", "e".repeat(22)],
      ["room:x", "f".repeat(22)],
    ]);
    const tasks = new Map([
      [1, task(1, { owner: "rodrigo", workedBy: ["olivia"] })],
      [2, task(2, { owner: "olivia" })],
      [3, task(3, { owner: "olivia", state: "done" })],
      [4, task(4, { owner: "rodrigo" })],
      [5, task(5, { owner: "rodrigo", review: "olivia" })],
    ]);
    const state = { docs, tasks } as Pick<ChannelState, "docs" | "tasks">;
    expect(docFollows(state, "olivia")).toEqual([
      { key: "task:2", th: "b".repeat(22), owns: true },
      { key: "main", th: "m".repeat(22), owns: false },
      { key: "task:1", th: "a".repeat(22), owns: false },
      { key: "task:5", th: "e".repeat(22), owns: false },
    ]);
  });
});

describe("the doc wakes an agent hasn't been told yet (T606)", () => {
  test("a block is queued once; telling it clears it; a torn line doesn't lose the rest", () => {
    expect(addDocWake("ch", "olivia", item("b1"))).toBe(true);
    expect(addDocWake("ch", "olivia", item("b1"))).toBe(false);
    expect(addDocWake("ch", "olivia", item("b2", { at: 2 }))).toBe(true);
    expect(pendingDocWakes("ch", "olivia").map((w) => w.block)).toEqual(["b1", "b2"]);
    expect(pendingDocWakes("ch", "rodrigo")).toEqual([]);
    tellDocWakes("ch", "olivia", ["b1"]);
    expect(pendingDocWakes("ch", "olivia").map((w) => w.block)).toEqual(["b2"]);
    expect(addDocWake("ch", "olivia", item("b1"))).toBe(false);
    tellDocWakes("ch", "olivia", ["b2"]);
    expect(pendingDocWakes("ch", "olivia")).toEqual([]);
  });

  test("the line an agent reads names the doc, the author, what it's about, and how to answer", () => {
    const line = docWakeLine(item("b3", { selection: "the relay", context: "rodrigo: shipped it" }), "kiwi");
    expect(line.split("\n")).toEqual([
      "▸ jow in T7's shared doc: @olivia look at this",
      '  about: "the relay"',
      "  before it: rodrigo: shipped it",
      '  answer in the doc: kiwi send --to T7 "…" (kiwi show T7 has all of it)',
    ]);
    expect(docWakeLine(item("b4", { key: "main" }), "kiwi")).toContain(`kiwi send --to '#general' "…" (kiwi show general has all of it)`);
  });

  test("the answer command it suggests survives a shell: #general stays an argument, not a comment (T1353)", async () => {
    const said = /answer in the doc: kiwi (send .*) \(kiwi show/.exec(docWakeLine(item("b5", { key: "main" }), "kiwi"))?.[1] ?? "";
    const p = Bun.spawn(["sh", "-c", `printf '%s\\n' ${said}`], { stdout: "pipe" });
    expect((await new Response(p.stdout).text()).trim().split("\n")).toEqual(["send", "--to", "#general", "…"]);
  });

  test("a wake queued while another process tells the earlier ones is never lost (T3358)", async () => {
    const stop = join(dir, "race.stop");
    const teller = Bun.spawn(
      [
        process.execPath,
        "-e",
        `import { existsSync } from "node:fs";
         import { pendingDocWakes, tellDocWakes } from ${JSON.stringify(join(import.meta.dir, "../src/config/doc-wakes.ts"))};
         let last = false;
         while (!last) {
           last = existsSync(${JSON.stringify(stop)});
           tellDocWakes("race", "olivia", pendingDocWakes("race", "olivia").map((w) => w.block));
           await Bun.sleep(1);
         }`,
      ],
      { env: { ...process.env, KIWI_HOME: dir }, stdout: "ignore", stderr: "inherit" },
    );
    const blocks = Array.from({ length: 150 }, (_, i) => `race-${i}`);
    for (const b of blocks) {
      addDocWake("race", "olivia", item(b));
      await Bun.sleep(1);
    }
    await Bun.write(stop, "");
    expect(await teller.exited).toBe(0);
    const told = (await Bun.file(join(dir, "doc-wakes", "race", "olivia.told")).text()).split("\n");
    const pending = pendingDocWakes("race", "olivia").map((w) => w.block);
    expect(blocks.filter((b) => !told.includes(b) && !pending.includes(b))).toEqual([]);
  });
});

describe("the daemon's follower queues a wake for a finished block (T606)", () => {
  test("a mention in a followed doc lands in the queue once and wakes the seat; a doc it stops following is closed", async () => {
    const me = await generateIdentity("olivia");
    const key = newChannelKey();
    const th = newDocId();
    const td = new ThreadDoc({
      roomId: newRoomId(),
      th,
      me,
      keys: { current: async () => ({ key }), opening: async () => [key] },
      links: { send: () => {}, aware: () => {} },
    });
    const closed: string[] = [];
    let woke = 0;
    let state = { docs: new Map([["task:9", th]]), tasks: new Map([[9, task(9, { owner: "olivia" })]]) } as unknown as ChannelState;
    const f = followDocs(
      { alias: "follow", agent: "olivia", ch: { threadDoc: async () => td, closeDoc: (k: string) => void closed.push(k) } },
      async () => state,
      () => void woke++,
    );
    f.refresh(0);
    await Bun.sleep(30);
    expect(docSeen("follow", "olivia").docs[th]).toEqual({ cut: expect.any(Number), at: {} });
    newBlock(td.doc, "text", "jow", "what's left on T9?", Date.now() + 1);
    newBlock(td.doc, "text", "jow", "thanks", Date.now() + 2);
    expect(woke).toBe(1);
    expect(pendingDocWakes("follow", "olivia")).toEqual([expect.objectContaining({ key: "task:9", th, author: "jow", text: "what's left on T9?" })]);
    state = { docs: new Map([["task:9", th]]), tasks: new Map([[9, task(9, { owner: "olivia", state: "done" })]]) } as unknown as ChannelState;
    f.refresh(0);
    await Bun.sleep(30);
    expect(closed).toEqual(["task:9"]);
    f.stop();
    td.destroy();
  });

  test("a seat nobody can wake doesn't read the channel to follow docs, until a way to wake it shows up", async () => {
    let reads = 0;
    let wanted = false;
    const f = followDocs(
      { alias: "unwoken", agent: "olivia", ch: { threadDoc: async () => ({}) as ThreadDoc, closeDoc: () => {} } },
      async () => (reads++, { docs: new Map(), tasks: new Map() } as unknown as ChannelState),
      () => {},
      async () => wanted,
    );
    f.refresh(0);
    await Bun.sleep(30);
    expect(reads).toBe(0);
    wanted = true;
    f.refresh(0);
    await Bun.sleep(30);
    expect(reads).toBe(1);
    f.stop();
  });
});

describe("the daemon's doc cursor survives a restart (T1741)", async () => {
  const me = await generateIdentity("olivia");
  const key = newChannelKey();
  const T0 = 1_000_000;
  const room = () => {
    const th = newDocId();
    const td = new ThreadDoc({ roomId: newRoomId(), th, me, keys: { current: async () => ({ key }), opening: async () => [key] }, links: { send: () => {}, aware: () => {} } });
    return { th, td };
  };
  const run = async (alias: string, td: ThreadDoc, state: ChannelState, at: number) => {
    const f = followDocs(
      { alias, agent: "olivia", ch: { threadDoc: async () => td, closeDoc: () => {} } },
      async () => state,
      () => {},
      async () => true,
      () => at,
    );
    f.refresh(0);
    await Bun.sleep(30);
    return f;
  };
  const authors = (alias: string) => pendingDocWakes(alias, "olivia").map((w) => w.author);

  test("a line begun before one that woke the agent, but sent after a restart, still wakes it", async () => {
    const { th, td } = room();
    const state = { docs: new Map([["main", th]]), tasks: new Map() } as unknown as ChannelState;
    const first = await run("restart", td, state, T0);
    const ana = newBlock(td.doc, "text", "ana", "@olivia the relay keeps refusing snapshots", T0 + 10);
    markSent(td.doc, newBlock(td.doc, "text", "ben", "@olivia merged #1621", T0 + 20).id);
    expect(authors("restart")).toEqual(["ben"]);
    first.stop();
    markSent(td.doc, ana.id);
    const second = await run("restart", td, state, T0 + 100);
    expect(authors("restart")).toEqual(["ben", "ana"]);
    second.stop();
    td.destroy();
  });

  test("a line from a clock an hour fast doesn't hide others' lines after a restart", async () => {
    const { th, td } = room();
    const state = { docs: new Map([["main", th]]), tasks: new Map() } as unknown as ChannelState;
    const first = await run("skew", td, state, T0);
    markSent(td.doc, newBlock(td.doc, "text", "ben", "@olivia hi from a fast clock", T0 + 3_600_000).id);
    first.stop();
    const second = await run("skew", td, state, T0 + 60_000);
    markSent(td.doc, newBlock(td.doc, "text", "ana", "@olivia are you there?", T0 + 120_000).id);
    expect(authors("skew")).toEqual(["ben", "ana"]);
    second.stop();
    td.destroy();
  });

  test("a task doc first followed after a restart wakes its owner for a line written while the daemon was down, not for older ones", async () => {
    const { th, td } = room();
    const before = { docs: new Map(), tasks: new Map() } as unknown as ChannelState;
    const after = { docs: new Map([["task:9", th]]), tasks: new Map([[9, task(9, { owner: "olivia" })]]) } as unknown as ChannelState;
    markSent(td.doc, newBlock(td.doc, "text", "jow", "an old line", T0 - 10).id);
    const first = await run("newtask", td, before, T0);
    first.stop();
    markSent(td.doc, newBlock(td.doc, "text", "jow", "start with the relay, then the CLI", T0 + 30_000).id);
    const second = await run("newtask", td, after, T0 + 60_000);
    expect(pendingDocWakes("newtask", "olivia").map((w) => w.text)).toEqual(["start with the relay, then the CLI"]);
    second.stop();
    td.destroy();
  });

  test("history that reaches a newly followed doc late doesn't wake the agent; a restart doesn't wake it twice", async () => {
    const { th, td } = room();
    const state = { docs: new Map([["main", th]]), tasks: new Map() } as unknown as ChannelState;
    const first = await run("late", td, state, T0);
    markSent(td.doc, newBlock(td.doc, "text", "jow", "@olivia from last week", T0 - 600_000).id);
    markSent(td.doc, newBlock(td.doc, "text", "jow", "@olivia now", T0 + 10).id);
    first.stop();
    const second = await run("late", td, state, T0 + 100);
    expect(authors("late")).toEqual(["jow"]);
    expect(pendingDocWakes("late", "olivia").map((w) => w.text)).toEqual(["@olivia now"]);
    second.stop();
    td.destroy();
  });
});

describe("the wake's 'before it' (T1741)", () => {
  test("is the last finished line before the wake, never someone's unsent draft or an empty block", async () => {
    const me = await generateIdentity("olivia");
    const key = newChannelKey();
    const th = newDocId();
    const td = new ThreadDoc({ roomId: newRoomId(), th, me, keys: { current: async () => ({ key }), opening: async () => [key] }, links: { send: () => {}, aware: () => {} } });
    const state = { docs: new Map([["main", th]]), tasks: new Map() } as unknown as ChannelState;
    const T0 = 1_000_000;
    const f = followDocs(
      { alias: "context", agent: "olivia", ch: { threadDoc: async () => td, closeDoc: () => {} } },
      async () => state,
      () => {},
      async () => true,
      () => T0,
    );
    f.refresh(0);
    await Bun.sleep(30);
    markSent(td.doc, newBlock(td.doc, "text", "rodrigo", "shipped the relay fix", T0 + 1).id);
    markSent(td.doc, newBlock(td.doc, "text", "rodrigo", "", T0 + 2).id);
    newBlock(td.doc, "text", "maya", "honestly I think we should drop the vend", T0 + 5);
    markSent(td.doc, newBlock(td.doc, "text", "ben", "@olivia can you check the build?", T0 + 10).id);
    expect(pendingDocWakes("context", "olivia").map((w) => w.context)).toEqual(["rodrigo: shipped the relay fix"]);
    f.stop();
    td.destroy();
  });
});

describe("a task doc wakes everyone working the task, as its thread's messages do (T1741)", () => {
  test("a line without a mention wakes an agent that works on, reviews or posted in the task, not one in #general", async () => {
    const me = await generateIdentity("olivia");
    const key = newChannelKey();
    for (const [alias, t] of [
      ["worked", { owner: "rodrigo", workedBy: ["olivia"] }],
      ["reviews", { owner: "rodrigo", review: "olivia" }],
      ["posted", { owner: "rodrigo", posters: ["olivia"] }],
    ] satisfies [string, Partial<Task>][]) {
      const th = newDocId();
      const main = newDocId();
      const td = new ThreadDoc({ roomId: newRoomId(), th, me, keys: { current: async () => ({ key }), opening: async () => [key] }, links: { send: () => {}, aware: () => {} } });
      const gd = new ThreadDoc({ roomId: newRoomId(), th: main, me, keys: { current: async () => ({ key }), opening: async () => [key] }, links: { send: () => {}, aware: () => {} } });
      const state = {
        docs: new Map([
          ["main", main],
          ["task:9", th],
        ]),
        tasks: new Map([[9, task(9, t)]]),
      } as unknown as ChannelState;
      const f = followDocs(
        { alias, agent: "olivia", ch: { threadDoc: async (k: string) => (k === "main" ? gd : td), closeDoc: () => {} } },
        async () => state,
        () => {},
      );
      f.refresh(0);
      await Bun.sleep(30);
      markSent(td.doc, newBlock(td.doc, "text", "jow", "the relay half of T9 is blocked: wait before merging", Date.now() + 1).id);
      markSent(gd.doc, newBlock(gd.doc, "text", "jow", "lunch at one", Date.now() + 1).id);
      expect(pendingDocWakes(alias, "olivia").map((w) => w.text)).toEqual(["the relay half of T9 is blocked: wait before merging"]);
      f.stop();
      td.destroy();
      gd.destroy();
    }
  });
});
