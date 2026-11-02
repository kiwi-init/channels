import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import type { Identity } from "@kiwi/core/identity.ts";
import { keptSeals, SEALS_PER_KEY } from "@kiwi/core/private-room.ts";
import { fold, rosterOf } from "@kiwi/core/state.ts";
import { runAgent } from "../src/agent.ts";
import { startRelay } from "../src/relay/bun.ts";
import { joinAgent, pairComputer, setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(300_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-room-history-"));
let server: ReturnType<typeof startRelay>;
let s: OwnerSetup;
let ana: { id: Identity; ch: Channel };
let cy: { id: Identity; ch: Channel };

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  s = await setupChannel(server.url.origin);
  const computer = await pairComputer(s.person);
  ana = await joinAgent(s, "ana", computer);
  cy = await joinAgent(s, "cy", computer);
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

const pick = (x: { id: Identity }, name: string) => ({ name, pk: x.id.pk, xpk: x.id.xpk! });

describe("a private room's history keeps what a late member needs to trust it (T868)", () => {
  test("of each key number it keeps the first and the last changes, and always the room's first", () => {
    const list = [1, 1, ...Array.from({ length: 40 }, () => 1), 2, 2, 3, ...Array.from({ length: 30 }, () => 3)].map((n, i) => ({ n, i }));
    const kept = keptSeals(list, (x) => x.n);
    expect(kept[0]).toEqual({ n: 1, i: 0 });
    for (const n of [1, 2, 3]) {
      const all = list.filter((x) => x.n === n);
      const mine = kept.filter((x) => x.n === n);
      expect(mine.length).toBe(Math.min(all.length, SEALS_PER_KEY * 2));
      expect(mine[0]).toEqual(all[0]);
      expect(mine.at(-1)).toEqual(all.at(-1));
    }
  });

  test("after 250 changes, 16 of them new keys, a member added last trusts the room, live and from the snapshot", async () => {
    const id = await s.ownerCh.makeRoom("long", [pick(cy, "cy")]);
    let cyIn = true;
    for (let i = 0; i < 250; i++) {
      if (i % 8 === 0 && i < 240) {
        cyIn = !cyIn;
        await s.ownerCh.changeRoom(id, { members: cyIn ? [pick(cy, "cy")] : [] });
      } else await s.ownerCh.changeRoom(id, { name: `long-${i}` });
    }
    await s.ownerCh.changeRoom(id, { members: [pick(ana, "ana")], name: "late" });
    const owner = fold((await s.ownerCh.history(0)).messages, rosterOf(await s.ownerCh.members()));
    const room = owner.secret.get(id)!;
    expect(room.n).toBe(17);
    expect(room.seals.length).toBe(252);

    await ana.ch.history(0);
    const said = await ana.ch.send("made it in", { room: id });
    const live = fold((await ana.ch.history(0)).messages, rosterOf(await s.ownerCh.members()));
    expect([live.rooms.get(id)?.name, live.rejected.get(said)]).toEqual(["late", undefined]);

    expect(await runAgent(s.ownerCh.fx.snapshotIfDue(1))).toBeGreaterThan(0);
    const fresh = new Channel(ana.ch.access, s.relay, ana.id);
    const base = (await fresh.snapshot())!;
    expect(base.rooms.find((r) => r.id === id)?.name).toBe("late");
    expect(base.secret?.find(([x]) => x === id)?.[1].seals.length).toBeLessThan(252);
    const again = await fresh.send("from the snapshot", { room: id });
    const after = fold((await fresh.history(base.n)).messages, rosterOf(await s.ownerCh.members()), Date.now(), null, null, base);
    expect([after.rooms.get(id)?.name, after.rejected.get(again)]).toEqual(["late", undefined]);
  });
});
