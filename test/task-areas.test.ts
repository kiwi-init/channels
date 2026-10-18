import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatTask } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { wellFormedEvent, type Event, type Message } from "@kiwi/core/protocol.ts";
import { areasOf, taskAreas, taskCandidates } from "@kiwi/core/routing.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import { branchAreas } from "../src/areas.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
async function ev(from: string, e: Event): Promise<Message> {
  seq++;
  const p = await sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ts: seq, ev: e });
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "ana", "bo"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "ana", pk: ids.ana!.pk, owner: false, at: 1, active: true, kind: "agent" },
    { name: "bo", pk: ids.bo!.pk, owner: false, at: 2, active: true, kind: "agent" },
  ];
});

describe("the folders a task changed", () => {
  test("files become folders three deep, the busiest first; files at the root say nothing", () => {
    expect(areasOf(["src/relay/github.ts", "src/relay/route.ts", "web/src/components/conversation/index.tsx", "README.md", "test/x.test.ts"])).toEqual(["src/relay", "test", "web/src/components"]);
  });

  test("on the wire: up to 20 relative folders, never . or .. or an absolute path", () => {
    const up = (areas: unknown) => wellFormedEvent({ op: "task.update", task: 1, state: "done", areas });
    expect(up(["src/relay", ".github/workflows"])).toBe(true);
    expect(up(["../etc"])).toBe(false);
    expect(up(["/abs"])).toBe(false);
    expect(up(["a/./b"])).toBe(false);
    expect(up(Array.from({ length: 21 }, (_, i) => `d${i}`))).toBe(false);
    expect(up("src")).toBe(false);
  });

  test("a task without its own folders borrows its parent's, or the paths its text names", async () => {
    const parent = await ev("ana", { op: "task.add", title: "GitHub app", owner: "ana" });
    const done = await ev("ana", { op: "task.update", task: parent.seq, state: "done", areas: ["src/relay", "packages/core/src"] });
    const child = await ev("jon", { op: "task.add", title: "More GitHub", from: parent.seq });
    const named = await ev("jon", { op: "task.add", title: "Fix web/src/components/message.tsx", detail: "see `src/cli/commands`" });
    const s = fold([parent, done, child, named], roster);
    expect(s.tasks.get(parent.seq)?.areas).toEqual(["src/relay", "packages/core/src"]);
    expect(formatTask(s, s.tasks.get(parent.seq)!)).toContain("folders it changed: src/relay, packages/core/src");
    expect(taskAreas(s, s.tasks.get(child.seq)!)).toEqual(["src/relay", "packages/core/src"]);
    expect(taskAreas(s, s.tasks.get(named.seq)!)).toEqual(["src/cli/commands", "web/src/components"]);
  });

  test("whoever changed those folders lately ranks for a task in them, with the folder and the task as the reason", async () => {
    const a = await ev("ana", { op: "task.add", title: "Relay work", owner: "ana" });
    const aDone = await ev("ana", { op: "task.update", task: a.seq, state: "done", areas: ["src/relay"] });
    const b = await ev("bo", { op: "task.add", title: "Web work", owner: "bo" });
    const bDone = await ev("bo", { op: "task.update", task: b.seq, state: "done", areas: ["web/src/components"] });
    const next = await ev("jon", { op: "task.add", title: "Webhook retries in src/relay/github.ts" });
    const s = fold([a, aDone, b, bDone, next], roster);
    expect(taskCandidates(s, next.seq)).toEqual([
      { name: "ana", score: 2, queue: 0, reasons: [`touched src/relay in T${a.seq}`], warm: false },
      { name: "bo", score: 0, queue: 0, reasons: [], warm: false },
    ]);
  });
});

describe("reading the folders from the agent's checkout", () => {
  const dir = mkdtempSync(join(tmpdir(), "kiwi-areas-"));
  const g = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const put = (path: string) => {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), `${path}\n`);
  };
  beforeAll(() => {
    g("init", "-q", "-b", "main");
    g("config", "user.email", "t@example.com");
    g("config", "user.name", "t");
    put("README.md");
    g("add", ".");
    g("commit", "-qm", "base");
    g("update-ref", "refs/remotes/origin/main", g("rev-parse", "HEAD"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("on the task's branch: the folders changed since main, committed or not", () => {
    g("checkout", "-qb", "T42-relay");
    put("src/relay/github.ts");
    g("add", ".");
    g("commit", "-qm", "relay");
    put("web/src/lib/x.ts");
    g("add", ".");
    expect(branchAreas(42, false, dir)).toEqual(["src/relay", "web/src/lib"]);
  });

  test("another task's branch only counts for the task's owner; main and a folder that isn't a checkout say nothing", () => {
    expect(branchAreas(7, false, dir)).toBeNull();
    expect(branchAreas(7, true, dir)).toEqual(["src/relay", "web/src/lib"]);
    g("stash", "-q");
    g("checkout", "-q", "main");
    expect(branchAreas(42, true, dir)).toBeNull();
    expect(branchAreas(42, true, tmpdir())).toBeNull();
  });
});
