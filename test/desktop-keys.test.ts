import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ChannelIdentityView, ChannelOps, DocEvent, FollowEvent, KeysAsk, KeysPort, KeysPush, KeysReply } from "../desktop/src/bridge.ts";
import { snapshotOf } from "../desktop/src/guard.ts";
import { editable, Keyring, type KeyHost } from "../desktop/src/keyring.ts";
import { serveKeys } from "../desktop/src/keys-server.ts";
import { acceptSeat, mergePublicChannels, migrateEntries, movedRelay, publicChannel, withAccess } from "../desktop/src/seats.ts";
import { fromWire, toWire } from "../desktop/src/wire.ts";
import { remoteOps } from "@kiwi/channel/channel-remote.ts";
import { ChannelGone } from "@kiwi/core/client.ts";
import { b64url, decodeJoinCode, encodeJoinCode, fromB64url, newRoomId } from "@kiwi/core/crypto.ts";
import { DOC_LEVEL, raiseWriterFloor } from "@kiwi/core/doc/level.ts";
import { fileDocStore } from "@kiwi/core/node/doc-store.ts";
import type { PipeIn } from "@kiwi/core/doc/held-pipe.ts";
import * as Y from "yjs";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import type { CachedRow } from "@kiwi/core/cache-row.ts";
import type { Member } from "@kiwi/core/membership.ts";
import { provePerson } from "@kiwi/core/person.ts";
import { startRelay } from "../src/relay/bun.ts";
import { memoryBudget } from "./check.ts";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(join(tmpdir(), "mc-keys-"));
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

interface Store {
  seats: ChannelIdentityView[];
}

function memHost(person: Identity | null): { host: KeyHost; store: Store } {
  const store: Store = { seats: [] };
  const host: KeyHost = {
    relay: () => relay,
    seats: () => store.seats,
    save: async (entry) => void (store.seats = acceptSeat(store.seats, entry)),
    access: async (code, pk, access) => void (store.seats = withAccess(store.seats, code, pk, access)),
    forget: async (code) => void (store.seats = store.seats.filter((c) => c.code !== code)),
    prove: async (code, memberPk) => (person ? { person: await provePerson(person, decodeJoinCode(code).roomId, memberPk) } : null),
    githubToken: async () => null,
    person: () => person?.pk ?? null,
    mine: () => null,
    budget: memoryBudget(),
  };
  return { host, store };
}

interface Window {
  ops: ChannelOps;
  sent: unknown[];
}

function window(k: Keyring): Window {
  const sent: unknown[] = [];
  const listeners = new Set<(p: KeysPush) => void>();
  const session = serveKeys(k, (p) => {
    const copy = structuredClone(p);
    sent.push(copy);
    for (const l of listeners) l(copy);
  });
  let id = 1;
  const port: KeysPort = {
    request: async (ask: KeysAsk) => {
      const reply = (await session.handle(structuredClone({ ...ask, id: id++ }))) as KeysReply;
      const copy = structuredClone(reply);
      sent.push(copy);
      return copy;
    },
    onPush: (cb) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    onRestart: () => () => {},
  };
  return { ops: remoteOps(port), sent };
}

function secretsOf(...stores: Store[]): string[] {
  const out: string[] = [];
  for (const s of stores)
    for (const c of s.seats) {
      out.push(c.sk);
      if (c.xsk) out.push(c.xsk);
      const keys = c.access && typeof c.access === "object" ? (c.access as { keys?: Record<string, string> }).keys : undefined;
      if (keys) out.push(...Object.values(keys));
    }
  return out;
}

function keyNames(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) for (const x of v) keyNames(x, out);
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keyNames(x, out);
    }
  return out;
}

async function until<T>(get: () => T | undefined, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = get();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(25);
  }
}

