import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { hooksFixture } from "./hooks-fixture.ts";

test("a failed proxy setup closes the relay and removes every fixture directory", async () => {
  let relay = "";
  const failure = new Error("proxy setup failed");
  const fixture = hooksFixture({
    prefix: "kiwi-hooks-partial",
    sessionId: "partial",
    channel: "partial",
    transport: {
      kind: "proxy",
      start: (target) => {
        relay = target;
        throw failure;
      },
    },
  });
  try {
    await expect(fixture.start()).rejects.toBe(failure);
    expect(relay).not.toBe("");
    await expect(fetch(relay)).rejects.toThrow();
    for (const dir of [fixture.dataDir, fixture.claudeDir, fixture.owner, fixture.agent]) expect(existsSync(dir)).toBe(false);
  } finally {
    await fixture.dispose();
  }
});
