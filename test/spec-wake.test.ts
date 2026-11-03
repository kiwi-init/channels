import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { AgentLive, AgentSession } from "../src/agent.ts";
import { wants } from "../src/agent/wants.ts";
import { startRelay } from "../src/relay/bun.ts";
import { joinAgent, pairComputer, setupChannel } from "./owner.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, Message } from "@kiwi/core/protocol.ts";
import { describeEvent, formatMessage, formatStatus } from "@kiwi/core/format.ts";
import { reentryText } from "@kiwi/core/reentry.ts";
import { fold, onSpec, specPlanner, tickDoneWhen, type ChannelState, type Roster } from "@kiwi/core/state.ts";

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

const say = (from: string, body: string, re?: number, to?: string[]): Draft => ({ from, kind: "msg", body, ...(re ? { re: [re] } : {}), ...(to ? { to } : {}) });
const ev = (from: string, e: Event, re?: number): Draft => ({ from, kind: "event", body: "", ev: e, ...(re ? { re: [re] } : {}) });
const write = (from: string, ask: number, text: string) => ev(from, { op: "spec.set", ask, text });
const approve = (from: string, ask: number, v: number) => ev(from, { op: "spec.approve", ask, v });
const back = (from: string, ask: number, note: string) => ev(from, { op: "spec.result", ask, verdict: "back", note });

const SPEC = ["# Export annotations as CSV", "", "## Done when", "- [ ] PR merged with ci-ok", "- [ ] Ana OKs a sample file"].join("\n");
const ticked = (): string => {
  const r = tickDoneWhen(SPEC, "PR merged");
  if ("why" in r) throw new Error(r.why);
  return r.text;
};

const AGENTS = ["lead", "dev", "ops", "kim"] as const;

beforeAll(async () => {
  for (const n of ["ana", "bea", ...AGENTS]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "ana", pk: ids.ana!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "bea", pk: ids.bea!.pk, owner: false, at: 0, active: true, kind: "human" },
    { name: "lead", pk: ids.lead!.pk, owner: false, at: 0, active: true, kind: "agent", role: "lead" },
    { name: "dev", pk: ids.dev!.pk, owner: false, at: 0, active: true, kind: "agent" },
    { name: "ops", pk: ids.ops!.pk, owner: false, at: 0, active: true, kind: "agent" },
    { name: "kim", pk: ids.kim!.pk, owner: false, at: 0, active: true, kind: "agent" },
  ];
});

const woken = (log: Message[], seq: number): string[] => {
  const s = fold(log.slice(0, seq), roster, T0);
  return AGENTS.filter((a) => wants(a, log[seq - 1]!, s));
};

describe("a spec's comments and approvals reach everyone on it", () => {
  const steps = [
    say("ana", "export please"),
    write("lead", 1, SPEC),
    say("ops", "> PR merged with ci-ok\n\nwhich branch does it go to?", 1, ["ana"]),
    approve("ana", 1, 2),
    ev("dev", { op: "task.add", title: "csv writer" }, 1),
    ev("dev", { op: "task.claim", task: 5 }),
    say("ana", "and gzip it too?", 1, ["ops"]),
    write("lead", 1, ticked()),
    write("ana", 1, `${ticked()}\n- [ ] the file is gzipped`),
    approve("ops", 1, 9),
    back("ana", 1, "no gzip yet"),
  ];

  test("the people on a spec: who asked, who wrote, edited or commented, its tasks' owners, and the lead", async () => {
    const log = await signedLog(steps);
    expect([...onSpec(fold(log.slice(0, 3), roster, T0), 1)].sort()).toEqual(["ana", "lead", "ops"]);
    expect([...onSpec(fold(log, roster, T0), 1)].sort()).toEqual(["ana", "dev", "lead", "ops"]);
  });

  test("who each one wakes: a comment wakes the spec's people, an approval and a send back also the free agents, a tick nobody", async () => {
    const log = await signedLog(steps);
    expect(woken(log, 3)).toEqual(["lead"]);
    expect(woken(log, 4)).toEqual(["lead", "dev", "ops", "kim"]);
    expect(woken(log, 7)).toEqual(["lead", "dev", "ops"]);
    expect(woken(log, 8)).toEqual([]);
    expect(woken(log, 9)).toEqual(["lead", "dev", "ops"]);
    expect(woken(log, 10)).toEqual([]);
    expect(woken(log, 11)).toEqual(["lead", "dev", "ops", "kim"]);
  });

  test("an approval that waits for an agent tells the lead and the free agents how to take it, and a busy one only the news", async () => {
    const log = await signedLog([...steps.slice(0, 4)]);
    const s = fold(log, roster, T0);
    const approval = log[3]!;
    expect(formatMessage(approval, undefined, s, "kim")).toContain("approved the spec of #1: agents start it as soon as one is free; it waits for an agent, so take it now: kiwi spec start 1");
    expect(formatMessage(approval, undefined, s, "lead")).toContain("kiwi spec start 1");
    const working = await signedLog(steps.slice(0, 6));
    expect(formatMessage(working[3]!, undefined, fold(working, roster, T0), "kim")).not.toContain("kiwi spec start");
  });

  test("a comment says it's on the spec, and an edit after approval says a person approves it again", async () => {
    const log = await signedLog(steps.slice(0, 9));
    const s = fold(log, roster, T0);
    expect(formatMessage(log[2]!, undefined, s, "lead")).toStartWith("#3 ops → ana comment on #1's spec: > PR merged with ci-ok");
    expect(formatMessage(log[6]!, undefined, s, "dev")).toStartWith("#7 ana (human, owner) → ops comment on #1's spec: and gzip it too?");
    expect(describeEvent(log[7]!, s)).toBe("wrote the spec of #1: Export annotations as CSV");
    expect(describeEvent(log[8]!, s)).toBe("changed #1's approved spec, so a person approves the change: Export annotations as CSV");
  });

  test("status and the session's first look list the comments waiting for an answer, until the agent answers", async () => {
    const log = await signedLog([...steps.slice(0, 7), say("dev", "gzip is a follow-up", 7)]);
    const before = fold(log.slice(0, 7), roster, T0);
    const line = 'a comment waits for your answer: #7 (kiwi show 1; answer with kiwi spec comment 1 "…")';
    expect(formatStatus({ alias: "ch", me: "dev", state: before, online: new Map(), unread: 0, now: T0 })).toContain(`    ${line}`);
    expect(reentryText(before, "dev", T0)).toContain(`#1's spec “Export annotations as CSV”: ${line}`);
    expect(formatStatus({ alias: "ch", me: "kim", state: before, online: new Map(), unread: 0, now: T0 })).not.toContain("waits for your answer");
    const after = fold(log, roster, T0);
    expect(formatStatus({ alias: "ch", me: "dev", state: after, online: new Map(), unread: 0, now: T0 })).not.toContain("waits for your answer");
    expect(formatStatus({ alias: "ch", me: "ops", state: after, online: new Map(), unread: 0, now: T0 })).toContain("a comment waits for your answer: #8 (kiwi show 1");
  });
});