describe("channel keys stay out of the window (T203 step 2)", () => {
  test("create, join, chat, cache, rotate, remove, restart and close: no secret key reaches the window", async () => {
    const ada = await generateIdentity("Ada");
    const bo = await generateIdentity("Bo");
    const a = memHost(ada);
    const b = memHost(bo);
    const aw = window(new Keyring(a.host));
    const bw = window(new Keyring(b.host));

    const made = await aw.ops.create("Keys test", null, { name: "Ada" });
    const code = made.code!;
    expect(made.access?.roomId).toBe(decodeJoinCode(code).roomId);
    expect(keyNames(made).has("sk")).toBe(false);
    expect((await aw.ops.call(code, "head")) ?? 0).toBe(0);

    const planted: ChannelIdentityView = { label: "bo", idName: "bo", pk: "planted-pk", sk: "planted-sk", code, requestId: "r", imported: true };
    b.store.seats = [planted];
    const asked = await bw.ops.requestJoin(code, "bo");
    expect(asked.pk).not.toBe("planted-pk");
    expect(asked.requestId).toBeTruthy();
    expect(b.store.seats[0]?.sk).toBeTruthy();
    await aw.ops.call(code, "requests");
    expect(await bw.ops.joinStatus(code)).toMatchObject({ status: "pending" });
    const req = (await aw.ops.call(code, "requests")).find((r) => r.pk === asked.pk);
    expect(req?.person).toBe(bo.pk);
    const forged = { ...req!, xpk: (await generateIdentity("mallory")).xpk!, person: "forged" };
    await aw.ops.call(code, "approve", forged, undefined, { person: "forged-person" });
    const joined = await bw.ops.joinStatus(code);
    expect(joined.status).toBe("in");

    const seen: FollowEvent[] = [];
    const stop = aw.ops.follow(code, 0, (e) => seen.push(e));
    await until(() => seen.find((e) => e._tag === "Open"));
    await aw.ops.presence(code, { client: "probe", query: true });
    await bw.ops.call(code, "send", "hello from bo", {});
    const got = await until(() => seen.find((e): e is Extract<FollowEvent, { _tag: "Message" }> => e._tag === "Message" && e.message.body === "hello from bo"));
    expect(got.row).not.toBeNull();
    const row = got.row as CachedRow;
    expect(JSON.stringify(row).includes("hello from bo")).toBe(false);
    expect((await aw.ops.openRows(code, [row]))[0]).toMatchObject({ body: "hello from bo" });
    const reopened = await aw.ops.reopenRows(code, [row]);
    expect(reopened.opened[0]).toMatchObject({ body: "hello from bo", sigOk: true });
    expect(reopened.rows).toEqual([]);
    stop();
    const log = await aw.ops.call(code, "history", 0);
    const signed = log.messages.find((m) => m.body === "hello from bo");
    expect(signed?.pk).toBe(asked.pk);
    expect(typeof signed?.sig).toBe("string");
    expect(signed?.sigOk).toBe(true);
    expect((await aw.ops.call(code, "history", -5)).messages.length).toBe(log.messages.length);

    const roster = await aw.ops.call(code, "members");
    const owner = roster.find((m) => m.owner)!;
    await expect(aw.ops.call(code, "updateNickname", owner, "x")).rejects.toThrow("can change");
    await expect(aw.ops.call(code, "updateScopes", { ...owner, pk: "not-a-member" }, [], 0)).rejects.toThrow("can change");
    await aw.ops.call(code, "remove", asked.pk);
    const gone = (await aw.ops.call(code, "members")).find((m) => m.pk === asked.pk);
    expect(gone?.active).toBeFalsy();
    if (gone) await expect(aw.ops.call(code, "updateNickname", gone, "x")).rejects.toThrow("can change");
    const seat = a.store.seats.find((c) => c.code === code)!;
    expect(publicChannel(seat).access?.epoch).toBe(1);
    expect(Object.keys((seat.access as { keys: Record<string, string> }).keys).sort()).toEqual(["0", "1"]);
    const out = await bw.ops.call(code, "head").catch((e: unknown) => e);
    expect(out).toBeInstanceOf(ChannelGone);

    const again = window(new Keyring(a.host));
    expect(await again.ops.call(code, "head")).toBeGreaterThan(0);
    expect((await again.ops.openRows(code, [row]))[0]).toMatchObject({ body: "hello from bo" });

    const snap = snapshotOf({ relayUrl: relay, person: null, channels: [...a.store.seats, ...b.store.seats], computers: [], pending: [] });
    for (const k of ["sk", "xsk", "keys"]) expect(keyNames(snap).has(k)).toBe(false);

    await again.ops.call(code, "close");
    await again.ops.forget(code);
    expect(a.store.seats.some((c) => c.code === code)).toBe(false);

    const secrets = [...secretsOf(b.store), ...secretsOf({ seats: [seat] }), ada.sk, bo.sk];
    expect(secrets.length).toBeGreaterThan(4);
    const wire = JSON.stringify([aw.sent, bw.sent, again.sent]);
    for (const s of secrets) expect(wire.includes(s)).toBe(false);
  });

  test("the window can call only the listed operations, with well-formed requests", async () => {
    const k = new Keyring(memHost(null).host);
    const session = serveKeys(k, () => {});
    const refused = async (raw: unknown) => {
      const r = await session.handle(raw);
      expect(r?.ok).toBe(false);
    };
    for (const name of ["rotate", "constructor", "__proto__", "fx", "identity", "access"]) await refused({ id: 1, op: "call", code: "x", name, args: [] });
    await refused({ id: 2, op: "call", code: "x", name: "head", args: "not a list" });
    await refused({ id: 3, op: "create", name: 7, token: null, me: null });
    await refused({ id: 4, op: "nope" });
    expect(await session.handle({ op: "follow" })).toBeNull();
    expect(await session.handle("junk")).toBeNull();
  });

  test("records change only for active, verified members who aren't the owner", () => {
    const m = { name: "bo", pk: "pk", xpk: "x", role: "", owner: false, at: 1, active: true } as Member;
    expect(editable(m)).toBe(m);
    for (const bad of [undefined, { ...m, active: false }, { ...m, unverified: true }, { ...m, owner: true }]) expect(() => editable(bad)).toThrow("can change");
  });

  test("following a channel this app isn't in fails, it doesn't throw", async () => {
    const k = new Keyring(memHost(null).host);
    const events: FollowEvent[] = [];
    k.follow("nowhere", 0, (e) => events.push(e));
    expect(events[0]?._tag).toBe("Failed");
  });
});

