import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { usableBase } from "@kiwi/channel/base-plan.ts";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { fold, rosterOf, type ChannelState } from "@kiwi/core/state.ts";
import { runAgent } from "../src/agent.ts";
import { startRelay } from "../src/relay/bun.ts";
import { joinDevice, joinPerson, setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(120_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-self-room-"));
let server: ReturnType<typeof startRelay>;
let s: OwnerSetup;

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  s = await setupChannel(server.url.origin);
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

const state = async (): Promise<ChannelState> => fold((await s.ownerCh.history(0)).messages, rosterOf(await s.ownerCh.members()));
const selfRoomsOf = async (pk: string) => [...(await state()).rooms.values()].filter((r) => r.self && r.members?.some((m) => m.pk === pk));

describe("a person keeps one room of their own, whichever device they join from (T1477)", () => {
  test("a device that joins after the room exists uses it, and the person's other device lists it on its next sync", async () => {
    const person = await generateIdentity("tia-person");
    const desk = await joinPerson(s, "tia", person);
    expect(await desk.ch.syncMarks({ main: 10 })).toEqual({ main: 10 });
    const [room] = await selfRoomsOf(desk.id.pk);
    expect(room).toBeDefined();

    const phone = await joinDevice(s, person, "tia");
    await phone.ch.history(0);
    expect(await phone.ch.syncMarks({}, { write: false })).toEqual({ main: 10 });
    expect(await phone.ch.syncMarks({ main: 20 })).toEqual({ main: 20 });
    expect((await selfRoomsOf(desk.id.pk)).map((r) => r.id)).toEqual([room!.id]);
    expect((await state()).rooms.get(room!.id)?.members?.map((m) => m.pk)).not.toContain(phone.id.pk);

    await desk.ch.history(0);
    expect(await desk.ch.syncMarks({}, { write: false })).toEqual({ main: 20 });
    expect(await desk.ch.syncMarks({ main: 21 })).toEqual({ main: 21 });
    const after = await state();
    expect(
      after.rooms
        .get(room!.id)
        ?.members?.map((m) => m.pk)
        .sort(),
    ).toEqual([desk.id.pk, phone.id.pk].sort());
    expect([...after.rejected.values()]).not.toContain("only its members change a direct message or a person's own room");

    await phone.ch.history(0);
    expect(await phone.ch.syncMarks({ main: 22 })).toEqual({ main: 22 });
    expect((await selfRoomsOf(desk.id.pk)).map((r) => r.id)).toEqual([room!.id]);
  });
});

describe("a session that hasn't seen the whole log never makes the person's room (T1478)", () => {
  const WINDOW = 20;

  const launch = async (ch: Channel, marks: Record<string, number>): Promise<Record<string, number> | null> => {
    const fresh = new Channel(ch.access, s.relay, ch.identity);
    const head = await fresh.head();
    const since = Math.max(0, head - WINDOW);
    const base = since > 0 ? usableBase(await fresh.snapshot(), since) : null;
    await fresh.history(since);
    return fresh.syncMarks(marks, { make: since === 0 || base !== null });
  };

  let desk: { id: { pk: string }; ch: Channel };

  test("a phone that loads only its window, past a stale snapshot, makes no room on any launch", async () => {
    desk = await joinPerson(s, "lu", await generateIdentity("lu-person"));
    for (let i = 0; i < 5; i++) await s.ownerCh.send(`before ${i}`);
    expect(await runAgent(s.ownerCh.fx.snapshotIfDue(1))).toBeGreaterThan(0);
    expect(await desk.ch.syncMarks({ main: 1 })).toEqual({ main: 1 });
    expect(await selfRoomsOf(desk.id.pk)).toHaveLength(1);
    for (let n = 0; n < 3; n++) {
      for (let i = 0; i < WINDOW + 5; i++) await s.ownerCh.send(`chatter ${n}.${i}`);
      expect(await launch(desk.ch, { main: 2 + n })).toBeNull();
      expect(await selfRoomsOf(desk.id.pk)).toHaveLength(1);
    }
  });

  test("a desktop that opens from its cache learns the room from the cached rows", async () => {
    const fresh = new Channel(desk.ch.access, s.relay, desk.ch.identity);
    await fresh.learnRooms((await s.ownerCh.history(0)).messages);
    expect(await fresh.syncMarks({ main: 4 })).toEqual({ main: 4 });
    expect(await selfRoomsOf(desk.id.pk)).toHaveLength(1);
  });

  test("once a snapshot covers the room, a launch finds it and syncs", async () => {
    expect(await runAgent(s.ownerCh.fx.snapshotIfDue(1))).toBeGreaterThan(0);
    for (let i = 0; i < WINDOW + 5; i++) await s.ownerCh.send(`more ${i}`);
    expect(await launch(desk.ch, { main: 5 })).toEqual({ main: 5 });
    expect(await selfRoomsOf(desk.id.pk)).toHaveLength(1);
  });
});
