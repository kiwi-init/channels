import { afterEach, beforeEach, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cursor, LocalFiles, loadConfig, updateConfig, type SeatRecord } from "../src/config.ts";
import { pathOf } from "../src/daemon/wake.ts";
import { bindHeldSeat, holdSeat, releaseSeat, SEAT_TOKEN, seatHolds } from "../src/hold.ts";
import { AgentSession } from "../src/agent.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { bindDirectory, seatsAt, seatsFor, seatsHeldAnywhere } from "../src/seats.ts";

let home = "";
let dir = "";
let other = "";
const prev = { home: process.env.KIWI_HOME, token: process.env[SEAT_TOKEN] };

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kiwi-hold-"));
  dir = join(home, "proj");
  other = join(home, "other");
  mkdirSync(dir);
  mkdirSync(other);
  process.env.KIWI_HOME = home;
  delete process.env[SEAT_TOKEN];
  updateConfig((c) => {
    c.channels.ch = { roomId: "room", ownerPk: "o", ownerXpk: "x", epoch: 0, keys: {}, relay: "http://127.0.0.1:1", code: "mc2-x" };
  });
});

afterEach(() => {
  if (prev.home === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = prev.home;
  if (prev.token === undefined) delete process.env[SEAT_TOKEN];
  else process.env[SEAT_TOKEN] = prev.token;
  rmSync(home, { recursive: true, force: true });
});

const all = (): SeatRecord[] => Object.values(loadConfig().bindings ?? {}).flatMap((v) => (Array.isArray(v) ? v : [v]));

test("a seat held in one folder is taken nowhere: not by its old session's listener in another checkout, a duplicate record or a later join", () => {
  bindDirectory(dir, { alias: "ch", as: "dev", harness: "codex", session: "old" });
  expect(holdSeat("ch", "dev", "loop")).toEqual({ kind: "changed", seats: 1 });
  const listeners = () => [{ alias: "ch", as: "dev", harness: "codex" as const, session: "old", cwd: other }];
  expect(seatsFor(other, { who: { harness: "codex", session: "old" }, listeners })).toEqual([]);
  expect(seatsAt(loadConfig(), other)).toEqual([]);

  updateConfig((c) => {
    c.bindings = { ...c.bindings, [other]: { alias: "ch", as: "dev", harness: "codex", session: "old", at: Date.now() } };
  });
  expect(seatsFor(other, { who: { harness: "codex", session: "old" } })).toEqual([]);
  expect(seatsHeldAnywhere({ harness: "codex", session: "old" })).toEqual([]);
  expect(seatsFor(other, { who: { harness: "codex", session: "fresh" } })).toEqual([]);
  expect(seatsAt(loadConfig(), other)[0]).toMatchObject({ session: "old" });

  bindDirectory(dir, { alias: "ch", as: "dev", harness: "codex", session: "intruder" });
  expect(seatsAt(loadConfig(), dir)).toEqual([expect.objectContaining({ hold: expect.any(Object) })]);
  expect(all().some((b) => b.session === "intruder")).toBe(false);
});

test("binding another sessionless seat of the same harness in the folder keeps the held one", () => {
  bindDirectory(dir, { alias: "ch", as: "dev", harness: "gemini" });
  holdSeat("ch", "dev", "loop");
  bindDirectory(dir, { alias: "ch", as: "peer", harness: "gemini" });
  expect(seatsAt(loadConfig(), dir).map((b) => [b.as, !!b.hold])).toEqual([
    ["dev", true],
    ["peer", false],
  ]);
});

test("the daemon finds no wake path for a seat held anywhere, even with a newer unheld record and the loop's own token in its environment", async () => {
  bindDirectory(dir, { alias: "ch", as: "dev", harness: "codex", session: "old" });
  holdSeat("ch", "dev", "loop");
  updateConfig((c) => {
    c.bindings = { ...c.bindings, [other]: { alias: "ch", as: "dev", harness: "codex", session: "newer", at: Date.now() + 60_000 } };
  });
  process.env[SEAT_TOKEN] = "loop";
  expect((await pathOf(loadConfig(), "ch", "dev")).kind).toBe("none");
  releaseSeat("ch", "dev", "loop");
  expect(await pathOf(loadConfig(), "ch", "dev")).toEqual({ kind: "command", via: "codex-queue", session: "newer" });
});

test("only the token's holder moves a held seat's cursor forward; anyone may move it back, which only leaves more unread", async () => {
  const cursorOf = (write: number) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const c = yield* Cursor;
        yield* c.write("ch", "dev", write);
        yield* c.markSeen("ch", "dev", [write + 5]);
        return { at: yield* c.read("ch", "dev"), seen: [...(yield* c.seen("ch", "dev"))] };
      }).pipe(Effect.provide(LocalFiles)),
    );
  bindDirectory(dir, { alias: "ch", as: "dev", harness: "codex", session: "old" });
  expect(await cursorOf(3)).toEqual({ at: 3, seen: [8] });
  holdSeat("ch", "dev", "loop");
  expect(await cursorOf(7)).toEqual({ at: 3, seen: [8] });
  expect(await cursorOf(2)).toEqual({ at: 2, seen: [8] });
  process.env[SEAT_TOKEN] = "loop";
  expect((await cursorOf(9)).at).toBe(9);
});