interface Mirror {
  doc: Y.Doc;
  events: DocEvent[];
  pipe: PipeIn;
}

function mirror(ops: ChannelOps, code: string, thread: string, th: string | null): Mirror {
  const doc = new Y.Doc();
  const events: DocEvent[] = [];
  const pipe = ops.doc(code, thread, th, (e) => {
    events.push(e);
    if (e._tag === "Update") Y.applyUpdate(doc, fromB64url(e.u), "pipe");
  });
  doc.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== "pipe") pipe.update(b64url(u));
  });
  return { doc, events, pipe };
}

describe("the editor's doc crosses the window like the feed (T597, T693)", () => {
  test("two windows share #general's, a members-only room's and a DM's doc through their own keys, and no key reaches either window", async () => {
    const ada = await generateIdentity("Ada");
    const bo = await generateIdentity("Bo");
    const a = memHost(ada);
    const b = memHost(bo);
    const aw = window(new Keyring(a.host));
    const bw = window(new Keyring(b.host));
    const code = (await aw.ops.create("Doc test", null, { name: "Ada" })).code!;
    const asked = await bw.ops.requestJoin(code, "bo");
    await aw.ops.call(code, "requests");
    await bw.ops.joinStatus(code);
    const req = (await aw.ops.call(code, "requests")).find((r) => r.pk === asked.pk)!;
    await aw.ops.call(code, "approve", req);
    expect((await bw.ops.joinStatus(code)).status).toBe("in");

    const seenA: FollowEvent[] = [];
    const seenB: FollowEvent[] = [];
    const stopA = aw.ops.follow(code, 0, (e) => seenA.push(e));
    const stopB = bw.ops.follow(code, 0, (e) => seenB.push(e));
    await until(() => seenA.find((e) => e._tag === "Open"));
    await until(() => seenB.find((e) => e._tag === "Open"));

    const share = async (thread: string, words: string): Promise<void> => {
      const mine = mirror(aw.ops, code, thread, null);
      mine.doc.getText("t").insert(0, words);
      const opened = await until(() => mine.events.find((e): e is Extract<DocEvent, { _tag: "Open" }> => e._tag === "Open"));
      expect(mine.events.find((e) => e._tag === "Failed")).toBeUndefined();
      await until(() => (mine.events.some((e) => e._tag === "Ready") ? true : undefined));
      await until(() => seenB.find((e) => e._tag === "Message" && e.message.kind === "event" && JSON.stringify(e.message).includes(opened.th)));
      const theirs = mirror(bw.ops, code, thread, opened.th);
      await until(() => (theirs.doc.getText("t").toString() === words ? true : undefined));
      theirs.doc.getText("t").insert(0, "Bo: ");
      await until(() => (mine.doc.getText("t").toString() === `Bo: ${words}` ? true : undefined));
      expect(theirs.events.find((e) => e._tag === "Failed")).toBeUndefined();
      theirs.pipe.close();
      mine.pipe.close();
    };
    await share("main", "first words");

    const boSeat = (await aw.ops.call(code, "members")).find((m) => m.pk === asked.pk)!;
    const pick = { name: boSeat.name, pk: boSeat.pk, xpk: boSeat.xpk! };
    const room = await aw.ops.call(code, "makeRoom", "plans", [pick]);
    const dm = await aw.ops.call(code, "makeDm", pick);
    for (const id of [room, dm]) await until(() => seenB.find((e) => e._tag === "Message" && JSON.stringify(e.message).includes(id)));
    await share(`room:${room}`, "members only");
    const adaSeat = (await aw.ops.call(code, "members")).find((m) => m.owner)!;
    await share(`dm:${[adaSeat.name, boSeat.name].sort().join("~")}`, "just us");
    stopA();
    stopB();
    const wire = JSON.stringify([aw.sent, bw.sent]);
    for (const s of [...secretsOf(a.store, b.store), ada.sk, bo.sk]) expect(wire.includes(s)).toBe(false);
  });

  test("an edit made while the channel is offline survives the app restarting, and reaches the relay once it's back (T1446)", async () => {
    const docs = mkdtempSync(join(tmpdir(), "mc-docs-"));
    try {
      const ada = await generateIdentity("Ada");
      const a = memHost(ada);
      const stored: KeyHost = { ...a.host, docStore: (s) => fileDocStore(join(docs, `${s.roomId}-${s.pk}`), s) };
      const first = window(new Keyring(stored));
      const code = (await first.ops.create("Offline doc", null, { name: "Ada" })).code!;
      const stopFirst = first.ops.follow(code, 0, () => {});
      const mine = mirror(first.ops, code, "main", null);
      mine.doc.getText("t").insert(0, "online");
      const th = (await until(() => mine.events.find((e): e is Extract<DocEvent, { _tag: "Open" }> => e._tag === "Open"))).th;
      await until(() => (mine.events.some((e) => e._tag === "Ready") ? true : undefined));
      await Bun.sleep(300);
      stopFirst();
      await Bun.sleep(100);
      mine.doc.getText("t").insert(6, ", then offline");
      await Bun.sleep(1_500);
      mine.pipe.close();
      await Bun.sleep(100);
      expect(readdirSync(docs).length).toBe(1);

      const again = window(new Keyring(stored));
      const stopAgain = again.ops.follow(code, 0, () => {});
      const back = mirror(again.ops, code, "main", th);
      await until(() => (back.doc.getText("t").toString() === "online, then offline" ? true : undefined));

      const elsewhere = window(new Keyring(a.host));
      const stopElsewhere = elsewhere.ops.follow(code, 0, () => {});
      const fresh = mirror(elsewhere.ops, code, "main", th);
      await until(() => (fresh.doc.getText("t").toString() === "online, then offline" ? true : undefined));
      for (const m of [back, fresh]) m.pipe.close();
      stopAgain();
      stopElsewhere();
    } finally {
      rmSync(docs, { recursive: true, force: true });
    }
  });

  test("a doc for a channel this app isn't in fails, it doesn't throw", async () => {
    const k = new Keyring(memHost(null).host);
    const events: DocEvent[] = [];
    k.doc("nowhere", "main", null, (e) => events.push(e)).update("AA");
    expect(events[0]?._tag).toBe("Failed");
  });
});

