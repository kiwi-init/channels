import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useHost } from "../desktop/src/host.ts";
import { fakeHost } from "./fake-host.ts";
import { FEED, releasePage, releasesFeed } from "./livewire-feed.ts";

const root = mkdtempSync(join(tmpdir(), "kiwi-blocked-"));
const parent = join(root, "Applications");
const userData = join(root, "userData");
mkdirSync(join(parent, "Channels Livewire.app", "Contents", "MacOS"), { recursive: true });
mkdirSync(userData, { recursive: true });
afterAll(() => {
  chmodSync(parent, 0o755);
  rmSync(root, { recursive: true, force: true });
});

useHost(fakeHost({ packaged: true, version: "0.19.0", paths: { exe: join(parent, "Channels Livewire.app", "Contents", "MacOS", "Channels"), data: userData, logs: userData } }).host);

type Checked = { state: string; version?: string; url?: string; blocked?: true };
const updater = "../desktop/src/updater.ts?blocked";
const { checkForUpdate } = (await import(updater)) as { checkForUpdate: () => Promise<Checked> };

const seen: string[] = [];
const realFetch = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});
globalThis.fetch = Object.assign(
  async (input: string | URL | Request) => {
    const u = String(input);
    seen.push(u);
    return new Response(releasesFeed("v0.20.0-livewire.1"));
  },
  { preconnect: realFetch.preconnect },
);

test.skipIf(process.platform !== "darwin")("a Mac app in a folder it can't write offers the release, says it can't update itself, and downloads nothing", async () => {
  chmodSync(parent, 0o555);
  const r = await checkForUpdate();
  expect(r).toEqual({ version: "0.20.0-livewire.1", state: "available", url: releasePage("v0.20.0-livewire.1"), blocked: true });
  expect(seen.filter((u) => u !== FEED)).toEqual([]);
});

test.skipIf(process.platform !== "darwin")("after a swap of this version failed, the next launch offers the release instead of downloading it again", async () => {
  chmodSync(parent, 0o755);
  writeFileSync(join(userData, "update-failed"), "0.20.0-livewire.1");
  seen.length = 0;
  const r = await checkForUpdate();
  expect(r.state).toBe("available");
  expect(r.blocked).toBe(true);
  expect(seen.filter((u) => u !== FEED)).toEqual([]);
});
