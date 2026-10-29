import { expect, test } from "bun:test";

import { DEFAULT_RELAY } from "@kiwi/core/relay-url.ts";
import { joinCommand, kiwiJoin } from "./join-line";

test("Invite and Add an agent build the same join line: relay, nickname, rules and persona, shell-quoted", () => {
  expect(kiwiJoin(DEFAULT_RELAY, "mc2-abc")).toBe("join mc2-abc");
  expect(kiwiJoin("http://localhost:3555", "mc2-abc", { nick: " Ana's bot ", about: "only web/", persona: "tok" })).toBe(
    "join mc2-abc --relay http://localhost:3555 --nick 'Ana'\\''s bot' --about 'only web/' --persona tok",
  );
  expect(kiwiJoin(DEFAULT_RELAY, "mc2-abc", { nick: "  ", about: "", persona: null })).toBe("join mc2-abc");
  expect(joinCommand(DEFAULT_RELAY, "mc2-abc", { nick: "scout" })).toEndWith("sh -s -- join mc2-abc --nick scout");
});
