import { describe, expect, test } from "bun:test";
import { verifyRequest } from "@kiwi/core/auth.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { wellFormedLiveTokens } from "@kiwi/core/live.ts";
import type { ChannelIdentityView } from "../desktop/src/bridge.ts";
import { liveKeys, registerLive, unregisterLive } from "../ios/engine/live.ts";

const START = "5a".repeat(80);
const UPDATE = "6b".repeat(40);

async function seat(label: string, roomId: string, access: unknown = { roomId, epoch: 2, keys: { "1": "old", "2": "new" } }): Promise<ChannelIdentityView> {
  const id = await generateIdentity(label);
  return { label, name: `#${label}`, pk: id.pk, sk: id.sk, roomId, code: `code-${label}`, access } as ChannelIdentityView;
}

function recorder() {
  const seen: { url: string; method: string; body: string; auth: string }[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), method: String(init?.method), body: String(init?.body ?? ""), auth: String((init?.headers as Record<string, string> | undefined)?.authorization) });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  return { seen, f };
}

describe("the phone's Live Activity tokens", () => {
  test("the push-to-start token goes to every channel it holds, signed by that channel's member key", async () => {
    const seats = [await seat("one", "room-one"), await seat("two", "room-two"), await seat("asking", "room-three", null)];
    const { seen, f } = recorder();
    const got = await registerLive("https://relay.example", seats, { start: START, sandbox: true }, f);
    expect(got.map((g) => [g.room, g.ok])).toEqual([
      ["room-one", true],
      ["room-two", true],
    ]);
    for (const [i, roomId] of ["room-one", "room-two"].entries()) {
      const sent = seen.find((s) => s.url === `https://relay.example/v1/rooms/${roomId}/live-token`)!;
      expect(sent.method).toBe("PUT");
      expect(JSON.parse(sent.body)).toEqual({ start: START, sandbox: true });
      expect(wellFormedLiveTokens(JSON.parse(sent.body))).toBe(true);
      expect(await verifyRequest(sent.auth.replace(/^Bearer /, ""), roomId, "PUT", "/live-token", sent.body)).toBe(seats[i]!.pk);
    }
  });

  test("an activity's update token goes only to its own channel", async () => {
    const seats = [await seat("one", "room-one"), await seat("two", "room-two")];
    const { seen, f } = recorder();
    await registerLive("https://relay.example", seats, { update: UPDATE, room: "room-two", sandbox: false }, f);
    expect(seen.map((s) => [s.url, s.body])).toEqual([["https://relay.example/v1/rooms/room-two/live-token", JSON.stringify({ update: UPDATE })]]);
  });

  test("no token sends nothing; a refusing relay is reported", async () => {
    const seats = [await seat("one", "room-one")];
    const { seen, f } = recorder();
    expect(await registerLive("https://relay.example", seats, { sandbox: true }, f)).toEqual([]);
    expect(seen).toEqual([]);
    const refusing = (async () => new Response("no", { status: 404 })) as unknown as typeof fetch;
    expect(await registerLive("https://relay.example", seats, { start: START, sandbox: true }, refusing)).toEqual([{ room: "room-one", ok: false, error: "the relay returned 404" }]);
  });

  test("signing out takes the tokens back from every channel", async () => {
    const seats = [await seat("one", "room-one"), await seat("two", "room-two")];
    const { seen, f } = recorder();
    await unregisterLive("https://relay.example", seats, f);
    expect(seen.map((s) => [s.method, s.url, s.body]).sort()).toEqual([
      ["DELETE", "https://relay.example/v1/rooms/room-one/live-token", ""],
      ["DELETE", "https://relay.example/v1/rooms/room-two/live-token", ""],
    ]);
  });
});

describe("the keys the widget opens blobs with", () => {
  test("each channel's keys, the current epoch first; a seat still asking has none", async () => {
    const seats = [await seat("one", "room-one"), await seat("asking", "room-two", null), await seat("odd", "room-three", { roomId: "room-three", epoch: 1, keys: {} })];
    expect(liveKeys(seats)).toEqual([{ room: "room-one", keys: ["new", "old"] }]);
  });
});
