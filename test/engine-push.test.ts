import { describe, expect, test } from "bun:test";
import { verifyRequest } from "@kiwi/core/auth.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { wellFormedPush } from "@kiwi/core/push.ts";
import type { ChannelIdentityView } from "../desktop/src/bridge.ts";
import { registerPush, unregisterPush } from "../ios/engine/push.ts";

const TOKEN = "ab".repeat(32);

async function seat(label: string, roomId: string, access: unknown = { k: 1 }): Promise<ChannelIdentityView> {
  const id = await generateIdentity(label);
  return { label, name: `#${label}`, pk: id.pk, sk: id.sk, roomId, code: `code-${label}`, access };
}

describe("the phone registers its push token", () => {
  test("each channel it holds gets a PUT /push signed by that channel's member key, with its own random tag", async () => {
    const seats = [await seat("one", "room-one"), await seat("two", "room-two"), await seat("asking", "room-three", null)];
    const seen: { url: string; body: string; auth: string }[] = [];
    const f = (async (url: string | URL, init?: RequestInit) => {
      seen.push({ url: String(url), body: String(init?.body), auth: String((init?.headers as Record<string, string> | undefined)?.authorization) });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const got = await registerPush("https://relay.example", seats, TOKEN, true, f);

    expect(got.map((g) => [g.code, g.label, g.ok])).toEqual([
      ["code-one", "#one", true],
      ["code-two", "#two", true],
    ]);
    expect(new Set(got.map((g) => g.tag)).size).toBe(2);
    expect(seen.map((s) => s.url).sort()).toEqual(["https://relay.example/v1/rooms/room-one/push", "https://relay.example/v1/rooms/room-two/push"]);
    for (const [i, roomId] of ["room-one", "room-two"].entries()) {
      const sent = seen.find((s) => s.url.endsWith(`/rooms/${roomId}/push`))!;
      const body = JSON.parse(sent.body) as unknown;
      expect(wellFormedPush(body)).toBe(true);
      expect(body).toEqual({ platform: "apns", token: TOKEN, tag: got[i]!.tag, sandbox: true });
      expect(await verifyRequest(sent.auth.replace(/^Bearer /, ""), roomId, "PUT", "/push", sent.body)).toBe(seats[i]!.pk);
    }
  });

  test("a production build leaves sandbox out, and a refusal comes back per channel", async () => {
    const seats = [await seat("one", "room-one"), await seat("two", "room-two")];
    const f = (async (url: string | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).not.toHaveProperty("sandbox");
      return new Response("{}", { status: String(url).includes("room-two") ? 403 : 200 });
    }) as typeof fetch;

    const got = await registerPush("https://relay.example", seats, TOKEN, false, f);

    expect(got.map((g) => [g.code, g.ok, g.error])).toEqual([
      ["code-one", true, undefined],
      ["code-two", false, "the relay returned 403"],
    ]);
  });
});

describe("the phone drops its push token on sign out", () => {
  test("each channel it holds gets a DELETE /push signed by that channel's member key; a seat still asking is left alone", async () => {
    const seats = [await seat("one", "room-one"), await seat("two", "room-two"), await seat("asking", "room-three", null)];
    const seen: { url: string; method: string; body: unknown; auth: string }[] = [];
    const f = (async (url: string | URL, init?: RequestInit) => {
      seen.push({ url: String(url), method: String(init?.method), body: init?.body, auth: String((init?.headers as Record<string, string> | undefined)?.authorization) });
      return new Response("{}", { status: String(url).includes("room-two") ? 403 : 200 });
    }) as typeof fetch;

    const got = await unregisterPush("https://relay.example", seats, f);

    expect(got).toEqual([
      { code: "code-one", label: "#one", ok: true },
      { code: "code-two", label: "#two", ok: false, error: "the relay returned 403" },
    ]);
    expect([...seen].sort((a, b) => a.url.localeCompare(b.url)).map((s) => [s.url, s.method, s.body])).toEqual([
      ["https://relay.example/v1/rooms/room-one/push", "DELETE", undefined],
      ["https://relay.example/v1/rooms/room-two/push", "DELETE", undefined],
    ]);
    for (const [i, roomId] of ["room-one", "room-two"].entries()) {
      const sent = seen.find((s) => s.url.endsWith(`/rooms/${roomId}/push`));
      expect(await verifyRequest(sent?.auth.replace(/^Bearer /, "") ?? "", roomId, "DELETE", "/push")).toBe(seats[i]?.pk ?? "no seat");
    }
  });

  test("a relay it can't reach comes back per channel instead of throwing", async () => {
    const f = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;

    expect(await unregisterPush("https://relay.example", [await seat("one", "room-one")], f)).toEqual([{ code: "code-one", label: "#one", ok: false, error: "offline" }]);
  });
});
