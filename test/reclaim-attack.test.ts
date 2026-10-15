// A seat never moves to a new key (T1426: reclaim is gone; a lost key means the owner
// removes the old seat and the agent joins again). Asking under a taken name, even
// with the old reclaim flag, is a plain join under the next free name.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel, RelayError } from "../src/client.ts";
import { generateIdentity, sign, verify, type Identity } from "../src/identity.ts";
import type { Message } from "../src/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";
import { fold } from "../src/state.ts";

setDefaultTimeout(60_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-reclaim-attack-"));
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

async function seat(extra: { id: Identity; info: { name: string; kind?: "human" | "agent"; role?: string } }[] = []) {
  const owner = await generateIdentity("human");
  const oldKey = await generateIdentity("win");
  const made = await Channel.create(relay, owner, { name: "human", kind: "human" }, [
    { ...oldKey, info: { name: "win", role: "windows", kind: "agent" } },
    ...extra.map((e) => ({ ...e.id, info: e.info })),
  ]);
  const ownerCh = new Channel(made.access, relay, owner);
  const oldCh = new Channel(await Channel.resume(relay, made.code, oldKey), relay, oldKey);
  return { owner, oldKey, code: made.code, ownerCh, oldCh };
}

function active(members: { name: string; pk: string; active: boolean }[], name: string): string[] {
  return members.filter((m) => m.name === name && m.active).map((m) => m.pk);
}

describe("no seat moves to a new key", () => {
  test("an agent asking under a person's name is offered an agent's name, never theirs with a number", async () => {
    const pat = await generateIdentity("pat");
    const { code, ownerCh } = await seat([{ id: pat, info: { name: "pat", kind: "human" } }]);
    for (const name of ["pat", "human"]) {
      const id = await generateIdentity(name);
      const { requestId } = await Channel.requestJoin(relay, code, id, { name });
      const r = (await ownerCh.requests()).find((x) => x.id === requestId)!;
      if (name === "pat") {
        expect(r.name).toMatch(/^[a-z]+-[a-z]+$/);
        expect(r.display).toBeUndefined();
      } else expect(r.askedAs).toBeUndefined();
    }
  });

  test("a new key asking under a taken name, even as a reclaim, is offered a free handle and keeps the name as its nickname", async () => {
    const { oldKey, code, ownerCh } = await seat();
    const newbie = await generateIdentity("win");
    const { requestId } = await Channel.requestJoin(relay, code, newbie, { name: "win", reclaim: true });
    const first = (await ownerCh.requests()).find((r) => r.id === requestId)!;
    expect(first.name).toMatch(/^[a-z]+-[a-z]+$/);
    expect(first.display).toBe("win");
    expect(first.askedAs).toBe("win");
    await ownerCh.checkRequest(first);
    await Channel.joinStatus(relay, code, newbie, requestId);
    await ownerCh.approve((await ownerCh.requests()).find((r) => r.id === requestId)!);
    const members = await ownerCh.members();
    expect(active(members, "win")).toEqual([oldKey.pk]);
    expect(active(members, first.name)).toEqual([newbie.pk]);
    expect(members.find((m) => m.pk === newbie.pk)?.display).toBe("win");
  });

  test("a request with no owner approval grants nothing", async () => {
    const { oldKey, code, ownerCh } = await seat();
    const newbie = await generateIdentity("win");
    const { requestId } = await Channel.requestJoin(relay, code, newbie, { name: "win", reclaim: true });
    expect((await Channel.joinStatus(relay, code, newbie, requestId)).status).toBe("pending");
    await expect(Channel.resume(relay, code, newbie)).rejects.toBeInstanceOf(RelayError);
    expect(active(await ownerCh.members(), "win")).toEqual([oldKey.pk]);
  });

  test("a seat.reclaim event that isn't from the owner is rejected and moves nothing", async () => {
    const { oldKey, ownerCh, oldCh } = await seat();
    await oldCh.send("I took it", { ev: { op: "seat.reclaim", member: "win", from: "deadbeef", to: "cafebabe" } });
    const { messages } = await ownerCh.history(0);
    const members = await ownerCh.members();
    const state = fold(
      messages,
      members.map((m) => ({ name: m.name, pk: m.pk, role: m.role, owner: m.owner, at: m.at, active: m.active, kind: m.kind })),
    );
    const event = messages.find((m) => m.ev?.op === "seat.reclaim")!;
    // The signature is win's, so it verifies, but only the owner may record a move.
    expect(state.trust.get(event.seq)).toBe("verified");
    expect(state.rejected.get(event.seq)).toMatch(/only the owner/);
    expect(active(members, "win")).toEqual([oldKey.pk]);

    // A signature under win's name from a key the owner never admitted never verifies.
    const evil = await generateIdentity("evil");
    const forged = await forgedMessage(evil, "win", { op: "seat.reclaim", member: "win", from: "deadbeef", to: "cafebabe" });
    const folded = fold(
      [...messages, forged],
      members.map((m) => ({ name: m.name, pk: m.pk, role: m.role, owner: m.owner, at: m.at, active: m.active, kind: m.kind })),
    );
    expect(folded.trust.get(forged.seq)).toBe("forged");
    expect(active(members, "win")).toEqual([oldKey.pk]);
  });

  test("the same key resumes without a request or an approval", async () => {
    const { oldKey, code, ownerCh } = await seat();
    const before = (await ownerCh.requests()).length;
    const access = await Channel.resume(relay, code, oldKey);
    expect(access.keys["0"]).toBeTruthy();
    expect((await ownerCh.requests()).length).toBe(before);
    const ch = new Channel(access, relay, oldKey);
    expect(active(await ch.members(), "win")).toEqual([oldKey.pk]);
  });
});

async function forgedMessage(id: Identity, from: string, ev: { op: "seat.reclaim"; member: string; from: string; to: string }): Promise<Message> {
  const base = { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "forged", ts: Date.now(), ev };
  const signed = await sign(id, base);
  return { ...signed, seq: 99, rts: base.ts, sigOk: await verify(signed) };
}
