import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { daemonAdopt, daemonHello, daemonSocketPath, type AdoptParams } from "../desktop/src/daemon-client.ts";

type Answer = (conn: net.Socket) => void;

const homes: string[] = [];
const servers: net.Server[] = [];

afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const h of homes.splice(0)) fs.rmSync(h, { recursive: true, force: true });
});

async function fakeDaemon(answer: Answer): Promise<string> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-close-"));
  homes.push(home);
  const server = net.createServer((conn) => conn.once("data", () => answer(conn)));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(daemonSocketPath(home), resolve));
  return home;
}

const params: AdoptParams = {
  cert: { kind: "kiwi-machine-cert", v: 1, name: "Ana", machine: "m", mxpk: "x", label: "laptop", at: 0, pk: "p", sig: "s" },
  person: { pk: "p", xpk: "x", name: "Ana" },
};
const adopt = (home: string, timeoutMs: number) => daemonAdopt(home, params, timeoutMs);

test.skipIf(process.platform === "win32")("a daemon that closes without a reply fails the call at once", async () => {
  const home = await fakeDaemon((conn) => conn.end());
  const started = Date.now();
  await expect(adopt(home, 5_000)).rejects.toThrow("the daemon closed the connection");
  expect(Date.now() - started).toBeLessThan(500);
});

test.skipIf(process.platform === "win32")("a full reply and then a close still succeeds", async () => {
  const home = await fakeDaemon((conn) => conn.end(`${JSON.stringify({ id: 1, ok: true, version: "0.12.0", machine: "m", mxpk: "x", certified: false, person: null })}\n`));
  expect(await daemonHello(home, 5_000)).toEqual({ version: "0.12.0", machine: { pk: "m", xpk: "x" }, paired: null });
  await adopt(home, 5_000);
});

test.skipIf(process.platform === "win32")("a daemon that never answers still times out", async () => {
  const home = await fakeDaemon(() => {});
  await expect(adopt(home, 200)).rejects.toThrow("the daemon didn't answer");
});

test.skipIf(process.platform === "win32")("hello is null when the daemon closes without a reply", async () => {
  const home = await fakeDaemon((conn) => conn.destroy());
  expect(await daemonHello(home, 5_000)).toBeNull();
});
