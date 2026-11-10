import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import type { Event } from "@kiwi/core/protocol.ts";
import { fold } from "@kiwi/core/state.ts";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(30_000);

describe("a task landed whose response is lost (#3930 case 16)", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-step-retry-"));
  let owner: Identity;
  let access: ConstructorParameters<typeof Channel>[0];
  let relay: string;
  let server: ReturnType<typeof startRelay>;

  beforeAll(async () => {
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
    relay = server.url.origin;
    owner = await generateIdentity("stepper");
    access = (await Channel.create(relay, owner, { name: "stepper", kind: "human" }, [])).access;
  });
  afterAll(() => {
    server.stop(true);
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("the client resends the same event with step 1's id: the channel holds it once, step 1 ended once, and step 2 stays open", async () => {
    const direct = new Channel(access, relay, owner);
    const event = (ch: Channel, ev: Event) => ch.send("", { kind: "event", ev });
    const t = await event(direct, { op: "task.add", title: "ship", owner: "stepper", steps: [{ words: "tag the build" }, { words: "publish the notes" }] });
    await event(direct, { op: "task.update", task: t, state: "done", verdict: "approved" });
    const sent: string[] = [];
    let failed = false;
    const proxy = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: async (req) => {
        const url = new URL(req.url);
        const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
        const upstream = await fetch(relay + url.pathname + url.search, { method: req.method, headers: req.headers, ...(body !== undefined ? { body } : {}) });
        if (req.method !== "POST" || !url.pathname.endsWith("/messages")) return upstream;
        sent.push((JSON.parse(body ?? "{}") as { cid?: string }).cid ?? "");
        if (failed) return upstream;
        failed = true;
        await upstream.text();
        return Response.json({ error: "the channel is busy or restarting, and this may have gone through: look before you send it again" }, { status: 503 });
      },
    });
    try {
      const flaky = new Channel(access, proxy.url.origin, owner);
      const seq = await event(flaky, { op: "task.landed", task: t, step: "s1" });
      expect(sent).toHaveLength(2);
      expect(sent[1]).toBe(sent[0]!);
      const { messages } = await new Channel(access, relay, owner).history(0);
      const landed = messages.filter((m) => m.ev?.op === "task.landed");
      expect(landed.map((m) => [m.seq, m.ev])).toEqual([[seq, { op: "task.landed", task: t, step: "s1" }]]);
      const state = fold(messages, [{ name: "stepper", pk: owner.pk, owner: true, at: 0, active: true, kind: "human" }]);
      const task = state.tasks.get(t)!;
      expect(state.rejected.size).toBe(0);
      expect(task.state).toBe("landing");
      expect(task.steps!.map((x) => [x.id, x.progress.kind])).toEqual([
        ["s1", "ended"],
        ["s2", "open"],
      ]);
      expect(task.steps![0]!.progress).toMatchObject({ end: { how: "said", seq } });
    } finally {
      proxy.stop(true);
    }
  });
});
