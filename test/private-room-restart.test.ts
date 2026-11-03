import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRows, packEnvelope, packRow, type CachedRow } from "@kiwi/core/cache-row.ts";
import { seal, type ChannelAccess } from "@kiwi/core/crypto.ts";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import { asSent, type Message } from "@kiwi/core/protocol.ts";
import { fold, rosterOf } from "@kiwi/core/state.ts";
import type { ChannelIdentityView } from "../desktop/src/bridge.ts";
import { Keyring, type KeyHost } from "../desktop/src/keyring.ts";
import { acceptSeat, channelAccess, withAccess } from "../desktop/src/seats.ts";
import { startRelay } from "../src/relay/bun.ts";
import { memoryBudget } from "./check.ts";
import { joinDevice, joinPerson, setupChannel } from "./owner.ts";

setDefaultTimeout(60_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-room-restart-"));
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

function memHost(store: { seats: ChannelIdentityView[] }): KeyHost {
  return {
    relay: () => relay,
    seats: () => store.seats,
    save: async (entry) => void (store.seats = acceptSeat(store.seats, entry)),
    access: async (code, pk, access) => void (store.seats = withAccess(store.seats, code, pk, access)),
    forget: async (code) => void (store.seats = store.seats.filter((c) => c.code !== code)),
    prove: async () => null,
    githubToken: async () => null,
    person: () => null,
    mine: () => null,
    budget: memoryBudget(),
  };
}

const isMessage = (m: unknown): m is Message => !!m && typeof m === "object" && !("unread" in m);

async function rowsOf(ch: Channel, access: ChannelAccess): Promise<CachedRow[][]> {
  const key = access.keys[String(access.epoch)]!;
  const { messages: envelopes } = await ch.envelopes(0, 100);
  const raw = await Promise.all(envelopes.map((e) => packEnvelope(key, access.roomId, access.epoch, e)));
  const packed = await Promise.all((await ch.history(0)).messages.map((m) => packRow(key, access.roomId, access.epoch, m)));
  return [raw, packed];
}

async function restart(access: ChannelAccess, id: Identity, rows: CachedRow[]): Promise<Message[]> {
  const fresh = new Channel(access, relay, id);
  return (await fresh.learnRooms(await openRows(rows, access.roomId, access.keys))).filter(isMessage);
}

test("a private room its maker sealed comes back after the app restarts on its own cache (T157)", async () => {
  const store = { seats: [] as ChannelIdentityView[] };
  const made = await new Keyring(memHost(store)).create("plans", null, null);
  const seat = store.seats.find((s) => s.code === made.code)!;
  const access = channelAccess(seat)!;
  const me = { name: seat.idName ?? seat.label, pk: seat.pk, sk: seat.sk, ...(seat.xpk ? { xpk: seat.xpk } : {}), ...(seat.xsk ? { xsk: seat.xsk } : {}) };
  const app = new Channel(access, relay, me);
  const room = await app.makeRoom("explorations", []);
  const said = await app.send("only for me", { room });

  const key = access.keys[String(access.epoch)]!;
  const { messages: envelopes } = await app.envelopes(0, 100);
  const raw: CachedRow[] = await Promise.all(envelopes.map((e) => packEnvelope(key, access.roomId, access.epoch, e)));
  const live = (await app.history(0)).messages;
  const packed: CachedRow[] = await Promise.all(live.map((m) => packRow(key, access.roomId, access.epoch, m)));

  const before: CachedRow[] = await Promise.all(
    live.map(async (m) => {
      const { seq, rts, sigOk, ...payload } = asSent(m);
      void sigOk;
      const sealed = await seal(key, access.roomId, { seq, msg: payload });
      return { seq, ...(rts !== undefined ? { rts } : {}), e: access.epoch, iv: sealed.iv, ct: sealed.ct };
    }),
  );

  for (const rows of [raw, packed, before]) {
    const restarted = new Keyring(memHost(store));
    const opened = (await restarted.openRows(seat.code!, rows)).filter(isMessage);
    const state = fold(opened, rosterOf(await app.members()));
    expect([...state.rejected]).toEqual([]);
    expect(state.rooms.get(room)?.name).toBe("explorations");
    expect(opened.find((m) => m.seq === said)?.body).toBe("only for me");
  }
});

test("a room that took in a member later comes back for its maker and for that member after a restart (T157)", async () => {
  const s = await setupChannel(relay);
  const tia = await joinPerson(s, "tia", await generateIdentity("tia-person"));
  const live = async (ch: Channel) => [...fold((await ch.history(0)).messages, rosterOf(await s.ownerCh.members())).rejected];
  const room = await s.ownerCh.makeRoom("explorations", []);
  await s.ownerCh.send("before tia", { room });
  expect(await s.ownerCh.changeRoom(room, { members: [{ name: tia.member.name, pk: tia.id.pk, xpk: tia.id.xpk! }] })).toBe(true);
  const said = await tia.ch.send("tia is in", { room });

  for (const [who, ch] of [
    [s.owner, s.ownerCh],
    [tia.id, tia.ch],
  ] as const) {
    const before = await live(ch);
    for (const rows of await rowsOf(ch, ch.access)) {
      const opened = await restart(ch.access, who, rows);
      const state = fold(opened, rosterOf(await s.ownerCh.members()));
      expect([...state.rejected]).toEqual(before);
      expect(
        state.rooms
          .get(room)
          ?.members?.map((m) => m.pk)
          .sort(),
      ).toEqual([s.owner.pk, tia.id.pk].sort());
      expect(opened.find((m) => m.seq === said)?.body).toBe("tia is in");
    }
  }
});

test("a room its maker made on one device comes back on that person's other device after its restart (T551)", async () => {
  const s = await setupChannel(relay);
  const phone = await joinDevice(s, s.person, s.owner.name);
  const room = await s.ownerCh.makeRoom("explorations", []);
  const said = await s.ownerCh.send("from my desk", { room });
  const fromPhone = await phone.ch.send("from my phone", { room });

  const before = [...fold((await phone.ch.history(0)).messages, rosterOf(await s.ownerCh.members())).rejected];
  for (const rows of await rowsOf(phone.ch, phone.ch.access)) {
    const opened = await restart(phone.ch.access, phone.id, rows);
    const state = fold(opened, rosterOf(await s.ownerCh.members()));
    expect([...state.rejected]).toEqual(before);
    expect(
      state.rooms
        .get(room)
        ?.members?.map((m) => m.pk)
        .sort(),
    ).toEqual([s.owner.pk, phone.id.pk].sort());
    expect(opened.find((m) => m.seq === said)?.body).toBe("from my desk");
    expect(opened.find((m) => m.seq === fromPhone)?.body).toBe("from my phone");
  }
});
