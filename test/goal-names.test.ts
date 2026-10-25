import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { AgentLive, AgentSession } from "../src/agent.ts";
import { startRelay } from "../src/relay/bun.ts";
import { joinAgent, pairComputer, setupChannel } from "./owner.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { MAX_GOAL_NAME, wellFormed, type Event, type Message } from "@kiwi/core/protocol.ts";
import { fold, mayNameGoal, type ChannelState, type FoldBase, type Roster } from "@kiwi/core/state.ts";
import { describeEvent, formatTasks } from "@kiwi/core/format.ts";
import type { Persona } from "@kiwi/core/personality.ts";

setDefaultTimeout(60_000);

const T0 = 1_700_000_000_000;
const ids: Record<string, Identity> = {};
let roster: Roster;

type Draft = Omit<Message, "seq" | "rts" | "sigOk" | "v" | "id" | "ts" | "pk" | "sig">;

async function signedLog(drafts: Draft[]): Promise<Message[]> {
  const out: Message[] = [];
  for (const [i, d] of drafts.entries()) {
    const ts = T0 + i * 1_000;
    const p = await sign(ids[d.from]!, { v: 1 as const, id: crypto.randomUUID(), ts, ...d });
    out.push({ ...p, seq: i + 1, rts: ts, sigOk: await verify(p) } as Message);
  }
  return out;
}

const say = (from: string, body: string): Draft => ({ from, kind: "msg", body });
const ev = (from: string, e: Event): Draft => ({ from, kind: "event", body: "", ev: e });
const name = (from: string, ask: number, goal: string | null) => ev(from, { op: "ask.name", ask, name: goal });
const add = (title: string, re: number): Draft => ({ from: "lead", kind: "event", body: "", ev: { op: "task.add", title }, re: [re] });

const RAW = "ok so the appimage thing, can we make it actually start on fedora and arch?? stock installs";
const GOAL = "0.27.7: the AppImage runs on stock Fedora and Arch";

