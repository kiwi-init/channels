import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { received } from "@kiwi/core/client/history.ts";
import { certUntil, claimDevice, nextLink, readDeviceList, rootLink, type DeviceLink } from "@kiwi/core/devices.ts";
import { generateIdentity, sign, verify, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { PROTOCOL_VERSION, type Message, type Payload } from "@kiwi/core/protocol.ts";
import { fold, rosterOf, type FoldBase } from "@kiwi/core/state.ts";
import { startRelay } from "../src/relay/bun.ts";
import { runAgent } from "../src/agent.ts";
import { joinAgent, joinPerson, pairComputer, setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(120_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-member-gone-"));
let server: ReturnType<typeof startRelay>;
let s: OwnerSetup;
type Seat = { id: Identity; ch: Channel };
let ana: Seat;
let bo: Seat;
let cy: Seat;

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  s = await setupChannel(server.url.origin);
  const computer = await pairComputer(s.person);
  ana = await joinAgent(s, "ana", computer);
  bo = await joinAgent(s, "bo", computer);
  cy = await joinAgent(s, "cy", computer);
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

async function joinPhone(person: Identity, name: string): Promise<Seat> {
  const desk = await withExchangeKey(await generateIdentity("desk"));
  const phone = await withExchangeKey(await generateIdentity("phone"));
  const root = await rootLink(person, { pk: desk.pk, xpk: desk.xpk!, label: "desk", os: "macOS", as: "desktop" });
  const read = await readDeviceList([root]);
  if (!read.ok) throw new Error(read.why);
  const links: DeviceLink[] = [
    root,
    await nextLink(read.list, desk, { op: "add", device: phone.pk, dxpk: phone.xpk!, label: "phone", os: "iOS", as: "phone", approve: false, until: certUntil(Date.now()) }),
  ];
  const id = await generateIdentity(name);
  const { requestId } = await Channel.requestJoin(s.relay, s.code, id, { name }, { device: await claimDevice(phone, links, s.roomId, id.pk) });
  await s.ownerCh.autoApprove(s.person.pk);
  await Channel.joinStatus(s.relay, s.code, id, requestId);
  await s.ownerCh.autoApprove(s.person.pk);
  const st = await Channel.joinStatus(s.relay, s.code, id, requestId);
  if (st.status !== "approved") throw new Error(`not approved: ${st.status}`);
  const seat = { ...id, name: (await s.ownerCh.members()).find((m) => m.pk === id.pk)!.name };
  return { id: seat, ch: new Channel(st.access, s.relay, seat) };
}

async function log(): Promise<Message[]> {
  return (await s.ownerCh.history(0)).messages;
}

async function injected(who: Seat, body: string, seq: number): Promise<Message> {
  const payload: Payload = { v: PROTOCOL_VERSION, id: crypto.randomUUID(), from: who.id.name, kind: "msg", body, ts: Date.now() };
  const signed = await sign(who.id, payload);
  return received(signed, seq, Date.now(), await verify(signed));
}

async function judged(extra: Message[], base?: FoldBase) {
  const messages = base ? (await s.ownerCh.history(base.n)).messages : await log();
  const all = [...messages, ...extra];
  return fold(all, rosterOf(await s.ownerCh.members()), Date.now(), null, null, base ?? null);
}

describe("a removed key can't speak after its removal, whatever the relay serves (T1106)", () => {
  let before: number;

  test("the owner logs member.gone before the relay forgets the key: its later messages are refused, its earlier ones stand", async () => {
    before = await ana.ch.send("before I was removed");
    await s.ownerCh.remove(ana.id.pk);
    const gone = (await log()).find((m) => m.ev?.op === "member.gone");
    expect(gone?.ev).toEqual({ op: "member.gone", member: "ana", pk: ana.id.pk });
    const head = (await log()).at(-1)!.seq;
    const late = await injected(ana, "a relay slipped this in", head + 1);
    const state = await judged([late]);
    expect(state.rejected.get(late.seq)).toBe("sent after its key was removed");
    expect(state.trust.get(late.seq)).toBe("refused");
    expect(state.rejected.get(before)).toBeUndefined();
  });

  test("only the owner, or the key itself, can say a key is gone, and only a key of the member it names", async () => {
    const forged = await bo.ch.send("cy is gone", { kind: "event", ev: { op: "member.gone", member: "cy", pk: cy.id.pk } });
    const mismatched = await s.ownerCh.send("removed bo", { kind: "event", ev: { op: "member.gone", member: "bo", pk: cy.id.pk } });
    const state = await judged([]);
    expect(state.rejected.get(forged)).toBe("only the owner, or the key itself, says a key is gone");
    expect(state.rejected.get(mismatched)).toBe("that key isn't one of bo's");
    expect(state.gone.has(cy.id.pk)).toBe(false);
    const fine = await cy.ch.send("still here");
    expect((await judged([])).rejected.get(fine)).toBeUndefined();
  });

  test("a member who leaves signs their own key gone", async () => {
    await cy.ch.leave();
    const head = (await log()).at(-1)!.seq;
    const late = await injected(cy, "after I left", head + 1);
    expect((await judged([late])).rejected.get(late.seq)).toBe("sent after its key was removed");
  });

  test("removing a person's phone cuts that key only: their desktop still speaks", async () => {
    const person = await generateIdentity("tia-person");
    const tia = await joinPerson(s, "tia", person);
    const phone = await joinPhone(person, "tia");
    await s.ownerCh.remove(phone.id.pk);
    const fromDesk = await tia.ch.send("from my desk, still here");
    const head = (await log()).at(-1)!.seq;
    const late = await injected(phone, "from the lost phone", head + 1);
    const state = await judged([late]);
    expect(state.rejected.get(late.seq)).toBe("sent after its key was removed");
    expect(state.rejected.get(fromDesk)).toBeUndefined();
    expect(state.gone.has(tia.id.pk)).toBe(false);
  });

  test("a fresh app starting from a snapshot still refuses the removed key", async () => {
    expect(await runAgent(s.ownerCh.fx.snapshotIfDue(1))).toBeGreaterThan(0);
    const base = (await new Channel(bo.ch.access, s.relay, bo.id).snapshot())!;
    expect(base.gone?.map(([pk]) => pk)).toContain(ana.id.pk);
    const head = (await log()).at(-1)!.seq;
    const late = await injected(ana, "after the snapshot", head + 1);
    expect((await judged([late], base)).rejected.get(late.seq)).toBe("sent after its key was removed");
  });

  test("member.back from the owner lets the same key speak again", async () => {
    await s.ownerCh.send("let ana back in", { kind: "event", ev: { op: "member.back", member: "ana", pk: ana.id.pk } });
    const head = (await log()).at(-1)!.seq;
    const late = await injected(ana, "back again", head + 1);
    const state = await judged([late]);
    expect(state.gone.has(ana.id.pk)).toBe(false);
    expect(state.rejected.get(late.seq)).not.toBe("sent after its key was removed");
  });
});
