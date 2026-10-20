import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daemonHello, daemonSock, stopDaemon } from "../src/daemon.ts";

setDefaultTimeout(60_000);

const MAIN = join(import.meta.dir, "../src/cli/main.ts");

function daemon(dir: string) {
  return Bun.spawn([process.execPath, MAIN, "daemon"], { cwd: dir, env: { ...process.env, KIWI_HOME: dir }, stdin: "ignore", stdout: "ignore", stderr: "pipe" });
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function until(what: string, ok: () => boolean | Promise<boolean>, ms = 20_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(50);
  }
}

async function withHome(tag: string, run: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), `kiwi-daemon-lock-${tag}-`));
  try {
    await run(dir);
  } finally {
    await stopDaemon(daemonSock(dir)).catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
}

test("daemons started at once on one home leave exactly one running, the one that answers", async () => {
  await withHome("race", async (dir) => {
    const started = [daemon(dir), daemon(dir), daemon(dir)];
    await until("a daemon answering", async () => !!(await daemonHello(daemonSock(dir)).catch(() => null)));
    await until("the others to give up", () => started.filter((p) => alive(p.pid)).length === 1, 15_000);
    const hello = await daemonHello(daemonSock(dir));
    expect(started.filter((p) => alive(p.pid)).map((p) => p.pid)).toEqual([hello.pid]);
    expect(readFileSync(join(dir, "daemon.lock"), "utf8")).toBe(String(hello.pid));
  });
});

test("a daemon too busy to answer isn't replaced: the newcomer gives up and the first one answers again", async () => {
  await withHome("busy", async (dir) => {
    const first = daemon(dir);
    await until("the first daemon answering", async () => (await daemonHello(daemonSock(dir)).catch(() => null))?.pid === first.pid);
    process.kill(first.pid, "SIGSTOP");
    try {
      const second = daemon(dir);
      expect(await second.exited).not.toBe(0);
      expect(await new Response(second.stderr).text()).toContain(`(pid ${first.pid})`);
    } finally {
      process.kill(first.pid, "SIGCONT");
    }
    expect((await daemonHello(daemonSock(dir))).pid).toBe(first.pid);
  });
});

test("a daemon whose lock and socket another daemon took exits by itself and leaves that socket alone", async () => {
  await withHome("taken", async (dir) => {
    const first = daemon(dir);
    const sock = daemonSock(dir);
    await until("the first daemon answering", async () => (await daemonHello(sock).catch(() => null))?.pid === first.pid);
    writeFileSync(join(dir, "daemon.lock"), String(process.pid));
    rmSync(sock, { force: true });
    const taker = Bun.listen({ unix: sock, socket: { data() {} } });
    try {
      const ino = statSync(sock).ino;
      await first.exited;
      expect(statSync(sock).ino).toBe(ino);
      expect(readFileSync(join(dir, "daemon.lock"), "utf8")).toBe(String(process.pid));
    } finally {
      taker.stop(true);
      rmSync(join(dir, "daemon.lock"), { force: true });
    }
  });
});

test("a stale lock whose pid now belongs to something else frees the lock without killing it", async () => {
  const { isKiwiDaemon, lockPath, takeLock } = await import("../src/daemon/lock.ts");
  const dir = mkdtempSync(join(tmpdir(), "kiwi-lock-reused-"));
  const stranger = Bun.spawn(["sleep", "30"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  const lock = lockPath(dir);
  writeFileSync(lock, String(stranger.pid));
  const { utimesSync } = await import("node:fs");
  utimesSync(lock, new Date(Date.now() - 120_000), new Date(Date.now() - 120_000));
  await takeLock(lock);
  expect(readFileSync(lock, "utf8")).toBe(String(process.pid));
  expect(alive(stranger.pid)).toBe(true);
  stranger.kill();
  rmSync(dir, { recursive: true, force: true });
  expect(isKiwiDaemon("/Users/jow/.kiwi/bin/kiwi daemon")).toBe(true);
  expect(isKiwiDaemon("/opt/homebrew/bin/bun /repo/src/cli/main.ts daemon")).toBe(true);
  expect(isKiwiDaemon("C:\\kiwi\\kiwi.exe daemon")).toBe(true);
  expect(isKiwiDaemon("sleep 30")).toBe(false);
  expect(isKiwiDaemon("/usr/bin/kiwi-daemon-helper")).toBe(false);
  expect(isKiwiDaemon("vim kiwi daemon.md")).toBe(false);
});

test("while a daemon holds or takes the lock, hooks retrying it spawn one per home every 15 s, not one each", async () => {
  const { claimSpawn } = await import("../src/daemon/rpc.ts");
  const dir = mkdtempSync(join(tmpdir(), "kiwi-spawn-gap-"));
  const t = 1_800_000_000_000;
  expect(claimSpawn(dir, t)).toBe(true);
  expect(claimSpawn(dir, t + 1_000)).toBe(true);
  writeFileSync(join(dir, "daemon.lock"), "12345");
  expect(claimSpawn(dir, t + 1_500)).toBe(false);
  expect(claimSpawn(dir, t + 15_999)).toBe(false);
  expect(claimSpawn(dir, t + 16_000)).toBe(true);
  expect(statSync(join(dir, "daemon.spawning")).mode & 0o777).toBe(0o600);
  rmSync(dir, { recursive: true, force: true });
});
