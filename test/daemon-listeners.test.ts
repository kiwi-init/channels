import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daemonHello, daemonListeners, daemonSock, holdListener, startDaemon, stopDaemon, type Daemon } from "../src/daemon.ts";

setDefaultTimeout(30_000);

const home = mkdtempSync(join(tmpdir(), "kiwi-daemon-listeners-"));
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

async function until(pred: () => Promise<boolean>, label: string): Promise<void> {
  const end = Date.now() + 10_000;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(50);
  }
}

const listen = { channel: "ch", agent: "otter-gentle", kind: "listen" as const, cwd: "/work", harness: "claude", session: "s1", pid: 4242, marks: true };

describe("the daemon knows who is listening", () => {
  test("a listener is listed with where it runs while its connection is open, and gone once it closes", async () => {
    const held = await holdListener(listen);
    expect(held.held).toBe(true);
    const listed = await daemonListeners();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ channel: "ch", agent: "otter-gentle", kind: "listen", cwd: "/work", harness: "claude", session: "s1", pid: 4242 });
    held.close();
    await until(async () => (await daemonListeners()).length === 0, "the listener to go");
  });

  test("one hook slot per agent and session: a second is refused until the first lets go", async () => {
    const hook = { ...listen, kind: "hook" as const };
    const first = await holdListener(hook);
    expect(first.held).toBe(true);
    const second = await holdListener(hook);
    expect(second.held).toBe(false);
    second.close();
    const otherSession = await holdListener({ ...hook, session: "s2" });
    expect(otherSession.held).toBe(true);
    otherSession.close();
    first.close();
    await until(async () => (await daemonListeners()).length === 0, "the slot to free");
    const third = await holdListener(hook);
    expect(third.held).toBe(true);
    third.close();
  });

  test("a listener holds on across a daemon restart", async () => {
    const held = await holdListener(listen, daemonSock(), 100);
    await stopDaemon();
    await until(async () => !(await daemonHello().catch(() => null)), "the daemon to stop");
    daemon = await startDaemon();
    await until(async () => (await daemonListeners()).some((l) => l.agent === "otter-gentle"), "the listener to hold again");
    held.close();
  });

  test("with no daemon, holding says so instead of failing", async () => {
    const held = await holdListener(listen, join(home, "no-such.sock"));
    expect(held.held).toBeNull();
    held.close();
  });

  test("hooks read the daemon's listeners, and an older client's listener file for one release", async () => {
    const { isListening, liveListeners, refreshListeners } = await import("../src/hooks.ts");
    const held = await holdListener(listen);
    await refreshListeners();
    expect(isListening("ch", "otter-gentle")).toBe(true);
    expect(liveListeners()).toContainEqual({ alias: "ch", as: "otter-gentle", cwd: "/work", harness: "claude", session: "s1", pid: 4242 });
    held.close();
    await until(async () => (await daemonListeners()).length === 0, "the listener to go");
    await refreshListeners();
    expect(isListening("ch", "otter-gentle")).toBe(false);

    const legacy = join(home, "listeners");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, `ch.heron-brave.${process.pid}`), JSON.stringify({ at: 1, alias: "ch", as: "heron-brave" }));
    expect(isListening("ch", "heron-brave")).toBe(true);
    rmSync(legacy, { recursive: true, force: true });
  });

  test("holding a listener writes no pid file", async () => {
    const held = await holdListener({ ...listen, kind: "hook" });
    expect(existsSync(join(home, "listeners"))).toBe(false);
    expect(existsSync(join(home, "listen-hooks"))).toBe(false);
    held.close();
  });
});