describe("a doc pipe opens at the doc's write level (T3209)", () => {
  const join = async (): Promise<{ ka: Keyring; kb: Keyring; code: string; seenB: FollowEvent[]; stop: () => void }> => {
    const ka = new Keyring(memHost(await generateIdentity("Ada")).host);
    const kb = new Keyring(memHost(await generateIdentity("Bo")).host);
    const code = (await ka.create("Level test", null, { name: "Ada" })).code!;
    const asked = await kb.requestJoin(code, "bo");
    await ka.call(code, "requests");
    await kb.joinStatus(code);
    const req = (await ka.call(code, "requests")).find((r) => r.pk === asked.pk)!;
    await ka.call(code, "approve", req);
    expect((await kb.joinStatus(code)).status).toBe("in");
    const seenB: FollowEvent[] = [];
    const stopA = ka.follow(code, 0, () => {});
    const stopB = kb.follow(code, 0, (e) => seenB.push(e));
    return { ka, kb, code, seenB, stop: () => (stopA(), stopB()) };
  };

  const raised = async (ops: ChannelOps, code: string): Promise<{ mine: Mirror; th: string }> => {
    const mine = mirror(ops, code, "main", null);
    raiseWriterFloor(mine.doc, DOC_LEVEL);
    mine.doc.getText("t").insert(0, "first");
    const opened = await until(() => mine.events.find((e): e is Extract<DocEvent, { _tag: "Open" }> => e._tag === "Open"));
    await until(() => (mine.events.some((e) => e._tag === "Ready") ? true : undefined));
    return { mine, th: opened.th };
  };

  test("an in-process caller, as in the browser build, keeps syncing after the doc's floor rises to its level", async () => {
    const { ka, kb, code, seenB, stop } = await join();
    const { mine, th } = await raised(ka, code);
    await until(() => seenB.find((e) => e._tag === "Message" && JSON.stringify(e.message).includes(th)));
    const theirs = mirror(kb, code, "main", th);
    await until(() => (theirs.doc.getText("t").toString() === "first" ? true : undefined));
    theirs.doc.getText("t").insert(0, "Bo: ");
    await until(() => (mine.doc.getText("t").toString() === "Bo: first" ? true : undefined));
    mine.doc.getText("t").insert(mine.doc.getText("t").length, ", then Ada");
    await until(() => (theirs.doc.getText("t").toString() === "Bo: first, then Ada" ? true : undefined));
    expect([...mine.events, ...theirs.events].filter((e) => e._tag === "Failed")).toEqual([]);
    mine.pipe.close();
    theirs.pipe.close();
    stop();
  });

  test("a window that names no level is still refused once the floor rises", async () => {
    const { ka, code, stop } = await join();
    const { mine, th } = await raised(window(ka).ops, code);
    const pushes: KeysPush[] = [];
    const session = serveKeys(ka, (p) => pushes.push(structuredClone(p)));
    const opened = (await session.handle({ op: "doc", code, thread: "main", th, id: 1 })) as KeysReply;
    if (!opened.ok) throw new Error("the doc didn't open");
    const sub = fromWire(opened.value);
    await until(() => (pushes.some((p) => p.sub === sub && JSON.stringify(p.event).includes("Ready")) ? true : undefined));
    const old = new Y.Doc();
    old.getText("t").insert(0, "from an old UI");
    await session.handle({ op: "docIn", sub, update: b64url(Y.encodeStateAsUpdate(old)), id: 2 });
    await until(() => (pushes.some((p) => p.sub === sub && JSON.stringify(p.event).includes("old-writer")) ? true : undefined));
    expect(mine.doc.getText("t").toString()).toBe("first");
    mine.pipe.close();
    stop();
  });
});