describe("in a channel, an approved spec gets started without anyone asking", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-spec-wake-relay-"));
  const home = mkdtempSync(join(tmpdir(), "kiwi-spec-wake-home-"));
  const was = process.env.KIWI_HOME;
  let server: ReturnType<typeof startRelay>;
  const run = <A, E>(e: Effect.Effect<A, E, unknown>) => Effect.runPromise(e.pipe(Effect.provide(AgentLive)) as Effect.Effect<A, E, never>);
  const lines = async (s: AgentSession): Promise<string[]> => {
    const { messages, state } = await run(s.read());
    return messages.map((m) => formatMessage(m, state.trust.get(m.seq), state, s.me));
  };
  let lead: AgentSession;
  let dev: AgentSession;
  let owner: Awaited<ReturnType<typeof setupChannel>>;

  beforeAll(async () => {
    process.env.KIWI_HOME = home;
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
    owner = await setupChannel(server.url.origin, { ownerName: "jon" });
    const computer = await pairComputer(owner.person);
    const seat = async (name: string) => {
      const { id, ch } = await joinAgent(owner, name, computer);
      return new AgentSession("specwake", { ...ch.access, relay: owner.relay, code: owner.code }, id, () => {});
    };
    lead = await seat("lead");
    dev = await seat("dev");
    await owner.ownerCh.send("lead is the lead", { kind: "event", ev: { op: "role.set", member: "lead", role: "lead" } });
  });
  afterAll(() => {
    server.stop(true);
    if (was === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = was;
    for (const d of [dataDir, home]) rmSync(d, { recursive: true, force: true });
  });

  test("the owner approves, the free agent is woken with how to take it, takes it, and its comment wakes the lead", async () => {
    const ask = await owner.ownerCh.send("export the annotations as CSV");
    await run(lead.writeSpec(ask, SPEC));
    await lines(lead);
    await lines(dev);
    const v = (await run(dev.state())).state.specs.get(ask)!.v;
    await owner.ownerCh.send(`approved the spec of #${ask}`, { kind: "event", ev: { op: "spec.approve", ask, v } });
    const told = await lines(dev);
    expect(told.some((l) => l.includes(`kiwi spec start ${ask}`))).toBe(true);
    expect((await lines(lead)).some((l) => l.includes(`approved the spec of #${ask}`))).toBe(true);
    await run(dev.startSpec(ask, 600));
    const s: ChannelState = (await run(lead.state())).state;
    expect(specPlanner(s, ask)).toBe("dev");
    await run(dev.commentSpec(ask, "does the file need a header row?", "PR merged with ci-ok"));
    expect(await lines(lead)).toEqual([expect.stringContaining(`comment on #${ask}'s spec: > PR merged with ci-ok`)]);
  });
});