beforeAll(async () => {
  for (const n of ["jow", "ann", "lead", "dev"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jow", pk: ids.jow!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "ann", pk: ids.ann!.pk, owner: false, at: 0, active: true, kind: "human" },
    { name: "lead", pk: ids.lead!.pk, owner: false, at: 0, active: true, kind: "agent", role: "lead" },
    { name: "dev", pk: ids.dev!.pk, owner: false, at: 0, active: true, kind: "agent" },
  ];
});

const head = (s: ChannelState, id: number) => s.askHeads.get(id);

describe("a person's ask gets a goal in plain words", () => {
  test("the lead names it, the board heads its tasks with the goal and the person's words under it", async () => {
    const log = await signedLog([say("jow", RAW), add("start without the tray library", 1), name("lead", 1, GOAL)]);
    const s = fold(log, roster, T0);
    expect(head(s, 1)).toMatchObject({ id: 1, by: "jow", words: RAW, goal: GOAL, goalBy: "lead" });
    expect(s.rejected.get(3)).toBeUndefined();
    const board = formatTasks(s, {});
    expect(board).toContain(`${GOAL} (from #1 jow: “ok so the appimage thing, can we make it actually start on …”)`);
    expect(describeEvent(log[2]!, s)).toBe(`named the goal of #1: ${GOAL}`);
  });

  test("the owner renames it, the person who asked may too, null gives the header back to their words", async () => {
    const log = await signedLog([
      say("ann", RAW),
      add("start without the tray library", 1),
      name("lead", 1, GOAL),
      name("jow", 1, "  AppImage   starts on Fedora\nand Arch "),
      name("ann", 1, "Fedora and Arch"),
      name("ann", 1, null),
    ]);
    const steps = [3, 4, 5, 6].map((n) => head(fold(log.slice(0, n), roster, T0), 1)?.goal);
    expect(steps).toEqual([GOAL, "AppImage starts on Fedora and Arch", "Fedora and Arch", undefined]);
    const s = fold(log, roster, T0);
    expect(head(s, 1)).toEqual({ id: 1, by: "ann", words: RAW, at: T0 });
    expect(formatTasks(s, {})).toContain(`#1 ann: “${RAW}”`);
  });

  test("anyone else is refused, and so is a message no task is filed under or an empty name", async () => {
    const log = await signedLog([say("jow", RAW), add("a task", 1), name("dev", 1, "dev's name for it"), name("lead", 2, "not an ask"), name("lead", 1, " \n "), name("lead", 99, "nothing")]);
    const s = fold(log, roster, T0);
    expect(head(s, 1)?.goal).toBeUndefined();
    expect([3, 4, 5, 6].map((seq) => s.rejected.get(seq))).toEqual([
      "only the lead, the owner or the person who asked names a goal",
      "#2 isn't a person's message that tasks are filed under",
      "a goal needs a name",
      "#99 isn't a person's message that tasks are filed under",
    ]);
  });

  test("a long name is cut to the most a goal holds, and the wire refuses one far past it", async () => {
    const long = "a".repeat(MAX_GOAL_NAME + 20);
    const s = fold(await signedLog([say("jow", RAW), add("a task", 1), name("lead", 1, long)]), roster, T0);
    expect(head(s, 1)?.goal).toHaveLength(MAX_GOAL_NAME);
    const p = { v: 1, id: "x", from: "lead", kind: "event", body: "", ts: T0 };
    expect(wellFormed({ ...p, ev: { op: "ask.name", ask: 1, name: GOAL } })).toBe(true);
    expect(wellFormed({ ...p, ev: { op: "ask.name", ask: 1, name: "a".repeat(MAX_GOAL_NAME * 4 + 1) } })).toBe(false);
    expect(wellFormed({ ...p, ev: { op: "ask.name", ask: 0, name: GOAL } })).toBe(false);
  });

  test("the goal survives a fold from a kept base, and can be renamed after it", async () => {
    const first = await signedLog([say("jow", RAW), add("a task", 1), name("lead", 1, GOAL)]);
    let base: FoldBase | null = null;
    fold(first, roster, T0, null, null, null, (b) => void (base = b));
    expect(base!.askHeads?.find((h) => h.id === 1)?.goal).toBe(GOAL);
    const more = (await signedLog([say("jow", RAW), add("a task", 1), name("lead", 1, GOAL), name("jow", 1, "renamed")])).slice(3);
    expect(head(fold([], roster, T0, null, null, base), 1)?.goal).toBe(GOAL);
    expect(head(fold(more, roster, T0, null, null, base), 1)?.goal).toBe("renamed");
  });

  test("a lead by its signed persona names it too, as the app shows it", async () => {
    const persona: Persona = { name: "Lead", role: "lead", capabilities: [], areas: [], instructions: "" };
    const withPersona: Roster = roster.map((r) => (r.name === "dev" ? { ...r, persona } : r));
    const s = fold(await signedLog([say("jow", RAW), add("a task", 1), name("dev", 1, GOAL)]), withPersona, T0);
    expect(s.rejected.get(3)).toBeUndefined();
    expect(head(s, 1)?.goal).toBe(GOAL);
  });

  test("who may name it: the lead, the owner and the person who asked", async () => {
    const s = fold(await signedLog([say("ann", RAW), add("a task", 1)]), roster, T0);
    const h = head(s, 1)!;
    expect(["lead", "jow", "ann", "dev"].map((n) => mayNameGoal(s, n, h))).toEqual([true, true, true, false]);
  });
});

describe("naming a goal from a session", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-goal-relay-"));
  const home = mkdtempSync(join(tmpdir(), "kiwi-goal-home-"));
  const was = process.env.KIWI_HOME;
  let server: ReturnType<typeof startRelay>;
  const run = <A, E>(e: Effect.Effect<A, E, unknown>) => Effect.runPromise(e.pipe(Effect.provide(AgentLive)) as Effect.Effect<A, E, never>);
  let lead: AgentSession;
  let dev: AgentSession;
  let ask: number;

  beforeAll(async () => {
    process.env.KIWI_HOME = home;
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
    const owner = await setupChannel(server.url.origin, { ownerName: "jon" });
    const computer = await pairComputer(owner.person);
    const seat = async (name: string) => {
      const { id, ch } = await joinAgent(owner, name, computer);
      return new AgentSession("goal", { ...ch.access, relay: owner.relay, code: owner.code }, id, () => {});
    };
    lead = await seat("lead");
    dev = await seat("dev");
    await owner.ownerCh.send("lead is the lead", { kind: "event", ev: { op: "role.set", member: "lead", role: "lead" } });
    ask = await owner.ownerCh.send(RAW);
  });
  afterAll(() => {
    server.stop(true);
    if (was === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = was;
    for (const d of [dataDir, home]) rmSync(d, { recursive: true, force: true });
  });

  test("the lead names it while filing a task, renames it, and takes it back; a builder is told it can't", async () => {
    const t = await run(lead.taskAdd("start without the tray library", { re: ask }));
    expect((await run(lead.state())).state.tasks.get(t)?.ask).toBe(ask);
    expect((await run(lead.nameGoal(ask, GOAL))).goal).toBe(GOAL);
    await expect(run(dev.nameGoal(ask, "mine"))).rejects.toThrow("only the lead, the owner or the person who asked names a goal");
    await expect(run(lead.nameGoal(ask, " "))).rejects.toThrow(/a goal needs a name/);
    await expect(run(lead.nameGoal(ask, "x".repeat(MAX_GOAL_NAME + 1)))).rejects.toThrow(`at most ${MAX_GOAL_NAME} characters`);
    await expect(run(lead.nameGoal(t + 50, GOAL))).rejects.toThrow(`#${t + 50} isn't a person's message`);
    expect((await run(dev.state())).state.askHeads.get(ask)?.goal).toBe(GOAL);
    expect((await run(lead.nameGoal(ask, null))).goal).toBeUndefined();
  });
});
