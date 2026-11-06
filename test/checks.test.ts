import { beforeAll, describe, expect, test } from "bun:test";
import { parseArtifact, type CheckAsk } from "@kiwi/core/checks.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { wellFormed, type Event, type Kind, type Message } from "@kiwi/core/protocol.ts";
import { checkPassed, fold, type Roster } from "@kiwi/core/state.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
type Extra = Partial<Pick<Message, "to" | "ev" | "re" | "esc" | "choices" | "holds" | "check">>;
async function msg(from: string, kind: Kind, body: string, extra: Extra = {}, rts?: number): Promise<Message> {
  seq++;
  const base = { v: 1 as const, id: crypto.randomUUID(), from, kind, body, ...extra, ts: seq };
  const p = await sign(ids[from]!, base);
  return { ...p, seq, rts: rts ?? seq, sigOk: await verify(p) };
}
const ev = (from: string, e: Event) => msg(from, "event", "", { ev: e });

const SHA = "a".repeat(40);
const OPTIONS = ["A: The icon follows the dark panel", "B: Not yet"];
const kde: CheckAsk = { phase: "pre-ship", decider: "ana", artifact: { kind: "pr", repo: "o/r", pr: 1796, sha: SHA } };
const askCheck = (holds: number[], check: CheckAsk = kde, to = ["ana", "jon"]) => msg("win", "blocking", "Check the tray icon on KDE", { to, esc: true, choices: OPTIONS, holds, check });
const reply = (from: string, ask: Message, body: string, rts?: number) => msg(from, "msg", body, { re: [ask.seq] }, rts);

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "ana", "mac", "win"]) ids[n] = await generateIdentity(n);
  const jon = { user: "u-jon", name: "Jon", handle: "jon" };
  const ana = { user: "u-ana", name: "Ana", handle: "ana" };
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human", sponsor: jon },
    { name: "ana", pk: ids.ana!.pk, owner: false, at: 1, active: true, kind: "human", sponsor: ana },
    { name: "mac", pk: ids.mac!.pk, owner: false, at: 2, active: true, kind: "agent", sponsor: jon },
    { name: "win", pk: ids.win!.pk, owner: false, at: 3, active: true, kind: "agent", sponsor: ana },
  ];
});

async function withTask(): Promise<{ task: Message; id: number }> {
  const task = await ev("jon", { op: "task.add", title: "Tray: unread icon on a dark panel", owner: "win" });
  return { task, id: task.seq };
}

