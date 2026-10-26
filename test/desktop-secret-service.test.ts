import { describe, expect, test } from "bun:test";

import { holdsItems, isCancel, ownedReply } from "../desktop/src/secret-service.ts";

describe("reading the Secret Service through gdbus (T1566)", () => {
  test("SearchItems holds Channels' key when either list names an item", () => {
    expect(holdsItems("([], [objectpath '/org/freedesktop/secrets/collection/login/1'])\n")).toBe(true);
    expect(holdsItems("([objectpath '/org/freedesktop/secrets/collection/login/1'], [])\n")).toBe(true);
    expect(holdsItems("([], [])\n")).toBe(false);
    expect(holdsItems(null)).toBe(false);
  });

  test("NameHasOwner says whether a keyring runs", () => {
    expect(ownedReply("(true,)\n")).toBe(true);
    expect(ownedReply("(false,)\n")).toBe(false);
    expect(ownedReply(null)).toBe(false);
  });

  test("a prompt's Completed is a cancel only when it says dismissed", () => {
    expect(isCancel("/org/freedesktop/secrets/prompt/p1: org.freedesktop.Secret.Prompt.Completed (true, <@ao []>)")).toBe(true);
    expect(isCancel("/org/freedesktop/secrets/prompt/p1: org.freedesktop.Secret.Prompt.Completed (false, <@ao [objectpath '/x']>)")).toBe(false);
    expect(isCancel("/org/freedesktop/secrets: org.freedesktop.Secret.Service.CollectionChanged (objectpath '/x',)")).toBe(false);
  });
});
