import { describe, expect, test } from "bun:test";

import type { Handoff } from "@kiwi/core/protocol.ts";
import { handoffLabel } from "./handoff";

const link = (expiresAt: number, over: Partial<Handoff> = {}): Handoff => ({ url: "https://live.example.com/x", vendor: "cloudflare", expiresAt, ...over });

describe("handoff helpers", () => {
  test("the vendor label always shows where the link goes", () => {
    expect(handoffLabel(link(1))).toBe("cloudflare (live.example.com)");
    expect(handoffLabel(link(1, { vendor: "live.example.com" }))).toBe("live.example.com");
  });
});
