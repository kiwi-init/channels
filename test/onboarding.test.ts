// Getting agents in without busywork: `kiwi demo` shows a whole session on a throwaway local relay.
// (Agents from the owner's own computers coming in with no code: test/grant.test.ts.)

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { runDemo } from "../src/demo.ts";

describe("kiwi demo", () => {
  test("plays a whole session on its own relay, and leaves nothing behind", async () => {
    const lines: string[] = [];
    const home = process.env.KIWI_HOME;
    await runDemo({ pace: 0, print: (l) => lines.push(l) });
    const all = lines.join("\n");
    expect(all).toContain("set the charter");
    expect(all).toContain("described itself: codex · windows x64");
    expect(all).toMatch(/T\d+\s+open\s+Inject mouse input on Windows/);
    expect(all).toContain("needs review by someone who hasn't worked on it");
    expect(all).toContain("approved T");
    expect(all).toMatch(/assigned T\d+ “Capture input at the screen edge on the Mac” to lead: edge detection works/);
    expect(all).toContain("[escalation]");
    expect(all).toContain("ON HOLD");
    expect(all).toContain("lifted the hold");
    expect(process.env.KIWI_HOME).toBe(home);
  }, 60_000);

  test("--stay prints a dashboard link that is a plain join code, and lets the dashboard in when it asks", async () => {
    const lines: string[] = [];
    const web = mkdtempSync(join(tmpdir(), "kiwi-demo-web-"));
    writeFileSync(join(web, "index.html"), "<!doctype html><title>kiwi</title>");
    const listening = process.listenerCount("SIGINT");
    const stop = new AbortController();
    const staying = runDemo({ pace: 0, stay: true, web, stop: stop.signal, print: (l) => lines.push(l) });
    try {
      const link = await waitFor(() => lines.join("\n").match(/https?:\/\/\S+#\S+/)?.[0]);
      const url = new URL(link);
      const code = decodeURIComponent(url.hash.slice(1));
      expect(code).toStartWith("mc2-");
      expect(link).not.toContain("&id=");
      const id = await generateIdentity("dashboard");
      const { requestId } = await Channel.requestJoin(url.origin, code, id, { name: "dashboard" });
      const status = await waitFor(async () => {
        const st = await Channel.joinStatus(url.origin, code, id, requestId);
        return st.status === "approved" ? st : undefined;
      });
      expect(status.status).toBe("approved");
    } finally {
      stop.abort();
      await staying;
      expect(process.listenerCount("SIGINT")).toBe(listening);
      rmSync(web, { recursive: true, force: true });
    }
  }, 60_000);
});

async function waitFor<T>(look: () => T | undefined | Promise<T | undefined>, ms = 30_000): Promise<T> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const got = await look();
    if (got !== undefined) return got;
    await Bun.sleep(200);
  }
  throw new Error("timed out waiting");
}
