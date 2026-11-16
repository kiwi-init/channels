import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openRows, packEnvelope, packRow, reopenRows } from "@kiwi/core/cache-row.ts";
import { Channel } from "@kiwi/core/client.ts";
import { signRequest } from "@kiwi/core/auth.ts";
import { generateIdentity, sign, type Identity } from "@kiwi/core/identity.ts";
import { asSent, PROTOCOL_VERSION, type Message, type Payload } from "@kiwi/core/protocol.ts";
import { seal } from "@kiwi/core/crypto.ts";
import { fold } from "@kiwi/core/state.ts";
import { startRelay } from "../src/relay/bun.ts";
import { OPEN_POLICY } from "../src/relay/policy.ts";

const DUE = Date.parse("2026-11-16T21:00:00Z");
const OCCURRENCE = "2026-11-16T18:00";
const asking = { kind: "event" as const, ev: { op: "checkpoint.ask" as const, asks: [{ agent: "bot", tasks: [1] }], unreachable: [], occurrence: OCCURRENCE } };

let dir: string;
let server: ReturnType<typeof startRelay>;
let human: Channel;
let bot: Channel;
let other: Channel;
let stop: AbortController;
let botId: Identity;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "ckpt-authority-"));
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: dir, policy: OPEN_POLICY });
  stop = new AbortController();
  setSystemTime(DUE - 60_000);
  const relay = server.url.origin;
  const owner = await generateIdentity("owner");
  const ids: Record<string, Identity> = { bot: await generateIdentity("bot"), other: await generateIdentity("other") };
  const made = await Channel.create(relay, owner, { name: "owner", kind: "human" }, [
    { ...ids.bot!, info: { name: "bot", kind: "agent" } },
    { ...ids.other!, info: { name: "other", kind: "agent" } },
  ]);
  human = new Channel(made.access, relay, owner);
  botId = ids.bot!;
  bot = new Channel(await Channel.resume(relay, made.code, ids.bot!), relay, ids.bot!);
  other = new Channel(await Channel.resume(relay, made.code, ids.other!), relay, ids.other!);
  await human.send("", { kind: "event", ev: { op: "task.add", title: "Work", owner: "bot" } });
  await human.setCheckpointDaily({ at: "18:00", tz: "America/Sao_Paulo" });
});