describe("what the window may save", () => {
  const seat = (over: Partial<ChannelIdentityView> = {}): ChannelIdentityView => ({
    label: "c",
    pk: "pk1",
    sk: "SECRET-sk",
    xpk: "xpk1",
    xsk: "SECRET-xsk",
    roomId: "room1",
    code: "code1",
    access: { roomId: "room1", ownerPk: "pk1", ownerXpk: "xpk1", epoch: 0, keys: { "0": "SECRET-k0" } },
    at: 1,
    ...over,
  });

  test("public writes keep the stored keys; secrets and unknown seats are refused", () => {
    const stored = [seat()];
    const renamed = mergePublicChannels(stored, [{ ...publicChannel(stored[0]!), label: "new", name: "new" }]);
    expect(renamed[0]).toMatchObject({ label: "new", name: "new", sk: "SECRET-sk", xsk: "SECRET-xsk" });
    expect((renamed[0]!.access as { keys: Record<string, string> }).keys).toEqual({ "0": "SECRET-k0" });
    expect(mergePublicChannels(stored, [])).toEqual(stored);
    const fresh = seat({ pk: "pk9", sk: "s9", code: "code9", roomId: "room9" });
    expect(mergePublicChannels([...stored, fresh], [{ ...publicChannel(stored[0]!), label: "late" }]).map((c) => c.code)).toEqual(["code1", "code9"]);
    expect(() => mergePublicChannels(stored, [{ ...publicChannel(stored[0]!), sk: "x" }])).toThrow("can't save channel keys");
    expect(() => mergePublicChannels(stored, [{ ...publicChannel(stored[0]!), access: { roomId: "room1", keys: {} } }])).toThrow("can't save channel keys");
    expect(mergePublicChannels(stored, [{ label: "x", pk: "other", roomId: "room1" }])).toEqual(stored);
    expect(() => mergePublicChannels(stored, [publicChannel(stored[0]!), publicChannel(stored[0]!)])).toThrow("bad channel list");
    const twin = seat({ sk: "SECRET-other" });
    const both = mergePublicChannels([seat(), twin], [{ ...publicChannel(stored[0]!), label: "both" }]);
    expect(both.map((c) => [c.label, c.sk])).toEqual([
      ["both", "SECRET-sk"],
      ["both", "SECRET-other"],
    ]);
    expect(() => mergePublicChannels(stored, "nope")).toThrow();
  });

  test("the key process adds seats, never swaps a key, and only adds epoch keys", () => {
    const pending: ChannelIdentityView = { label: "c", pk: "pk2", sk: "s2", code: "code1", requestId: "r1" };
    const member = seat({ pk: "pk2", sk: "s2" });
    expect(acceptSeat([pending], member)).toEqual([member]);
    expect(() => acceptSeat([seat()], seat({ pk: "pk3", sk: "s3" }))).toThrow("already in this channel");
    expect(() => acceptSeat([seat()], seat({ sk: "evil" }))).toThrow("can't change");
    const rotated = withAccess([seat()], "code1", "pk1", { roomId: "room1", ownerPk: "pk1", ownerXpk: "xpk1", epoch: 1, keys: { "0": "SECRET-k0", "1": "SECRET-k1" } });
    expect(publicChannel(rotated[0]!).access?.epoch).toBe(1);
    expect(() => withAccess([seat()], "code1", "pk1", { roomId: "room1", ownerPk: "pk1", ownerXpk: "xpk1", epoch: 1, keys: { "1": "SECRET-k1" } })).toThrow("can't change");
    const keys = { "0": "SECRET-k0", "1": "SECRET-k1" };
    for (const bad of [
      { roomId: "room2", ownerPk: "pk1", ownerXpk: "xpk1", epoch: 1, keys },
      { roomId: "room1", ownerPk: "evil", ownerXpk: "xpk1", epoch: 1, keys },
      { roomId: "room1", ownerPk: "pk1", ownerXpk: "evil", epoch: 1, keys },
    ])
      expect(() => withAccess([seat()], "code1", "pk1", bad)).toThrow("can't change its room, owner or epoch");
    expect(() => withAccess(rotated, "code1", "pk1", { roomId: "room1", ownerPk: "pk1", ownerXpk: "xpk1", epoch: 0, keys })).toThrow("can't change its room, owner or epoch");
    expect(() => acceptSeat([seat()], seat({ access: { roomId: "room1", ownerPk: "evil", ownerXpk: "xpk1", epoch: 0, keys: { "0": "SECRET-k0" } } }))).toThrow("can't change its room, owner or epoch");
  });

  test("old localStorage seats move in, marked imported, never over or beside a seat the store has", () => {
    const real = (roomId: string) => encodeJoinCode({ roomId, ownerFp: "AAAAAAAAAAAAAAAA" });
    const r1 = newRoomId();
    const r2 = newRoomId();
    const r3 = newRoomId();
    const mine = seat({ code: real(r1), roomId: r1, access: { roomId: r1, ownerPk: "pk1", ownerXpk: "xpk1", epoch: 0, keys: { "0": "SECRET-k0" } } });
    const old = seat({ pk: "pk2", code: real(r2), roomId: r2, access: { roomId: r2, ownerPk: "pk1", ownerXpk: "xpk1", epoch: 0, keys: { "0": "k" } }, extra: "junk" } as Partial<ChannelIdentityView>);
    const samePk = seat({ code: real(r3), roomId: r3, access: { roomId: r3, ownerPk: "pk1", ownerXpk: "xpk1", epoch: 0, keys: { "0": "k" } } });
    const sameCode = seat({ pk: "pk4", sk: "evil", code: real(r1), roomId: r1, access: { roomId: r1, ownerPk: "pk1", ownerXpk: "xpk1", epoch: 0, keys: { "0": "evil" } } });
    const wrongRoom = seat({ pk: "pk5", code: real(r3), roomId: r2, access: { roomId: r2, ownerPk: "pk1", ownerXpk: "xpk1", epoch: 0, keys: { "0": "k" } } });
    const first = migrateEntries([mine], [old, samePk, sameCode, wrongRoom, seat({ pk: "pk6", code: "not-a-code" }), { junk: true }]);
    expect(first.added).toBe(1);
    expect(first.channels[0]).toEqual(mine);
    expect(first.channels[1]).toMatchObject({ pk: "pk2", code: real(r2), imported: true });
    expect("extra" in first.channels[1]!).toBe(false);
    expect(migrateEntries(first.channels, [old]).added).toBe(0);
  });

  test("a relay switch marks each seat with the relay it lives on, and switching back clears the mark (T135)", () => {
    const a = "https://a.example";
    const b = "https://b.example";
    const onA = movedRelay([seat()], a, b);
    expect(onA[0]).toMatchObject({ code: "code1", relay: a, sk: "SECRET-sk" });
    expect(publicChannel(onA[0]!).relay).toBe(a);
    expect(mergePublicChannels(onA, [{ ...publicChannel(onA[0]!), label: "renamed" }])[0]).toMatchObject({ label: "renamed", relay: a });
    const both = movedRelay([...onA, seat({ pk: "pk2", sk: "s2", code: "code2", roomId: "room2" })], b, a);
    expect(both.map((c) => [c.code, c.relay])).toEqual([
      ["code1", undefined],
      ["code2", b],
    ]);
    expect("relay" in both[0]!).toBe(false);
    expect(movedRelay(both, a, a)).toEqual(both);
  });
});

