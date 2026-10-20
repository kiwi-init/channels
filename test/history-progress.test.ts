import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-history-progress-"));
const real = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
let served = 0;
let page: string | null = null;
const lying = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    const body = req.method === "GET" ? undefined : await req.text();
    const upstream = () => fetch(`${real.url.origin}${url.pathname}${url.search}`, { method: req.method, headers: req.headers, body });
    if (!url.pathname.endsWith("/messages")) return upstream();
    served++;
    page ??= await (await upstream()).text();
    const replayed = JSON.parse(page) as { head: number; messages: unknown[] };
    return Response.json({ head: 1_000_000, messages: replayed.messages });
  },
});

afterAll(() => {
  lying.stop(true);
  real.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

test("a relay that serves the same page forever under a head it never reaches can't keep history() looping", async () => {
  const owner = await generateIdentity("boss");
  const { access } = await Channel.create(real.url.origin, owner, { name: "boss" });
  const honest = new Channel(access, real.url.origin, owner);
  for (const body of ["one", "two", "three"]) await honest.send(body);
  const ch = new Channel(access, lying.url.origin, owner);
  const read = await Promise.race([ch.history(0), Bun.sleep(5_000).then(() => null)]);
  expect(read).not.toBeNull();
  expect(read!.messages.map((m) => m.body)).toEqual(["one", "two", "three"]);
  expect(served).toBeLessThanOrEqual(2);
});