test("bind names the session each harness is known by: Kimi Code by its process, with the session kimi web serves", () => {
  bindDirectory(dir, { alias: "ch", as: "dev", harness: "kimi", session: "kimi-pid-1", pid: 1 });
  holdSeat("ch", "dev", "loop");
  expect(bindHeldSeat("ch", "dev", "other", { harness: "kimi", pid: 4242 })).toEqual({ kind: "other-holder" });
  expect(bindHeldSeat("ch", "dev", "loop", { harness: "kimi", pid: 4242, served: "ses-9" }, 5)).toEqual({ kind: "changed", seats: 1 });
  expect(all()).toEqual([{ alias: "ch", as: "dev", harness: "kimi", session: "kimi-pid-4242", pid: 4242, harnessSession: "ses-9", holds: 1, at: 5, seen: 5 }]);
  expect(bindHeldSeat("ch", "dev", "loop", { harness: "codex", session: "t" })).toEqual({ kind: "not-held" });
  expect(holdSeat("ch", "nobody", "loop")).toEqual({ kind: "no-seat" });
});

test("a session opened before a hold commits nothing once the seat is bound again, even after another session opens it, and the fresh one commits", async () => {
  bindDirectory(dir, { alias: "ch", as: "late", harness: "codex", session: "old" });
  const cfg = loadConfig().channels.ch;
  if (!cfg) throw new Error("no channel ch");
  const identity = await generateIdentity("late");
  const old = new AgentSession("ch", cfg, identity, () => {});
  const commits: string[] = [];
  const commit = (s: AgentSession, who: string) => Effect.runPromise(s.whileOurs(Effect.sync(() => void commits.push(who))));
  await commit(old, "old before");
  holdSeat("ch", "late", "loop");
  bindHeldSeat("ch", "late", "loop", { harness: "codex", session: "new" });
  const fresh = new AgentSession("ch", cfg, identity, () => {});
  await commit(old, "old after");
  await commit(fresh, "fresh");
  expect(commits).toEqual(["old before", "fresh"]);
});

test("an old session's listener in another checkout doesn't take back a seat bound to a live session", () => {
  bindDirectory(dir, { alias: "ch", as: "moved", harness: "claude", session: "old", pid: process.pid });
  holdSeat("ch", "moved", "loop");
  bindHeldSeat("ch", "moved", "loop", { harness: "claude", session: "new", pid: process.pid });
  const listeners = () => [{ alias: "ch", as: "moved", harness: "claude" as const, session: "old", cwd: other }];
  expect(seatsFor(other, { who: { harness: "claude", session: "old" }, listeners })).toEqual([]);
  expect(
    all()
      .filter((b) => b.as === "moved")
      .map((b) => b.session),
  ).toEqual(["new"]);
});

test("a join that opened the seat before a hold binds nothing once the seat went to another session", () => {
  bindDirectory(dir, { alias: "ch", as: "joiner", harness: "codex", session: "old" });
  const opened = seatHolds(loadConfig(), "ch", "joiner");
  holdSeat("ch", "joiner", "loop");
  bindHeldSeat("ch", "joiner", "loop", { harness: "codex", session: "new" });
  expect(bindDirectory(dir, { alias: "ch", as: "joiner", harness: "codex", session: "old" }, () => false, opened)).toBe(false);
  expect(
    all()
      .filter((b) => b.as === "joiner")
      .map((b) => b.session),
  ).toEqual(["new"]);
  expect(bindDirectory(dir, { alias: "ch", as: "joiner", harness: "codex", session: "later" }, () => false, seatHolds(loadConfig(), "ch", "joiner"))).toBe(true);
});
