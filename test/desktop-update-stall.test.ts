import { afterAll, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useHost } from "../desktop/src/host.ts";
import { fakeHost } from "./fake-host.ts";
import { FEED, releasesFeed } from "./livewire-feed.ts";

const root = mkdtempSync(join(tmpdir(), "kiwi-upstall-"));
const bundle = join(root, "Applications", "Channels Livewire.app");
const tmp = join(root, "tmp");
mkdirSync(join(bundle, "Contents", "MacOS"), { recursive: true });
mkdirSync(tmp);
const tmpWas = process.env["TMPDIR"];
process.env["TMPDIR"] = tmp;
afterAll(() => {
  process.env["TMPDIR"] = tmpWas;
  rmSync(root, { recursive: true, force: true });
});

useHost(fakeHost({ packaged: true, version: "0.19.0", paths: { exe: join(bundle, "Contents", "MacOS", "Channels"), data: join(root, "userData"), logs: join(root, "logs") } }).host);
mock.module(join(import.meta.dir, "../desktop/src/signer.ts"), () => ({ signedLikeThisApp: async () => true }));

type Checked = { state: string; version?: string };
const updater = "../desktop/src/updater.ts?stall";
const { checkForUpdate, updateState } = (await import(updater)) as { checkForUpdate: () => Promise<Checked>; updateState: () => Checked | null };

const arch = process.arch === "arm64" ? "arm64" : "x64";
let tag = "v0.20.0-livewire.1";
let stall = false;
let stalled: ReadableStreamDefaultController<Uint8Array> | null = null;
const zips = new Map<string, Uint8Array>();
const realFetch = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

function zipFor(version: string): Uint8Array {
  const had = zips.get(version);
  if (had) return had;
  const src = join(root, `src-${version}`);
  mkdirSync(join(src, "Channels Livewire.app", "Contents", "MacOS"), { recursive: true });
  writeFileSync(join(src, "Channels Livewire.app", "Contents", "MacOS", "Channels"), version);
  const out = join(root, `${version}.zip`);
  Bun.spawnSync(["/usr/bin/ditto", "-c", "-k", "--keepParent", join(src, "Channels Livewire.app"), out]);
  const z = new Uint8Array(readFileSync(out));
  zips.set(version, z);
  return z;
}

globalThis.fetch = Object.assign(
  async (input: string | URL | Request) => {
    const u = String(input);
    const version = tag.slice("v".length);
    const name = `Channels-${version}-mac-${arch}.zip`;
    if (u === FEED) return new Response(releasesFeed("v0.19.0-livewire.1", tag));
    if (u.endsWith("/SHA256SUMS")) return new Response(`${createHash("sha256").update(zipFor(version)).digest("hex")}  ${name}\n`);
    if (stall) return new Response(new ReadableStream<Uint8Array>({ start: (c) => void (stalled = c) }));
    return new Response(zipFor(version));
  },
  { preconnect: realFetch.preconnect },
);

async function settled(): Promise<Checked | null> {
  const end = Date.now() + 10_000;
  while (updateState()?.state === "downloading" && Date.now() < end) await Bun.sleep(10);
  return updateState();
}

const notMac = process.platform !== "darwin";

test.skipIf(notMac)("a check comes back once the release is known, and a stalled download doesn't hold up the next check", async () => {
  stall = true;
  const started = Date.now();
  expect(await checkForUpdate()).toMatchObject({ state: "downloading", version: "0.20.0-livewire.1" });
  expect(await checkForUpdate()).toMatchObject({ state: "downloading", version: "0.20.0-livewire.1" });
  expect(Date.now() - started).toBeLessThan(2_000);
  stalled?.error(new Error("the connection dropped"));
  expect(await settled()).toMatchObject({ state: "available", version: "0.20.0-livewire.1" });
});

test.skipIf(notMac)("a newer release replaces a staged one instead of hiding behind it", async () => {
  stall = false;
  await checkForUpdate();
  expect(await settled()).toMatchObject({ state: "ready", version: "0.20.0-livewire.1" });
  const before = readdirSync(tmp);
  tag = "v0.21.0-livewire.1";
  expect(await checkForUpdate()).toMatchObject({ state: "downloading", version: "0.21.0-livewire.1" });
  expect(await settled()).toMatchObject({ state: "ready", version: "0.21.0-livewire.1" });
  for (const d of before) expect(existsSync(join(tmp, d))).toBe(false);
});
