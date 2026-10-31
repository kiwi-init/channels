import { describe, expect, test } from "bun:test";
import type { ChannelState } from "@kiwi/core/state.ts";
import { settingsSync } from "./settings-sync.ts";

const state: Pick<ChannelState, "repos" | "charter" | "rooms" | "head"> = {
  repos: ["kiwi-init/channels"],
  charter: { text: "Ship the app", by: "tia", at: 0 },
  rooms: new Map([["design", { id: "design", name: "design", createdBy: "tia", at: 0 }]]),
  head: 12,
};

describe("the owner's app copies a trusted person's setup to the relay (T632)", () => {
  test("what the log says differs from the relay's copy: it sends the log's, as of the head", () => {
    expect(settingsSync(state, { charter: { text: "old", since: 3 }, hold: null, repos: { list: [], since: 3 } }, { list: [], since: 3 })).toEqual({
      repos: { list: ["kiwi-init/channels"], since: 12 },
      charter: { text: "Ship the app", since: 12 },
      rooms: { list: [{ id: "design", name: "design" }], since: 12 },
    });
  });

  test("nothing the relay already has, so the owner's own changes aren't sent twice", () => {
    expect(
      settingsSync(state, { charter: { text: "Ship the app", since: 8 }, hold: null, repos: { list: ["kiwi-init/channels"], since: 7 } }, { list: [{ id: "design", name: "design" }], since: 9 }),
    ).toEqual({});
    expect(settingsSync({ repos: [], charter: null, rooms: new Map(), head: 0 }, null, null)).toEqual({});
  });

  test("a relay with no copy yet gets one as soon as the log has something", () => {
    expect(Object.keys(settingsSync({ ...state, charter: null, rooms: new Map() }, null, null))).toEqual(["repos"]);
  });
});