describe("a relay switch keeps every saved channel (T135)", () => {
  test("a seat on another relay is never sent to this one, so a 404 there can't forget it", async () => {
    const ada = await generateIdentity("Ada");
    const a = memHost(ada);
    const k = new Keyring(a.host);
    const aw = window(k);
    const made = await aw.ops.create("Moved", null, { name: "Ada" });
    const code = made.code!;
    const elsewhere = "https://elsewhere.example";
    a.store.seats = a.store.seats.map((c) => ({ ...c, relay: elsewhere }));
    const half: ChannelIdentityView = {
      label: "half",
      idName: "human",
      pk: "half-pk",
      sk: "half-sk",
      roomId: newRoomId(),
      code: encodeJoinCode({ roomId: newRoomId(), ownerFp: "AAAAAAAAAAAAAAAA" }),
      creating: true,
      relay: elsewhere,
    };
    a.store.seats = [...a.store.seats, half];
    await expect(aw.ops.call(code, "head")).rejects.toThrow("elsewhere.example");
    await k.finishCreating();
    expect(a.store.seats.map((c) => c.code)).toEqual([code, half.code]);
    a.store.seats = a.store.seats.map((c) => ({ ...c, relay }));
    expect((await aw.ops.call(code, "head")) ?? 0).toBe(0);
  });
});

