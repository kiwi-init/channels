// Work goes to whoever fits: members describe themselves (cards), tasks say what they need, and
// the board names who has it, least busy first. A task with a reviewer is done only when someone
// else says so, and handing work over carries where it stands.

import { beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectHarness, handoffHere, mergeCard, repoName, sameCard } from "../src/card.ts";
import { cardLine, describeEvent, fitsLine, formatStatus, formatTask, formatTasks } from "../src/format.ts";
import { generateIdentity, sign, verify, type Identity } from "../src/identity.ts";
import { wellFormed, type Event, type Kind, type Message } from "../src/protocol.ts";
import { fits, fold, memberTags, type Roster } from "../src/state.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
async function msg(from: string, kind: Kind, body: string, extra: { to?: string[]; ev?: Event } = {}): Promise<Message> {
  seq++;
  const base = { v: 1 as const, id: crypto.randomUUID(), from, kind, body, ...extra, ts: seq };
  const p = await sign(ids[from]!, base);
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}
const ev = (from: string, e: Event) => msg(from, "event", "", { ev: e });

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "mac", "win", "linux"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "mac", pk: ids.mac!.pk, owner: false, at: 1, active: true, kind: "agent", role: "frontend" },
    { name: "win", pk: ids.win!.pk, owner: false, at: 2, active: true, kind: "agent" },
    { name: "linux", pk: ids.linux!.pk, owner: false, at: 3, active: true, kind: "agent" },
  ];
});

const cards = async () => [
  await ev("mac", { op: "card", os: "macos", arch: "arm64", harness: "claude-code", tools: ["Git", "xcode", "docker"], repo: "ojow/channels", branch: "main" }),
  await ev("win", { op: "card", os: "windows", arch: "x64", harness: "codex", tools: ["git", "dotnet"], repo: "ojow/channels" }),
  await ev("linux", { op: "card", os: "linux", arch: "x64", tools: ["git", "docker", "gpu"], note: "the CI box" }),
];

describe("cards", () => {
  test("a member says what it is; tags are lowercase; the card shows in status", async () => {
    const s = fold(await cards(), roster);
    expect(s.members.get("mac")!.card).toMatchObject({ os: "macos", tools: ["git", "xcode", "docker"], repo: "ojow/channels" });
    expect([...memberTags(s.members.get("mac")!)]).toEqual(expect.arrayContaining(["macos", "arm64", "claude-code", "xcode", "ojow/channels", "channels", "main", "frontend"]));
    expect(cardLine(s.members.get("linux")!.card)).toBe("linux x64 · tools: git, docker, gpu · the CI box");
    const status = formatStatus({ alias: "c", me: "mac", state: s, online: new Map(), unread: 0 });
    expect(status).toContain("windows x64 · codex · ojow/channels · tools: git, dotnet");
  });

  test("a later card replaces the earlier one; describeEvent says it", async () => {
    const [first] = await cards();
    const later = await ev("mac", { op: "card", os: "macos", harness: "cursor" });
    const s = fold([first!, later], roster);
    expect(s.members.get("mac")!.card).toMatchObject({ os: "macos", harness: "cursor" });
    expect(s.members.get("mac")!.card!.tools).toBeUndefined();
    expect(describeEvent(later)).toBe("described itself: macos · cursor");
  });

  test("bounded: too many tools, or a long field, is malformed", () => {
    const p = { v: 1, id: "x", from: "mac", kind: "event", body: "", ts: 1 };
    expect(wellFormed({ ...p, ev: { op: "card", os: "macos", tools: Array(41).fill("t") } })).toBe(false);
    expect(wellFormed({ ...p, ev: { op: "card", os: "x".repeat(121) } })).toBe(false);
    expect(wellFormed({ ...p, ev: { op: "card", os: "macos", tools: Array(40).fill("t") } })).toBe(true);
    expect(wellFormed({ ...p, ev: { op: "task.add", title: "t", needs: Array(41).fill("n") } })).toBe(false);
    expect(wellFormed({ ...p, ev: { op: "task.update", task: 1, handoff: { files: Array(201).fill("f") } } })).toBe(false);
  });
});

