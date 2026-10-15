import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "../src/client.ts";
import { who } from "../src/format.ts";
import { freeHandle, seededPick } from "../src/handles.ts";
import { generateIdentity } from "../src/identity.ts";
import { describeMember, NAME_RE } from "../src/membership.ts";
import { startRelay } from "../src/relay/bun.ts";
import { fold } from "../src/state.ts";
import { checked } from "./check.ts";

setDefaultTimeout(60_000);

const HANDLE = /^[a-z]+-[a-z]+$/;

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-handles-"));
let server: ReturnType<typeof startRelay>;
let relay: string;
beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
});
afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

describe("handles", () => {
  test("a handle is an animal and a nice adjective, and a valid name", () => {
    for (let i = 0; i < 200; i++) {
      const h = freeHandle([]);
      expect(h).toMatch(HANDLE);
      expect(NAME_RE.test(h)).toBe(true);
    }
    expect(freeHandle([], () => 0)).toBe("otter-gentle");
  });

  test("a handle anyone holds, in any case, is never offered again", () => {
    const picks = [0, 0, 0, 0, 1, 1];
    const pick = () => picks.shift() ?? 0;
    expect(freeHandle([{ name: "Otter-Gentle" }], pick)).toBe("heron-brave");
  });

  test("a handle seeded by a key is the same every time it's offered, and differs between keys", () => {
    const a = freeHandle([], seededPick("key-a"));
    expect(a).toMatch(HANDLE);
    expect(freeHandle([], seededPick("key-a"))).toBe(a);
    const others = new Set(["key-b", "key-c", "key-d", "key-e"].map((k) => freeHandle([], seededPick(k))));
    expect(others.size).toBeGreaterThan(1);
    expect(freeHandle([{ name: a }], seededPick("key-a"))).not.toBe(a);
  });

  test("when every pick is taken, a numbered one is offered instead", () => {
    expect(freeHandle([{ name: "otter-gentle" }], () => 0)).toBe("otter-gentle-2");
  });
});

describe("nicknames", () => {
  test("an agent asks under a handle with a nickname; the owner signs both, and can rename it later without touching the handle", async () => {
    const owner = await generateIdentity("human");
    const made = await Channel.create(relay, owner, { name: "human", kind: "human" }, []);
    const ownerCh = new Channel(made.access, relay, owner);
    const asks = [];
    for (const handle of ["otter-gentle", "heron-brave"]) {
      const id = await generateIdentity(handle);
      asks.push({ id, requestId: (await Channel.requestJoin(relay, made.code, id, { name: handle, display: "claude", auto: true })).requestId });
    }
    for (const r of await checked(ownerCh, relay, made.code, asks)) {
      expect(r.display).toBe("claude");
      await ownerCh.approve(r);
    }
    const twins = (await ownerCh.members()).filter((m) => !m.owner);
    expect(twins.map((m) => m.name).sort()).toEqual(["heron-brave", "otter-gentle"]);
    expect(twins.map((m) => m.display)).toEqual(["claude", "claude"]);

    const otter = twins.find((m) => m.name === "otter-gentle")!;
    await ownerCh.updateNickname(otter, "reviewer bot");
    const after = (await ownerCh.members()).find((m) => m.pk === otter.pk)!;
    expect(after.name).toBe("otter-gentle");
    expect(after.display).toBe("reviewer bot");
    expect(describeMember(after)).toStartWith("reviewer bot (@otter-gentle) · key ");

    const agentCh = new Channel(await Channel.resume(relay, made.code, asks[0]!.id), relay, asks[0]!.id);
    await agentCh.send("still me");
    const { messages } = await ownerCh.history(0);
    const state = fold(messages, await ownerCh.members());
    const sent = messages.find((m) => m.body === "still me")!;
    expect(state.trust.get(sent.seq)).toBe("verified");
    expect(who(sent.from, state)).toBe("otter-gentle (reviewer bot)");

    await ownerCh.updateNickname(after, null);
    expect((await ownerCh.members()).find((m) => m.pk === otter.pk)!.display).toBeUndefined();
  });

  test("a person's name isn't renamed this way", async () => {
    const owner = await generateIdentity("human");
    const pat = await generateIdentity("pat");
    const made = await Channel.create(relay, owner, { name: "human", kind: "human" }, [{ ...pat, info: { name: "pat", kind: "human", display: "Pat Doe" } }]);
    const ownerCh = new Channel(made.access, relay, owner);
    const member = (await ownerCh.members()).find((m) => m.name === "pat")!;
    await expect(ownerCh.updateNickname(member, "someone else")).rejects.toThrow(/only an agent's nickname/);
  });
});
