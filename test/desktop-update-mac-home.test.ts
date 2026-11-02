import { afterAll, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { useHost } from "../desktop/src/host.ts";
import { fakeHost, type FakeHost } from "./fake-host.ts";

void mock.module(join(import.meta.dir, "../desktop/src/signer.ts"), () => ({ signedLikeThisApp: async () => true }));

type Checked = { state: string; version?: string; url?: string; blocked?: true };
interface Updater {
  checkForUpdate(): Promise<Checked>;
  updateState(): Checked | null;
  applyUpdate(relaunch: boolean): boolean;
  movedApp(): { from?: string; to: string } | null;
}

const root = mkdtempSync(join(tmpdir(), "kiwi-machome-"));
const tmp = join(root, "tmp");
mkdirSync(tmp);
const envWas = { TMPDIR: process.env["TMPDIR"], HOME: process.env["HOME"] };
process.env["TMPDIR"] = tmp;
afterAll(() => {
  for (const [k, v] of Object.entries(envWas)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  globalThis.fetch = realFetch;
  Bun.spawnSync(["chmod", "-R", "u+w", root]);
  rmSync(root, { recursive: true, force: true });
});

const arch = process.arch === "arm64" ? "arm64" : "x64";
const PAGE = "https://github.com/kiwi-init/channels/releases/tag/v0.20.0";
const NAME = `Channels-0.20.0-mac-${arch}.zip`;
const realFetch = globalThis.fetch;

function zip(): Uint8Array {
  const src = join(root, "src");
  mkdirSync(join(src, "Channels.app", "Contents", "MacOS"), { recursive: true });
  writeFileSync(join(src, "Channels.app", "Contents", "MacOS", "Channels"), "0.20.0");
  const out = join(root, "new.zip");
  Bun.spawnSync(["/usr/bin/ditto", "-c", "-k", "--keepParent", join(src, "Channels.app"), out]);
  return new Uint8Array(readFileSync(out));
}

function release(): string[] {
  const seen: string[] = [];
  const z = process.platform === "darwin" ? zip() : new Uint8Array();
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      const u = String(input);
      seen.push(u);
      if (u.endsWith("/releases/latest")) return new Response(null, { status: 302, headers: { location: PAGE } });
      if (u.endsWith("/SHA256SUMS")) return new Response(`${createHash("sha256").update(z).digest("hex")}  ${NAME}\n`);
      return new Response(z);
    },
    { preconnect: realFetch.preconnect },
  );
  return seen;
}

function app(at: string, version?: string): string {
  mkdirSync(join(at, "Contents", "MacOS"), { recursive: true });
  mkdirSync(join(at, "Contents", "Resources"), { recursive: true });
  if (version) writeFileSync(join(at, "Contents", "Resources", "version.json"), JSON.stringify({ identifier: "com.kiwiinit.channels", version, channel: "stable" }));
  return at;
}

let loaded = 0;
async function launch(name: string, bundle: string, applications: string): Promise<{ fake: FakeHost; u: Updater; data: string; home: string }> {
  const home = join(root, `home-${name}`);
  mkdirSync(home, { recursive: true });
  process.env["HOME"] = home;
  const data = join(root, `data-${name}`);
  mkdirSync(data, { recursive: true });
  const fake = fakeHost({ packaged: true, version: "0.19.0", paths: { exe: join(bundle, "Contents", "MacOS", "Channels"), data, logs: data, applications } });
  useHost(fake.host);
  const u = (await import(`../desktop/src/updater.ts?machome${loaded++}`)) as Updater;
  return { fake, u, data, home };
}

async function settled(u: Updater): Promise<Checked | null> {
  for (let i = 0; i < 300 && u.updateState()?.state === "downloading"; i++) await Bun.sleep(10);
  return u.updateState();
}

const mac = test.skipIf(process.platform !== "darwin");

mac("a translocated Mac app downloads the update to put in Applications instead of offering the release page (T2366)", async () => {
  const bundle = app(join(root, "AppTranslocation", "ABC", "d", "Channels.app"), "0.19.0");
  const applications = join(root, "Applications-translocated");
  mkdirSync(applications);
  release();
  const { u } = await launch("translocated", bundle, applications);
  expect((await u.checkForUpdate()).state).toBe("downloading");
  expect(await settled(u)).toEqual({ version: "0.20.0", state: "ready", url: PAGE });
  expect(existsSync(join(applications, "Channels.app"))).toBe(false);
});

mac("a Mac app in a folder it can't write, with an Applications folder it can't write either, still updates (into ~/Applications) (T2366)", async () => {
  const parent = join(root, "ReadOnly");
  const bundle = app(join(parent, "Channels.app"), "0.19.0");
  const applications = join(root, "Applications-locked");
  mkdirSync(applications);
  chmodSync(parent, 0o555);
  chmodSync(applications, 0o555);
  release();
  const { u } = await launch("locked", bundle, applications);
  expect((await u.checkForUpdate()).state).toBe("downloading");
  expect((await settled(u))?.state).toBe("ready");
});

mac("a displaced Mac app whose Applications copy already has this release restarts into it and downloads nothing (T2366)", async () => {
  const bundle = app(join(root, "AppTranslocation", "DEF", "d", "Channels.app"), "0.19.0");
  const applications = join(root, "Applications-current");
  const home = app(join(applications, "Channels.app"), "0.20.0");
  const seen = release();
  const { fake, u } = await launch("current", bundle, applications);
  expect(await u.checkForUpdate()).toEqual({ version: "0.20.0", state: "ready", url: PAGE });
  expect(seen.filter((s) => !s.endsWith("/releases/latest"))).toEqual([]);
  expect(u.applyUpdate(false)).toBe(false);
  expect(u.applyUpdate(true)).toBe(true);
  expect(fake.did).toContain(`relaunch ${home}`);
  expect(existsSync(join(home, "Contents", "Resources", "version.json"))).toBe(true);
  expect(existsSync(applications)).toBe(true);
});

mac("a displaced Mac app whose Applications copy is older downloads the release to put over it (T2366)", async () => {
  const bundle = app(join(root, "AppTranslocation", "GHI", "d", "Channels.app"), "0.19.0");
  const applications = join(root, "Applications-older");
  app(join(applications, "Channels.app"), "0.18.0");
  const seen = release();
  const { u } = await launch("older", bundle, applications);
  expect((await u.checkForUpdate()).state).toBe("downloading");
  expect((await settled(u))?.state).toBe("ready");
  expect(seen.some((s) => s.endsWith(`/${NAME}`))).toBe(true);
});

mac("the moved notice shows only in the copy it names, and a translocated origin has no path to show (T2366)", async () => {
  const applications = join(root, "Applications-notice");
  const to = app(join(applications, "Channels.app"), "0.20.0");
  const old = app(join(root, "Old", "Channels.app"), "0.19.0");
  const there = await launch("notice-new", to, applications);
  writeFileSync(join(there.data, "update-moved"), JSON.stringify({ from: null, to }));
  expect(there.u.movedApp()).toEqual({ to });
  writeFileSync(join(there.data, "update-moved"), JSON.stringify({ from: old, to }));
  expect(there.u.movedApp()).toEqual({ from: old, to });
  const before = await launch("notice-old", old, applications);
  writeFileSync(join(before.data, "update-moved"), JSON.stringify({ from: old, to }));
  expect(before.u.movedApp()).toBeNull();
});