describe("needs and who fits", () => {
  test("a task's needs name who has them, least busy first", async () => {
    const busy = await ev("linux", { op: "task.add", title: "flaky test", owner: "linux" });
    const needsDocker = await ev("jon", { op: "task.add", title: "container build", needs: ["Docker"] });
    const needsWin = await ev("jon", { op: "task.add", title: "test the driver", needs: ["windows"] });
    const needsGpu = await ev("jon", { op: "task.add", title: "train", needs: ["gpu", "windows"] });
    const needsTpu = await ev("jon", { op: "task.add", title: "tpu", needs: ["tpu", "docker"] });
    const s = fold([...(await cards()), busy, needsDocker, needsWin, needsGpu, needsTpu], roster);
    expect(s.tasks.get(needsDocker.seq)!.needs).toEqual(["docker"]);
    const level = (n: string) => (n === "linux" ? "busy" : "free") as "busy" | "free";
    expect(fits(s, s.tasks.get(needsDocker.seq)!, level).map((f) => f.name)).toEqual(["mac", "linux"]);
    expect(fitsLine(s, s.tasks.get(needsDocker.seq)!)).toBe("fits: mac (free), linux (busy)");
    expect(fitsLine(s, s.tasks.get(needsWin.seq)!)).toBe("fits: win (free)");
    expect(fitsLine(s, s.tasks.get(needsGpu.seq)!)).toBe("no one agent has all of it");
    expect(fitsLine(s, s.tasks.get(needsTpu.seq)!)).toBe("nobody here has: tpu");
    expect(fitsLine(s, s.tasks.get(busy.seq)!)).toBeNull();
    // Roles count: mac's role is frontend.
    expect(fits(s, { needs: ["frontend"] }, () => "free").map((f) => f.name)).toEqual(["mac"]);
    expect(formatTasks(s)).toContain("[needs windows]");
    expect(formatTask(s, s.tasks.get(needsWin.seq)!)).toContain("fits: win (free)");
  });
});

describe("review", () => {
  test("the doer can't mark reviewed work done; the reviewer approves; a person always may", async () => {
    const add = await ev("jon", { op: "task.add", title: "driver", owner: "win", review: "mac" });
    const t = add.seq;
    const selfDone = await ev("win", { op: "task.update", task: t, state: "done" });
    const toReview = await ev("win", { op: "task.update", task: t, state: "review" });
    const otherDone = await ev("linux", { op: "task.update", task: t, state: "done" });
    const approve = await ev("mac", { op: "task.update", task: t, state: "done", note: "ran it on the PC" });
    const s = fold([add, selfDone, toReview, otherDone, approve], roster);
    expect(s.rejected.get(selfDone.seq)).toBe(`T${t} needs review by mac before it's done (send it for review)`);
    expect(s.rejected.get(otherDone.seq)).toContain("needs review by mac");
    expect(s.tasks.get(t)!.state).toBe("done");
    expect(s.tasks.get(t)!.approvedBy).toBe("mac");
    expect(describeEvent(approve, s)).toBe(`approved T${t} “driver”: ran it on the PC`);
    expect(formatTask(s, s.tasks.get(t)!)).toContain("review by mac; approved by mac");
    // A person overrides.
    const p = fold([add, await ev("jon", { op: "task.update", task: t, state: "done" })], roster);
    expect(p.tasks.get(t)!.state).toBe("done");
  });

  test("any: anyone who hasn't worked on it, judged by who owns it then", async () => {
    const add = await ev("jon", { op: "task.add", title: "docs", review: "*" });
    const t = add.seq;
    const claim = await ev("win", { op: "task.claim", task: t });
    const selfDone = await ev("win", { op: "task.update", task: t, state: "done" });
    const reject = await ev("mac", { op: "task.update", task: t, state: "doing", note: "missing the Windows steps" });
    const approve = await ev("linux", { op: "task.update", task: t, state: "done" });
    const s = fold([add, claim, selfDone, reject, approve], roster);
    expect(s.rejected.get(selfDone.seq)).toContain("someone who hasn't worked on it");
    expect(s.tasks.get(t)!.notes.map((n) => n.text)).toEqual(["missing the Windows steps"]);
    expect(s.tasks.get(t)!.approvedBy).toBe("linux");
    expect(formatTasks(fold([add, claim], roster))).toContain("[review by anyone who hasn't worked on it]");
  });

  test("handing it to someone first doesn't make the doer its reviewer", async () => {
    const add = await ev("jon", { op: "task.add", title: "sneaky", review: "*" });
    const t = add.seq;
    const claim = await ev("win", { op: "task.claim", task: t });
    const pass = await ev("win", { op: "task.update", task: t, owner: "mac" });
    const selfDone = await ev("win", { op: "task.update", task: t, state: "done" });
    const oneStep = await ev("win", { op: "task.update", task: t, owner: "linux", state: "done" });
    const reject = await ev("linux", { op: "task.update", task: t, state: "doing", note: "not yet" });
    const linuxDone = await ev("linux", { op: "task.update", task: t, state: "done" });
    const s = fold([add, claim, pass, selfDone, oneStep, reject, linuxDone], roster);
    for (const m of [selfDone, oneStep]) expect(s.rejected.get(m.seq)).toContain("someone who hasn't worked on it");
    // linux sent it back as a reviewer (not its owner), so it hasn't worked on it, and may approve.
    expect(s.tasks.get(t)!.workedBy).toEqual(["win", "mac"]);
    expect(s.tasks.get(t)!.approvedBy).toBe("linux");
  });

  test("only a person or the reviewer moves a review gate once it's set", async () => {
    const add = await ev("win", { op: "task.add", title: "mine", owner: "win", review: "mac" });
    const t = add.seq;
    const dodge = await ev("win", { op: "task.update", task: t, review: null });
    const swap = await ev("win", { op: "task.update", task: t, review: "*" });
    const handBack = await ev("mac", { op: "task.update", task: t, review: "linux" });
    const s = fold([add, dodge, swap, handBack], roster);
    expect(s.rejected.get(dodge.seq)).toBe(`only a person or mac changes who reviews T${t}`);
    expect(s.rejected.has(swap.seq)).toBe(true);
    expect(s.tasks.get(t)!.review).toBe("linux");
    // Setting one where there was none is anyone's (with the tasks scope).
    const open = await ev("jon", { op: "task.add", title: "open" });
    const set = await ev("win", { op: "task.update", task: open.seq, review: "mac" });
    expect(fold([open, set], roster).tasks.get(open.seq)!.review).toBe("mac");
  });

  test("reopening clears the approval", async () => {
    const add = await ev("jon", { op: "task.add", title: "x", review: "mac" });
    const s = fold([add, await ev("mac", { op: "task.update", task: add.seq, state: "done" }), await ev("jon", { op: "task.update", task: add.seq, state: "todo" })], roster);
    expect(s.tasks.get(add.seq)!.approvedBy).toBeUndefined();
  });
});