afterEach(() => {
  stop.abort();
  setSystemTime();
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

const board = async () => {
  const messages = (await human.history(0)).messages;
  return { messages, state: fold(messages, await human.members()) };
};

const online = async (heard: Message[] = []) => {
  await new Promise<void>((ready) => void human.stream(0, (m) => void heard.push(m), { signal: stop.signal, onReady: () => ready() }).catch(() => {}));
  return heard;
};

test("a missed occurrence gives no authority: an event naming it is refused by the fold, and a claim of it by the relay", async () => {
  setSystemTime(DUE + 1000);
  server.fireCheckpoint(human.roomId);
  expect((await human.checkpoints()).log[0]).toMatchObject({ id: OCCURRENCE, state: "missed", why: "nobody online" });
  const plain = await bot.send("", asking);
  await expect(bot.send("", { ...asking, occurrence: OCCURRENCE })).rejects.toThrow("already made, or isn't due");
  const { state } = await board();
  expect(state.checkpointAsks).toEqual([]);
  expect(state.rejected.get(plain)).toContain("the relay didn't take this message");
  expect((await human.checkpoints()).log[0]).toMatchObject({ state: "missed" });
});

test("inside an open occurrence only the message the relay took counts, and its stamp reaches history, live delivery and the caches", async () => {
  const heard = await online();
  setSystemTime(DUE + 1000);
  server.fireCheckpoint(human.roomId);
  expect((await human.checkpoints()).log[0]).toMatchObject({ state: "open" });
  const forged = await bot.send("", asking);
  const taken = await bot.send("", { ...asking, occurrence: OCCURRENCE });
  await expect(other.send("", { ...asking, occurrence: OCCURRENCE })).rejects.toThrow("already made, or isn't due");
  const { messages, state } = await board();
  expect(state.checkpointAsks.map((a) => a.seq)).toEqual([taken]);
  expect(state.rejected.get(forged)).toContain("the relay didn't take this message");
  expect((await human.checkpoints()).log[0]).toEqual({ id: OCCURRENCE, due: DUE, state: "answered", seq: taken });
  expect(messages.find((m) => m.seq === forged)?.rocc).toBeUndefined();
  expect(messages.find((m) => m.seq === taken)?.rocc).toBe(OCCURRENCE);
  for (let i = 0; i < 40 && !heard.some((m) => m.seq === taken); i++) await Bun.sleep(25);
  expect(heard.find((m) => m.seq === taken)?.rocc).toBe(OCCURRENCE);
  expect(heard.find((m) => m.seq === forged)?.rocc).toBeUndefined();
});

test("the stamp stays through every cached form: a row, a re-sealed row and a raw envelope", async () => {
  await online();
  setSystemTime(DUE + 1000);
  server.fireCheckpoint(human.roomId);
  const taken = await bot.send("", { ...asking, occurrence: OCCURRENCE });
  const message = (await board()).messages.find((m) => m.seq === taken)!;
  const { keys, epoch } = human.access;
  const key = keys[String(epoch)]!;

  const [fromRow] = await openRows([await packRow(key, human.roomId, epoch, message)], human.roomId, keys);
  expect((fromRow as Message).rocc).toBe(OCCURRENCE);

  const again = await reopenRows([await packRow(key, human.roomId, epoch, message)], human.roomId, keys, epoch);
  expect((again.opened[0] as Message).rocc).toBe(OCCURRENCE);
  expect(again.rows).toHaveLength(1);
  expect(((await openRows(again.rows, human.roomId, keys))[0] as Message).rocc).toBe(OCCURRENCE);

  const { seq, rts, rocc, sigOk, ...payload } = asSent(message);
  void [rocc, sigOk];
  const sealed = await seal(key, human.roomId, payload);
  const env = { seq, ts: rts!, e: epoch, iv: sealed.iv, ct: sealed.ct, occ: OCCURRENCE };
  expect((await human.decrypt(env))?.rocc).toBe(OCCURRENCE);
  expect((await human.decrypt({ ...env, occ: undefined }))?.rocc).toBeUndefined();
  const [fromEnvelope] = await openRows([await packEnvelope(key, human.roomId, epoch, env, true)], human.roomId, keys);
  expect((fromEnvelope as Message).rocc).toBe(OCCURRENCE);
});

const forge = async (outer: object) => {
  const { keys, epoch, roomId } = human.access;
  const signed = await sign(botId, { v: PROTOCOL_VERSION, id: crypto.randomUUID(), from: "bot", kind: "event", body: "", ts: Date.now(), ev: asking.ev, rocc: OCCURRENCE, rts: DUE } as Payload);
  const sealed = await seal(keys[String(epoch)]!, roomId, signed);
  const body = JSON.stringify({ ...sealed, e: epoch, ...outer });
  const res = await fetch(new URL(`/v1/rooms/${roomId}/messages`, server.url), {
    method: "POST",
    body,
    headers: { authorization: `Bearer ${await signRequest(botId, roomId, "POST", "/messages", body)}`, "content-type": "application/json" },
  });
  return { stored: (await res.json()) as { seq: number; occ?: string }, signed, sealed };
};

test("a client can't write the stamp itself, outside its sealed message or inside the signed one", async () => {
  const heard = await online();
  setSystemTime(DUE + 1000);
  server.fireCheckpoint(human.roomId);
  const { stored, sealed } = await forge({ occ: OCCURRENCE });
  expect(stored.occ).toBeUndefined();
  const { messages, state } = await board();
  const got = messages.find((m) => m.seq === stored.seq)!;
  expect(got.rocc).toBeUndefined();
  expect(got.sigOk).toBe(true);
  expect(state.checkpointAsks).toEqual([]);
  expect(state.rejected.get(stored.seq)).toContain("the relay didn't take this message");
  expect((await human.checkpoints()).log[0]).toMatchObject({ state: "open" });

  for (let i = 0; i < 40 && !heard.some((m) => m.seq === stored.seq); i++) await Bun.sleep(25);
  expect(heard.find((m) => m.seq === stored.seq)?.rocc).toBeUndefined();

  const { keys, epoch } = human.access;
  const key = keys[String(epoch)]!;
  const env = { seq: stored.seq, ts: got.rts!, e: epoch, iv: sealed.iv, ct: sealed.ct };
  expect((await human.decrypt(env))?.rocc).toBeUndefined();
  const [fromEnvelope] = await openRows([await packEnvelope(key, human.roomId, epoch, env, true)], human.roomId, keys);
  expect((fromEnvelope as Message).rocc).toBeUndefined();
  const [fromRow] = await openRows([await packRow(key, human.roomId, epoch, got)], human.roomId, keys);
  expect((fromRow as Message).rocc).toBeUndefined();
});

test("a stamp forged inside the signed message gives no authority over a missed occurrence either", async () => {
  setSystemTime(DUE + 1000);
  server.fireCheckpoint(human.roomId);
  const { stored } = await forge({});
  const { messages, state } = await board();
  expect(messages.find((m) => m.seq === stored.seq)?.rocc).toBeUndefined();
  expect(state.checkpointAsks).toEqual([]);
  expect(state.rejected.get(stored.seq)).toContain("the relay didn't take this message");
  expect((await human.checkpoints()).log[0]).toMatchObject({ state: "missed" });
});

test("a retry after a lost reply gets the original stamp back, so the sender's own copy and its cache keep it", async () => {
  await online();
  setSystemTime(DUE + 1000);
  server.fireCheckpoint(human.roomId);
  const opts = { ...asking, id: crypto.randomUUID(), cid: crypto.randomUUID(), occurrence: OCCURRENCE };
  const sent: (Message | null)[] = [];
  bot.onSent = (_seq, m) => void sent.push(m);
  const first = await bot.send("", opts);
  const again = await bot.send("", opts);
  expect(again).toBe(first);
  expect(sent.map((m) => m?.rocc)).toEqual([OCCURRENCE, OCCURRENCE]);
  expect(fold([...(await board()).messages.filter((m) => m.seq !== first), sent[1]!], await human.members()).checkpointAsks.map((a) => a.seq)).toEqual([first]);
  const { keys, epoch } = bot.access;
  const [cached] = await openRows([await packRow(keys[String(epoch)]!, bot.roomId, epoch, sent[1]!)], bot.roomId, keys);
  expect((cached as Message).rocc).toBe(OCCURRENCE);
  await expect(other.send("", { ...opts, cid: crypto.randomUUID() })).rejects.toThrow("already made, or isn't due");
});
