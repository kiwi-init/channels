import { spawnOwned } from "./owned.ts";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daemonListeners, holdListener, startDaemon, type Daemon } from "../src/daemon.ts";
import { supersedes, type DaemonListener, type ListenerProc } from "../src/daemon/protocol.ts";
import { holderWords } from "../src/hooks/listen.ts";
import { processStart } from "../src/pid.ts";

setDefaultTimeout(30_000);

const home = mkdtempSync(join(tmpdir(), "kiwi-slot-handoff-"));
const prevHome = process.env.KIWI_HOME;
process.env.KIWI_HOME = home;

let daemon: Daemon | undefined;
beforeAll(async () => {
  daemon = await startDaemon();
});
afterAll(async () => {
  await daemon?.stop().catch(() => {});
  if (prevHome === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

function procOf(pid: number): ListenerProc {
  const started = processStart(pid);
  if (!started) throw new Error(`no start time for pid ${pid}`);
  return { pid, started };
}

const me = procOf(process.pid);
const hook = (session: string, proc: ListenerProc | null, agent = "otter-gentle") => ({
  channel: "ch",
  agent,
  kind: "hook" as const,
  cwd: "/work",
  harness: "claude",
  session,
  pid: 4242,
  proc,
  marks: true,
});
const hooksFor = async (agent: string) => (await daemonListeners()).filter((l) => l.kind === "hook" && l.agent === agent);

describe("a seat's own session always arms its listener, and a healthy one is kept (#2502)", () => {
  test("a healthy listener in another live process keeps the slot, and the refusal names it", async () => {
    const other = spawnOwned(["sleep", "30"]);
    const held = await holdListener(hook("s-healthy", procOf(other.pid)));
    expect(held.held).toBe(true);
    const second = await holdListener(hook("s-healthy", me));
    expect(second.held).toBe(false);
    expect(second.holder).toEqual({ session: "s-healthy", pid: 4242, harness: "claude", proc: procOf(other.pid) });
    expect(holderWords(second.holder)).toBe(`session s-healthy, claude pid 4242, listener pid ${other.pid}`);
    second.close();
    expect(await hooksFor("otter-gentle")).toHaveLength(1);
    held.close();
    other.kill();
  });

  test("the same listener process holding again replaces its own earlier hold: exactly one stays", async () => {
    const earlier = await holdListener(hook("s-same", me));
    expect(earlier.held).toBe(true);
    const again = await holdListener(hook("s-same", me));
    expect(again.held).toBe(true);
    expect((await hooksFor("otter-gentle")).filter((l) => l.session === "s-same")).toHaveLength(1);
    earlier.close();
    await Bun.sleep(100);
    expect((await hooksFor("otter-gentle")).filter((l) => l.session === "s-same")).toHaveLength(1);
    again.close();
  });

  test("a holder whose process is gone is superseded", async () => {
    const gone = spawnOwned(["sleep", "30"]);
    const proc = procOf(gone.pid);
    const stale = await holdListener(hook("s-dead", proc));
    expect(stale.held).toBe(true);
    gone.kill();
    await gone.exited;
    const fresh = await holdListener(hook("s-dead", me));
    expect(fresh.held).toBe(true);
    expect((await hooksFor("otter-gentle")).filter((l) => l.session === "s-dead")).toEqual([expect.objectContaining({ proc: me })]);
    stale.close();
    fresh.close();
  });

  test("a holder that didn't say which process it is stays: nothing proves it stale", async () => {
    const old = await holdListener(hook("s-unknown", null));
    expect(old.held).toBe(true);
    const next = await holdListener(hook("s-unknown", me));
    expect(next.held).toBe(false);
    next.close();
    old.close();
  });

  test("two seats in one folder each hold their own slot", async () => {
    const a = await holdListener(hook("s-a", me, "seat-a"));
    const b = await holdListener(hook("s-b", me, "seat-b"));
    expect([a.held, b.held]).toEqual([true, true]);
    expect(await hooksFor("seat-a")).toHaveLength(1);
    expect(await hooksFor("seat-b")).toHaveLength(1);
    a.close();
    b.close();
  });

  test("two live processes arming at once leave exactly one listener, and the displaced one closing removes nothing", async () => {
    const one = spawnOwned(["sleep", "30"]);
    const two = spawnOwned(["sleep", "30"]);
    const [x, y] = await Promise.all([holdListener(hook("s-race", procOf(one.pid))), holdListener(hook("s-race", procOf(two.pid)))]);
    expect([x.held, y.held].filter(Boolean)).toHaveLength(1);
    const loser = x.held ? y : x;
    loser.close();
    await Bun.sleep(100);
    expect((await hooksFor("otter-gentle")).filter((l) => l.session === "s-race")).toHaveLength(1);
    x.close();
    y.close();
    one.kill();
    two.kill();
  });
});

describe("only a proven handoff replaces a holder (#2502 review)", () => {
  const listener = (proc: ListenerProc | null): DaemonListener => ({ ...hook("s", proc), at: 0 });
  const held = listener({ pid: 900, started: "boot:100" });
  const asking = listener({ pid: 901, started: "boot:200" });

  test("a live holder whose start can't be read is kept: unknown isn't dead", () => {
    expect(supersedes(asking, held, { alive: () => true, startOf: () => null })).toBe(false);
  });

  test("a live holder with its recorded start is kept", () => {
    expect(supersedes(asking, held, { alive: () => true, startOf: () => "boot:100" })).toBe(false);
  });

  test("a holder whose process is gone is replaced", () => {
    expect(supersedes(asking, held, { alive: () => false, startOf: () => null })).toBe(true);
  });

  test("a holder whose pid now belongs to another process (a different start) is replaced", () => {
    expect(supersedes(asking, held, { alive: () => true, startOf: () => "boot:555" })).toBe(true);
  });

  test("the same listener process holding again replaces its own hold", () => {
    expect(supersedes(listener({ pid: 900, started: "boot:100" }), held, { alive: () => true, startOf: () => null })).toBe(true);
  });

  test("a holder that never said which process it is is kept", () => {
    expect(supersedes(asking, listener(null), { alive: () => false, startOf: () => null })).toBe(false);
  });
});
