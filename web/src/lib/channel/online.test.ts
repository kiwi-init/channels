import { describe, expect, test } from "bun:test";

import { PROTOCOL_VERSION, type Presence } from "@kiwi/core/protocol.ts";

import { hear, onlineByName, PRESENCE_TTL, type Online } from "./online";

const keyOf = new Map([
  ["win", "pk-win"],
  ["mac", "pk-mac"],
]);

const beacon = (from: string, pk: string, over: Partial<Presence & { sigOk: boolean }> = {}): Presence & { sigOk: boolean } => ({
  v: PROTOCOL_VERSION,
  type: "presence",
  from,
  client: "daemon",
  ts: 0,
  pk,
  sigOk: true,
  ...over,
});

const heardAll = (beacons: (Presence & { sigOk: boolean })[], at = 1_000): ReadonlyMap<string, Online> => beacons.reduce<ReadonlyMap<string, Online>>((m, p) => hear(m, p, at), new Map());

describe("presence by key", () => {
  test("a member's beacon naming win, signed with its own key, leaves win online as win said", () => {
    const heard = heardAll([beacon("win", "pk-win", { reach: "listening" }), beacon("win", "pk-mac", { reach: "unreachable" })]);
    const online = onlineByName(heard, keyOf, 1_000);
    expect([...online.keys()]).toEqual(["win"]);
    expect(online.get("win")).toMatchObject({ pk: "pk-win", reach: "listening" });
  });

  test("win's own beacon counts, and its newer one replaces what it said", () => {
    const first = onlineByName(heardAll([beacon("win", "pk-win", { reach: "listening" })]), keyOf, 1_000);
    expect(first.get("win")?.reach).toBe("listening");
    const later = onlineByName(heardAll([beacon("win", "pk-win", { reach: "listening" }), beacon("win", "pk-win", { reach: "running" })]), keyOf, 1_000);
    expect(later.get("win")?.reach).toBe("running");
  });

  test("a spoof heard after the member's own beacon only hides the spoofer, never the member it names", () => {
    const heard = heardAll([beacon("mac", "pk-mac"), beacon("win", "pk-win"), beacon("win", "pk-mac")]);
    expect([...onlineByName(heard, keyOf, 1_000).keys()]).toEqual(["win"]);
  });

  test("a key the roster gives to nobody, or to someone else, is never shown under the name it claims", () => {
    const heard = heardAll([beacon("win", "pk-old"), beacon("ghost", "pk-ghost"), beacon("mac", "pk-win")]);
    expect(onlineByName(heard, keyOf, 1_000).size).toBe(0);
  });

  test("an unsigned beacon, a probe, or one with no key is not heard", () => {
    const heard = heardAll([beacon("win", "pk-win", { sigOk: false }), beacon("win", "pk-win", { client: "probe" }), beacon("win", "", {})]);
    expect(heard.size).toBe(0);
  });

  test("a beacon older than the TTL drops out of view, and the next one heard prunes it", () => {
    const old = hear(new Map(), beacon("win", "pk-win"), 0);
    expect(onlineByName(old, keyOf, PRESENCE_TTL - 1).has("win")).toBe(true);
    expect(onlineByName(old, keyOf, PRESENCE_TTL).has("win")).toBe(false);
    const next = hear(old, beacon("mac", "pk-mac"), PRESENCE_TTL);
    expect([...next.keys()]).toEqual(["pk-mac"]);
  });
});
