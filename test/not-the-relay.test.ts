// A 200 that didn't come from the relay (a captive portal, a proxy's page) is the relay being away, never an answer.

import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(60_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-not-the-relay-"));
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

const PAGE = "<!doctype html><title>Sign in to Airport Wi-Fi</title>";

async function behindPortal<T>(answer: () => Response, run: (ch: Channel, real: Channel) => Promise<T>): Promise<T> {
  const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  const portal = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: answer });
  try {
    const owner = await generateIdentity("human");
    const { access } = await Channel.create(server.url.origin, owner, { name: "human" });
    const real = new Channel(access, server.url.origin, owner);
    await real.send("before the portal");
    return await run(new Channel(access, portal.url.origin, owner), real);
  } finally {
    portal.stop(true);
    server.stop(true);
  }
}

const html = () => new Response(PAGE, { headers: { "content-type": "text/html" } });

test("a sign-in page is not a head, a roster, a history or a snapshot", async () => {
  await behindPortal(html, async (ch) => {
    await expect(ch.head()).rejects.toThrow("didn't come from the relay");
    await expect(ch.members()).rejects.toThrow("didn't come from the relay");
    await expect(ch.history(0)).rejects.toThrow("didn't come from the relay");
    expect(await ch.snapshot().catch((err: unknown) => String(err))).toContain("didn't come from the relay");
  });
});

test("a message sent into a sign-in page is not sent", async () => {
  await behindPortal(html, async (ch, real) => {
    await expect(ch.send("into the portal")).rejects.toThrow("didn't come from the relay");
    expect((await real.history(0)).messages.filter((m) => m.kind === "msg").map((m) => m.body)).toEqual(["before the portal"]);
  });
});

test("JSON that isn't the relay's is no head either", async () => {
  for (const body of ['{"portal":true}', '"ok"', "[]", '{"head":"12"}', '{"head":-1}', '{"head":1.5}']) {
    await behindPortal(
      () => new Response(body, { headers: { "content-type": "application/json" } }),
      async (ch) => {
        await expect(ch.head()).rejects.toThrow();
      },
    );
  }
});

test("the real relay still answers", async () => {
  await behindPortal(html, async (_, real) => {
    expect(await real.head()).toBeGreaterThan(0);
    expect((await real.members()).length).toBe(1);
  });
});