describe("handoff", () => {
  test("the note carries the branch, commit and files; status names it", async () => {
    const add = await ev("jon", { op: "task.add", title: "port", owner: "mac" });
    const hand = await ev("mac", { op: "task.update", task: add.seq, owner: "win", note: "build on Windows next", handoff: { branch: "mac/port", commit: "3f9a2c1", files: ["src/a.ts", "src/b.ts"] } });
    const s = fold([add, hand], roster);
    expect(s.tasks.get(add.seq)!.owner).toBe("win");
    expect(s.tasks.get(add.seq)!.notes[0]).toMatchObject({ by: "mac", text: "build on Windows next", handoff: { branch: "mac/port", commit: "3f9a2c1" } });
    expect(describeEvent(hand, s)).toBe(`handed T${add.seq} “port” to win (branch mac/port @ 3f9a2c1, 2 files): build on Windows next`);
    expect(formatTask(s, s.tasks.get(add.seq)!)).toContain("files: src/a.ts, src/b.ts");
  });
});

describe("reading the machine", () => {
  test("repo names from https and ssh remotes", () => {
    expect(repoName("https://github.com/ojowwalker77/channels.git")).toBe("ojowwalker77/channels");
    expect(repoName("git@github.com:ojowwalker77/channels.git")).toBe("ojowwalker77/channels");
    expect(repoName("https://gitlab.com/a/b/")).toBe("a/b");
    expect(repoName(null)).toBeNull();
  });

  test("the harness from its markers", () => {
    expect(detectHarness({ CLAUDECODE: "1" })).toBe("claude-code");
    expect(detectHarness({ CODEX_THREAD_ID: "x" })).toBe("codex");
    expect(detectHarness({})).toBeUndefined();
  });

  test("what was said by hand stays until said again; detected tools follow the machine", () => {
    const was = { os: "macos", tools: ["docker", "figma"], model: "opus", note: "design work" };
    const now = { os: "macos", tools: ["git"] };
    const merged = mergeCard(now, was);
    expect(merged).toEqual({ os: "macos", tools: ["git", "figma"], model: "opus", note: "design work" });
    expect(mergeCard(now, was, { model: "sonnet", tools: ["Blender"] })).toMatchObject({ model: "sonnet", tools: ["git", "figma", "blender"] });
    expect(sameCard(merged, { ...merged, tools: ["figma", "git"] })).toBe(true);
    expect(sameCard(merged, { ...merged, note: "other" })).toBe(false);
  });

  test("handing over reads the checkout: branch, commit, changed files, and whether it's pushed", () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-handoff-"));
    const g = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
    try {
      g("init", "-q", "-b", "work");
      g("-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "--allow-empty", "-m", "start");
      writeFileSync(join(dir, "a.txt"), "x");
      const { handoff, pushed } = handoffHere(dir);
      expect(handoff.branch).toBe("work");
      expect(handoff.commit).toMatch(/^[0-9a-f]{7,}$/);
      expect(handoff.files).toEqual(["a.txt"]);
      expect(pushed).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
