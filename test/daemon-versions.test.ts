import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareVersions } from "@kiwi/core/versions.ts";
import { daemonHello, daemonSock, ensureDaemon, stopDaemon } from "../src/daemon.ts";
import { DAEMON_PROTOCOL } from "../src/daemon/protocol.ts";
import { VERSION } from "../src/version.ts";

setDefaultTimeout(30_000);

function fakeDaemon(sock: string, version: string): { stops: () => number; close: () => void } {
  let stops = 0;
  const server = Bun.listen({
    unix: sock,
    socket: {
      data(socket, data) {
        for (const line of new TextDecoder().decode(data).split("\n")) {
          if (!line.trim()) continue;
          const req = JSON.parse(line) as { id: number; verb: string };
          if (req.verb === "stop") {
            stops += 1;
            socket.write(JSON.stringify({ id: req.id, ok: true }) + "\n");
            server.stop(true);
            continue;
          }
          socket.write(JSON.stringify({ id: req.id, ok: true, version, protocol: DAEMON_PROTOCOL, pid: process.pid }) + "\n");
        }
      },
    },
  });
  return { stops: () => stops, close: () => server.stop(true) };
}

const DAEMON_ARGV = [process.execPath, join(import.meta.dir, "../src/cli/main.ts"), "daemon"];

test("versions order as releases do: numbers by value, a release above its own pre-releases", () => {
  expect(compareVersions("0.19.2", "0.20.0")).toBe(-1);
  expect(compareVersions("0.20.0", "0.19.12")).toBe(1);
  expect(compareVersions("v0.20.0", "0.20.0")).toBe(0);
  expect(compareVersions("0.20.0", "0.20.0-rc.5")).toBe(1);
  expect(compareVersions("0.20.0-rc.5", "0.20.0-rc.12")).toBe(-1);
});

test("an older kiwi keeps a newer daemon running instead of replacing it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kiwi-daemon-newer-"));
  const fake = fakeDaemon(daemonSock(dir), "999.0.0");
  try {
    const hello = await ensureDaemon(dir, DAEMON_ARGV);
    expect(hello.version).toBe("999.0.0");
    expect(fake.stops()).toBe(0);
  } finally {
    fake.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a newer kiwi replaces an older daemon with its own", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kiwi-daemon-older-"));
  const sock = daemonSock(dir);
  const fake = fakeDaemon(sock, "0.0.1");
  try {
    const hello = await ensureDaemon(dir, DAEMON_ARGV);
    expect(fake.stops()).toBe(1);
    expect(hello.version).toBe(VERSION);
  } finally {
    fake.close();
    await stopDaemon(sock).catch(() => {});
    const end = Date.now() + 5_000;
    while ((await daemonHello(sock).catch(() => null)) && Date.now() < end) await Bun.sleep(50);
    rmSync(dir, { recursive: true, force: true });
  }
});