describe("a check is an ask with a phase, a decider and the artifact it vouches for (#623 §3)", () => {
  test("its first option is the pass, and the decider's pick is kept in state with the relay's time", async () => {
    const { task, id } = await withTask();
    const ask = await askCheck([id]);
    const yes = await reply("ana", ask, "A", 5_000);
    const s = fold([task, ask, yes], roster);
    const c = s.checks.get(ask.seq);
    expect(c).toMatchObject({ phase: "pre-ship", decider: "ana", artifact: kde.artifact, holds: [id], answer: { choice: OPTIONS[0], pass: true, by: "ana", seq: yes.seq, at: 5_000 } });
    expect(c && checkPassed(c)).toBe(true);
  });

  test("case 9: only the decider or the owner passes it; anyone else's reply doesn't count", async () => {
    const { task, id } = await withTask();
    const ask = await askCheck([id]);
    const fromAgent = await reply("mac", ask, "A");
    const fromAsker = await reply("win", ask, "A");
    const s = fold([task, ask, fromAgent, fromAsker], roster);
    expect(s.checks.get(ask.seq)?.answer).toBeUndefined();
    const byOwner = await reply("jon", ask, "A");
    const owned = fold([task, ask, fromAgent, fromAsker, byOwner], roster).checks.get(ask.seq);
    expect(owned?.answer).toMatchObject({ by: "jon", pass: true });
  });

  test("case 5: a no or a not yet doesn't pass, and the decider's latest pick is the one that counts", async () => {
    const { task, id } = await withTask();
    const ask = await askCheck([id]);
    const notYet = await reply("ana", ask, "B");
    const s = fold([task, ask, notYet], roster).checks.get(ask.seq);
    expect(s?.answer).toMatchObject({ pass: false, choice: OPTIONS[1] });
    expect(s && checkPassed(s)).toBe(false);
    const yes = await reply("ana", ask, "A");
    const no = await reply("ana", ask, "B: Not yet");
    const after = fold([task, ask, notYet, yes, no], roster).checks.get(ask.seq);
    expect(after && checkPassed(after)).toBe(false);
  });

  test("case 5: a closed check doesn't pass, even after a yes", async () => {
    const { task, id } = await withTask();
    const ask = await askCheck([id]);
    const yes = await reply("ana", ask, "A");
    const close = await ev("win", { op: "ask.close", ask: ask.seq, why: "asked on the wrong build" });
    const c = fold([task, ask, yes, close], roster).checks.get(ask.seq);
    expect(c?.closed).toBe(close.seq);
    expect(c && checkPassed(c)).toBe(false);
  });

  test("case 5: a newer check on the same phase, artifact and work supersedes the old one, which no longer passes", async () => {
    const { task, id } = await withTask();
    const old = await askCheck([id]);
    const yes = await reply("ana", old, "A");
    const fresh = await askCheck([id]);
    const lateYes = await reply("ana", old, "A");
    const s = fold([task, old, yes, fresh, lateYes], roster);
    const was = s.checks.get(old.seq);
    expect(was?.supersededBy).toBe(fresh.seq);
    expect(was && checkPassed(was)).toBe(false);
    expect(s.checks.get(fresh.seq)?.answer).toBeUndefined();
    const other = await askCheck([id], { ...kde, artifact: { ...kde.artifact, sha: "b".repeat(40) } as CheckAsk["artifact"] });
    expect(fold([task, fresh, other], roster).checks.get(fresh.seq)?.supersededBy).toBeUndefined();
  });

  test("a decider who isn't one of the people asked is refused, and a check needs options and holds", async () => {
    const { task, id } = await withTask();
    const outside = await askCheck([id], { ...kde, decider: "mac" });
    const s = fold([task, outside], roster);
    expect(s.trust.get(outside.seq)).toBe("refused");
    expect(s.checks.has(outside.seq)).toBe(false);
    const base = { v: 1, id: "x", from: "win", kind: "blocking", body: "b", to: ["ana"], esc: true, ts: 1 };
    expect(wellFormed({ ...base, choices: OPTIONS, holds: [id], check: kde })).toBe(true);
    expect(wellFormed({ ...base, holds: [id], check: kde })).toBe(false);
    expect(wellFormed({ ...base, choices: OPTIONS, check: kde })).toBe(false);
    expect(wellFormed({ ...base, choices: OPTIONS, holds: [id], check: { ...kde, artifact: { kind: "pr", repo: "o/r", pr: 1, sha: "abc1234" } } })).toBe(false);
    expect(wellFormed({ ...base, choices: OPTIONS, holds: [id], check: { ...kde, phase: "later" } })).toBe(false);
    expect(wellFormed({ ...base, choices: OPTIONS, holds: [id], check: { ...kde, artifact: { kind: "tag", name: "v1" } } })).toBe(false);
  });
});

describe("binding a check to its artifact from the command line", () => {
  test("a PR needs its repo, number and full head SHA; a run its id; npm a package and version", () => {
    expect(parseArtifact(`pr:kiwi-init/channels#1796@${SHA}`)).toEqual({ kind: "pr", repo: "kiwi-init/channels", pr: 1796, sha: SHA });
    expect(parseArtifact("pr:kiwi-init/channels#1796@1be7a28")).toStartWith("--artifact pr:");
    expect(parseArtifact("run:deploy-api-42")).toEqual({ kind: "run", id: "deploy-api-42" });
    expect(parseArtifact("npm:@scope/lib@1.2.3")).toEqual({ kind: "npm", pkg: "@scope/lib", version: "1.2.3" });
    expect(parseArtifact("npm:lib")).toStartWith("--artifact pr:");
    expect(parseArtifact("tag:v1.2.3")).toStartWith("--artifact pr:");
  });
});
