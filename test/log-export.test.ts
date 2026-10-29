import { expect, test } from "bun:test";
import { Channel } from "@kiwi/core/client.ts";
import { seal } from "@kiwi/core/crypto.ts";
import { generateIdentity, sign } from "@kiwi/core/identity.ts";
import { PROTOCOL_VERSION } from "@kiwi/core/protocol.ts";
import { exportNote, logExport } from "@kiwi/app/log-export.ts";

test("a stored message this build can't read is named as missing from the export, not passed off as a complete log", async () => {
  const key = "A".repeat(43);
  const room = "c".repeat(32);
  const id = await generateIdentity("mac");
  const known = await seal(key, room, await sign(id, { v: PROTOCOL_VERSION, id: "a", from: "mac", kind: "msg", body: "known", ts: 1 }));
  const malformed = await seal(key, room, await sign(id, { v: PROTOCOL_VERSION, id: "b", from: "mac", kind: "event", body: "", ts: 2, ev: { op: "task.add" } }));
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () =>
      Response.json({
        head: 2,
        messages: [
          { seq: 1, ts: 10, e: 0, ...known },
          { seq: 2, ts: 20, e: 0, ...malformed },
        ],
      }),
  });
  try {
    const ch = new Channel({ roomId: room, ownerPk: id.pk, ownerXpk: id.xpk ?? "", epoch: 0, keys: { "0": key } }, server.url.origin, id);
    const log = logExport(await ch.history(0));
    expect(log.text.trimEnd().split("\n")).toHaveLength(1);
    expect(log.missing).toEqual([2]);
    const note = exportNote(log);
    expect(note.complete).toBe(false);
    expect(note.text).toContain("1 message this app couldn’t read is missing (#2)");
  } finally {
    server.stop(true);
  }
});