describe("the wire", () => {
  test("maps, sets and lookalike keys round-trip", () => {
    const v = { m: new Map([["a", { s: new Set([1, 2]) }]]), $map: "x", $$y: 1, list: [new Map([[1, 2]])], u: undefined };
    const back = fromWire(structuredClone(toWire(v))) as typeof v;
    expect(back.m.get("a")?.s.has(2)).toBe(true);
    expect(back.$map).toBe("x");
    expect(back.$$y).toBe(1);
    expect(back.list[0]?.get(1)).toBe(2);
    expect("u" in back).toBe(false);
  });
});

describe("the window's code holds no channel keys", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [join(dir, d.name)] : []));
  const allowed = new Set(["packages/secrets/src/channel-local.ts"]);
  const forbidden: [RegExp, string][] = [
    [/import\s*\{[^}]*\bChannel\b[^}]*\}\s*from\s*"[^"]*\/client(\.ts)?"/, "Channel from client.ts"],
    [/\bgenerateIdentity\b/, "generateIdentity"],
    [/import\s*\{[^}]*\b(seal|open)\b[^}]*\}\s*from\s*"[^"]*\/crypto(\.ts)?"/, "seal/open from crypto.ts"],
    [/import\s*\{[^}]*\b(packRow|openRow|openRows)\b[^}]*\}\s*from\s*"[^"]*\/cache-row(\.ts)?"/, "packRow/openRow from cache-row.ts"],
    [/from\s*"[^"]*\/desktop\/src\/(keyring|keys-server)(\.ts)?"/, "desktop/src/keyring.ts or keys-server.ts"],
  ];

  test("only channel-local.ts (the plain-browser dev mode) touches them", () => {
    const root = join(import.meta.dir, "..");
    const bad: string[] = [];
    for (const f of [...files(join(root, "ui/src")), ...files(join(root, "packages/app/src")), ...files(join(root, "packages/secrets/src"))]) {
      const rel = f.slice(root.length + 1);
      if (allowed.has(rel)) continue;
      const text = readFileSync(f, "utf8");
      for (const [re, what] of forbidden) if (re.test(text)) bad.push(`${rel}: ${what}`);
    }
    expect(bad).toEqual([]);
  });
});
