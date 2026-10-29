import { describe, expect, test } from "bun:test";

import type { Member } from "@kiwi/core/membership.ts";
import { fold } from "@kiwi/core/state.ts";

import { foldRoster } from "./fold-roster.ts";

const ana: Member = {
  name: "ana",
  pk: "ana-pk",
  xpk: "ana-xpk",
  kind: "human",
  display: "Ana",
  sponsor: { user: "u-ana", name: "Ana", handle: "ana" },
  color: "teal",
  scopes: [],
  answersDecisions: true,
  addsAgents: true,
  owner: false,
  at: 1,
  active: true,
};

describe("foldRoster", () => {
  test("what the owner signed into a record reaches the app's fold, as it reaches the agents'", () => {
    const [row] = foldRoster([ana]);
    expect(row).toMatchObject({ name: "ana", kind: "human", display: "Ana", scopes: [], answersDecisions: true });
    expect(fold([], foldRoster([ana])).members.get("ana")?.answersDecisions).toBe(true);
  });

  test("the record's colour stays out, as it always has in the app", () => {
    expect(foldRoster([ana])[0]).not.toHaveProperty("color");
  });
});
