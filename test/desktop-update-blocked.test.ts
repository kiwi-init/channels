import { afterAll, expect, mock, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "kiwi-blocked-"));
const parent = join(root, "Applications");
const userData = join(root, "userData");
mkdirSync(join(parent, "Channels.app", "Contents", "MacOS"), { recursive: true });
mkdirSync(userData, { recursive: true });
afterAll(() => {
  chmodSync(parent, 0o755);
  rmSync(root, { recursive: true, force: true });
});

mock.module("electron", () => ({
  app: {
    isPackaged: true,
    getVersion: () => "0.19.0",
    getPath: (name: string) => (name === "exe" ? join(parent, "Channels.app", "Contents", "MacOS", "Channels") : userData),
    on: () => {},
  },
}));

type Checked = { state: string; version?: string; url?: string; blocked?: true };
const updater = "../desktop/src/updater.ts";
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
    const name = `Channels-0.20.0-mac-${process.arch === "arm64" ? "arm64" : "x64"}.zip`;
    return new Response(
      JSON.stringify({
        tag_name: "v0.20.0",
        html_url: "https://example.test/rel",
        assets: [
          { name, browser_download_url: "https://example.test/zip" },
          { name: "SHA256SUMS", browser_download_url: "https://example.test/sums" },
        ],
      }),
    );
  },
  { preconnect: realFetch.preconnect },
);

test.skipIf(process.platform !== "darwin")("a Mac app in a folder it can't write offers the release, says it can't update itself, and downloads nothing", async () => {
  chmodSync(parent, 0o555);
  const r = await checkForUpdate();
  expect(r).toEqual({ version: "0.20.0", state: "available", url: "https://example.test/rel", blocked: true });
  expect(seen.filter((u) => !u.includes("api.github.com"))).toEqual([]);
});

test.skipIf(process.platform !== "darwin")("after a swap of this version failed, the next launch offers the release instead of downloading it again", async () => {
  chmodSync(parent, 0o755);
  writeFileSync(join(userData, "update-failed"), "0.20.0");
  seen.length = 0;
  const r = await checkForUpdate();
  expect(r.state).toBe("available");
  expect(r.blocked).toBe(true);
  expect(seen.filter((u) => !u.includes("api.github.com"))).toEqual([]);
});
