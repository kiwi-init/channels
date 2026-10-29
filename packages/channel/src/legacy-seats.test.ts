import { expect, test } from "bun:test";

import type { ChannelIdentityView } from "../../../desktop/src/bridge.ts";
import { migrateLegacy, type KeyValues } from "./legacy-seats.ts";

function memory(init: Record<string, string>): KeyValues & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    removeItem: (k) => void data.delete(k),
  };
}

test("the first start spends the store's one migration even with nothing to move", async () => {
  const calls: ChannelIdentityView[][] = [];
  const n = await migrateLegacy(memory({ "mc.recent.x": "{}" }), async (entries) => {
    calls.push(entries);
    return entries.length;
  });
  expect(n).toBe(0);
  expect(calls).toEqual([[]]);
});

test("old seats move once, then leave localStorage; junk stays out", async () => {
  const store = memory({
    "mc.member.c1": JSON.stringify({ code: "c1", identity: { name: "ada", pk: "pk1", sk: "sk1" }, access: { roomId: "r1" }, at: 5 }),
    "mc.pending.c2": JSON.stringify({ code: "c2", identity: { name: "bo", pk: "pk2", sk: "sk2" }, requestId: "q2" }),
    "mc.member.bad": "not json",
    "mc.channels": "[]",
  });
  const calls: ChannelIdentityView[][] = [];
  const n = await migrateLegacy(store, async (entries) => {
    calls.push(entries);
    return entries.length;
  });
  expect(n).toBe(2);
  expect(calls[0]?.map((e) => [e.code, e.pk, e.requestId ?? null])).toEqual([
    ["c1", "pk1", null],
    ["c2", "pk2", "q2"],
  ]);
  expect([...store.data.keys()]).toEqual(["mc.member.bad"]);
});
