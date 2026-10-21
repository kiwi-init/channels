import { expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { runAgent } from "../src/agent.ts";
import { openRows, packEnvelope, packRow } from "@kiwi/core/cache-row.ts";
import { Channel, type Live } from "@kiwi/core/client.ts";
import { seal } from "@kiwi/core/crypto.ts";
import { generateIdentity, sign } from "@kiwi/core/identity.ts";
import { PROTOCOL_VERSION, WS_PROTOCOL } from "@kiwi/core/protocol.ts";

const KEY = "A".repeat(43);
const ROOM = "c".repeat(32);

test("a stored message this build can't read arrives as Unread with its seq, and its cache row says so", async () => {
  const id = await generateIdentity("mac");
  const known = await seal(KEY, ROOM, await sign(id, { v: PROTOCOL_VERSION, id: "a", from: "mac", kind: "msg", body: "known", ts: 1 }));
  const malformed = await seal(KEY, ROOM, await sign(id, { v: PROTOCOL_VERSION, id: "b", from: "mac", kind: "event", body: "", ts: 2, ev: { op: "task.add" } }));
  const frames = [
    { t: "msg", seq: 1, ts: 10, e: 0, ...known },
    { t: "msg", seq: 2, ts: 20, e: 0, ...malformed },
    { t: "ready", head: 2, more: false },
  ];
  const relay = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req, srv) => (srv.upgrade(req, { headers: { "sec-websocket-protocol": WS_PROTOCOL } }) ? undefined : new Response("no", { status: 503 })),
    websocket: { open: (ws) => void frames.forEach((f) => ws.send(JSON.stringify(f))), message() {} },
  });
  try {
    const ch = new Channel({ roomId: ROOM, ownerPk: id.pk, ownerXpk: id.xpk ?? "", epoch: 0, keys: { "0": KEY } }, relay.url.origin, id);
    const seen: Live[] = [];
    const fiber = Effect.runFork(Stream.runForEach(ch.fx.live(0, { presence: false }), (ev) => Effect.sync(() => void seen.push(ev))) as Effect.Effect<void, unknown, never>);
    const end = Date.now() + 5_000;
    while (!seen.some((e) => e._tag === "Ready") && Date.now() < end) await Bun.sleep(20);
    await runAgent(Fiber.interrupt(fiber));
    const tags = seen.filter((e) => e._tag === "Message" || e._tag === "Unread").map((e) => (e._tag === "Message" ? `msg ${e.message.seq}` : e._tag === "Unread" ? `unread ${e.envelope.seq}` : ""));
    expect(tags).toEqual(["msg 1", "unread 2"]);
    const message = seen.find((e) => e._tag === "Message");
    expect(message?._tag === "Message" ? message.envelope?.seq : null).toBe(1);
    const unread = seen.find((e) => e._tag === "Unread");
    if (unread?._tag !== "Unread") throw new Error("no Unread event");
    const row = await packEnvelope(KEY, ROOM, 0, unread.envelope);
    expect(await openRows([row], ROOM, { "0": KEY })).toEqual([{ seq: 2, unread: true }]);
  } finally {
    relay.stop(true);
  }
});

test("a message whose attachments the client filtered stays authentic after a reload, cached as its envelope", async () => {
  const id = await generateIdentity("mac");
  const imgs = [
    { name: "a.png", mime: "image/png", data: "iVBORw0KGgo=" },
    { name: "x.svg", mime: "image/svg+xml", data: "PHN2Zy8+" },
  ];
  const payload = await sign(id, { v: PROTOCOL_VERSION, id: "c", from: "mac", kind: "msg", body: "look", ts: 3, imgs });
  const sealed = await seal(KEY, ROOM, payload);
  const envelope = { seq: 3, ts: 30, e: 0, ...sealed };
  const ch = new Channel({ roomId: ROOM, ownerPk: id.pk, ownerXpk: id.xpk ?? "", epoch: 0, keys: { "0": KEY } }, "http://127.0.0.1:1", id);
  const shown = await runAgent(ch.fx.decrypt(envelope));
  expect(shown?.sigOk).toBe(true);
  expect(shown?.imgs?.map((i) => i.name)).toEqual(["a.png"]);
  const [filtered] = await openRows([await packRow(KEY, ROOM, 0, shown!)], ROOM, { "0": KEY });
  expect(filtered && "sigOk" in filtered ? filtered.sigOk : null).toBe(false);
  const [kept] = await openRows([await packEnvelope(KEY, ROOM, 0, envelope)], ROOM, { "0": KEY });
  expect(kept && "sigOk" in kept ? [kept.sigOk, kept.imgs?.map((i) => i.name)] : null).toEqual([true, ["a.png"]]);
});
