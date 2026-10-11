// Getting agents in without busywork: `kiwi demo` shows a whole session on a throwaway local relay.
// (Agents from the owner's own computers coming in with no code: test/grant.test.ts.)

import { describe, expect, test } from "bun:test";
import { runDemo } from "../src/demo.ts";

describe("kiwi demo", () => {
  test("plays a whole session on its own relay, and leaves nothing behind", async () => {
    const lines: string[] = [];
    const home = process.env.KIWI_HOME;
    await runDemo({ pace: 0, print: (l) => lines.push(l) });
    const all = lines.join("\n");
    expect(all).toContain("set the charter");
    expect(all).toContain("described itself: windows x64");
    expect(all).toContain("fits: win (free)");
    expect(all).toContain("needs review by someone who hasn't worked on it");
    expect(all).toContain("approved T");
    expect(all).toContain("handed T");
    expect(all).toContain("[escalation]");
    expect(all).toContain("ON HOLD");
    expect(all).toContain("lifted the hold");
    expect(process.env.KIWI_HOME).toBe(home);
  }, 60_000);
});
