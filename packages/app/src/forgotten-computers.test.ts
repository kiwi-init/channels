import { expect, test } from "bun:test";
import type { Member } from "@kiwi/core/membership.ts";
import { launchedBy } from "./forgotten-computers";

const jow = { user: "user_jow", name: "Jonatas Walker" };
const row = (name: string, more: Partial<Member>): Member => ({ name, pk: `pk-${name}`, xpk: "x", owner: false, at: 1, active: true, kind: "agent", sponsor: jow, ...more });

test("forgetting a computer names the person's own agents it launched, and only those (T1467)", () => {
  const roster = [
    row("atlas", { from: { pk: "air", label: "Air" }, display: "Atlas" }),
    row("pixel", { from: { pk: "air-app", label: "Air" } }),
    row("ridge", { from: { pk: "studio", label: "studio" } }),
    row("left", { from: { pk: "air", label: "Air" }, active: false }),
    row("maya", { from: { pk: "air", label: "Air" }, kind: "human" }),
    row("theirs", { from: { pk: "air", label: "Air" }, sponsor: { user: "user_maya", name: "Maya" } }),
    row("plain", {}),
  ];
  expect(launchedBy(roster, ["air", "air-app"], "user_jow")).toEqual([
    { pk: "pk-atlas", from: "air", name: "Atlas" },
    { pk: "pk-pixel", from: "air-app", name: "pixel" },
  ]);
  expect(launchedBy(roster, ["phone"], "user_jow")).toEqual([]);
});
