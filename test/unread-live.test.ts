import { expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { runAgent } from "../src/agent.ts";
import { openRows, packUnread } from "@kiwi/core/cache-row.ts";
import { Channel, type Live } from "@kiwi/core/client.ts";
import { seal } from "@kiwi/core/crypto.ts";
import { generateIdentity, sign } from "@kiwi/core/identity.ts";
import { PROTOCOL_VERSION, WS_PROTOCOL } from "@kiwi/core/protocol.ts";

const KEY = "A".repeat(43);
const ROOM = "c".repeat(32);

test("a stored message this build can't read arrives as Unread with its seq, and its cache row says so", async () => {
  const id = await generateIdentity("mac");
  const known = await seal(KEY, ROOM, await sign(id, { v: PROTOCOL_VERSION, id: "a", from: "mac", kind: "msg", body: "known", ts: 1 }));
  const future = await seal(KEY, ROOM, await sign(id, { v: PROTOCOL_VERSION, id: "b", from: "mac", kind: "event", body: "", ts: 2, ev: { op: "future.op" } }));
  const frames = [
    { t: "msg", seq: 1, ts: 10, e: 0, ...known },
    { t: "msg", seq: 2, ts: 20, e: 0, ...future },
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
    const unread = seen.find((e) => e._tag === "Unread");
    if (unread?._tag !== "Unread") throw new Error("no Unread event");
    const row = await packUnread(KEY, ROOM, 0, unread.envelope);
    expect(await openRows([row], ROOM, { "0": KEY })).toEqual([{ seq: 2, unread: true }]);
  } finally {
    relay.stop(true);
  }
});
