import { describe, expect, test } from "bun:test";
import { toBase64 } from "@kiwi/core/crypto.ts";
import { PROTOCOL_VERSION, type Message } from "@kiwi/core/protocol.ts";
import type { ChannelOps } from "../../../desktop/src/bridge.ts";
import { ChannelLink } from "./channel-ops.ts";
import { heldImage, holdImages } from "./image-bytes.ts";

const bytes = Uint8Array.from({ length: 3_000 }, (_, i) => (i * 7) % 256);
const data = toBase64(bytes);
const msg = (more: Partial<Message>): Message => ({ v: PROTOCOL_VERSION, id: "id-1", from: "atlas", kind: "msg", body: "look", ts: 1, seq: 1, sigOk: true, ...more });

describe("image bytes held by reference", () => {
  test("an inline image leaves the message and is read back from its blob, byte for byte", async () => {
    const m = msg({ imgs: [{ name: "a.png", mime: "image/png", data }] });
    const held = holdImages(m);
    expect(held.imgs).toEqual([{ name: "a.png", mime: "image/png" }]);
    expect(m.imgs?.[0]?.data).toBe(data);
    expect(await heldImage(held.imgs![0]!)).toBe(data);
  });

  test("a message with no inline bytes is the same object, and a copy of an attachment is not held", () => {
    const ref = msg({ imgs: [{ name: "b.png", mime: "image/png", ref: { id: "r", key: "k", size: 3 } }] });
    expect(holdImages(ref)).toBe(ref);
    const held = holdImages(msg({ imgs: [{ name: "a.png", mime: "image/png", data }] }));
    expect(heldImage({ ...held.imgs![0]! })).toBeNull();
  });

  test("bytes that are not base64 stay inline", () => {
    const odd = msg({ imgs: [{ name: "a.png", mime: "image/png", data: "%%%" }] });
    expect(holdImages(odd).imgs?.[0]?.data).toBe("%%%");
  });

  test("the channel link answers a held image itself and asks the relay only for the rest", async () => {
    const asked: unknown[] = [];
    const ops = { call: async (_code: string, op: string, ...args: unknown[]) => (asked.push([op, ...args]), "from-relay") } as unknown as ChannelOps;
    const link = new ChannelLink("code", "room", "pk", "owner", ops);
    const held = holdImages(msg({ imgs: [{ name: "a.png", mime: "image/png", data }] }));
    expect(await link.image(held.imgs![0]!)).toBe(data);
    expect(asked).toEqual([]);
    const other = { name: "b.png", mime: "image/png", ref: { id: "r", key: "k", size: 3 } };
    expect(await link.image(other)).toBe("from-relay");
    expect(asked).toEqual([["image", other]]);
  });
});
