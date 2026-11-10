import { afterAll, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useHost } from "../desktop/src/host.ts";
import { fakeHost } from "./fake-host.ts";

const root = mkdtempSync(join(tmpdir(), "kiwi-upfail-"));
const bundle = join(root, "Applications", "Channels.app");
const logs = join(root, "logs");
const tmp = join(root, "tmp");
const data = join(root, "userData");
mkdirSync(join(bundle, "Contents", "MacOS"), { recursive: true });
mkdirSync(tmp);
const tmpWas = process.env["TMPDIR"];
process.env["TMPDIR"] = tmp;
afterAll(() => {
  process.env["TMPDIR"] = tmpWas;
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

useHost(fakeHost({ packaged: true, version: "0.19.0", paths: { exe: join(bundle, "Contents", "MacOS", "Channels"), logs, data } }).host);
mock.module(join(import.meta.dir, "../desktop/src/signer.ts"), () => ({ signedLikeThisApp: async () => true }));

type Checked = { state: string; version?: string };
const updater = "../desktop/src/updater.ts?failures";
const { checkForUpdate, applyUpdate, updateState } = (await import(updater)) as {
  checkForUpdate: () => Promise<Checked>;
  applyUpdate: (relaunch: boolean) => boolean;
  updateState: () => Checked | null;
};

const name = `Channels-0.20.0-mac-${process.arch === "arm64" ? "arm64" : "x64"}.zip`;
let zip: Uint8Array = new Uint8Array();
let sums = "";
const fetched: string[] = [];
const realFetch = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});
globalThis.fetch = Object.assign(
  async (input: string | URL | Request) => {
    const u = String(input);
    fetched.push(u);
    if (u.endsWith("/releases/latest")) return new Response(null, { status: 302, headers: { location: "https://github.com/kiwi-init/channels/releases/tag/v0.20.0" } });
    if (u.endsWith("/SHA256SUMS")) return new Response(sums);
    return new Response(zip);
  },
  { preconnect: realFetch.preconnect },
);

function release(): void {
  const src = join(root, "src");
  mkdirSync(join(src, "Channels.app", "Contents", "MacOS"), { recursive: true });
  writeFileSync(join(src, "Channels.app", "Contents", "MacOS", "Channels"), "new");
  mkdirSync(join(src, "Channels.app", "Contents", "Resources"), { recursive: true });
  writeFileSync(join(src, "Channels.app", "Contents", "Resources", "version.json"), JSON.stringify({ version: "0.20.0" }));
  const out = join(root, name);
  Bun.spawnSync(["/usr/bin/ditto", "-c", "-k", "--keepParent", join(src, "Channels.app"), out]);
  zip = new Uint8Array(readFileSync(out));
  sums = `${createHash("sha256").update(zip).digest("hex")}  ${name}\n`;
}

const mac = process.platform !== "darwin";

async function settled(): Promise<string | undefined> {
  const end = Date.now() + 10_000;
  while (updateState()?.state === "downloading" && Date.now() < end) await Bun.sleep(10);
  return updateState()?.state;
}

test.skipIf(mac)("a staging folder that can't be made ends at available, not stuck on downloading, and says why in main.log", async () => {
  release();
  rmSync(data, { recursive: true, force: true });
  writeFileSync(data, "a file where the app's data folder should be");
  try {
    await checkForUpdate();
    expect(await settled()).toBe("available");
  } finally {
    rmSync(data, { force: true });
  }
  expect(updateState()?.state).toBe("available");
  expect(readFileSync(join(logs, "main.log"), "utf8")).toContain("couldn't put Channels 0.20.0 in place");
});

test.skipIf(mac)("a download that doesn't match its checksum is logged with that reason", async () => {
  release();
  sums = `${"0".repeat(64)}  ${name}\n`;
  await checkForUpdate();
  expect(await settled()).toBe("available");
  expect(readFileSync(join(logs, "main.log"), "utf8")).toContain(`${name} doesn't match its SHA256SUMS line`);
});

test.skipIf(mac)("a staged update whose folder went away doesn't throw at quit: nothing goes in, and the release is offered", async () => {
  release();
  await checkForUpdate();
  expect(await settled()).toBe("ready");
  rmSync(join(data, "update-staged"), { recursive: true, force: true });
  expect(applyUpdate(false)).toBe(false);
  expect(updateState()?.state).toBe("available");
  expect(readFileSync(join(logs, "main.log"), "utf8")).toContain("the staged Channels 0.20.0 is gone");
});

test.skipIf(mac)("a Mac update downloaded before a crash is still good at the next start: its version and signature are checked again, and it isn't downloaded again (T1770)", async () => {
  release();
  await checkForUpdate();
  expect(await settled()).toBe("ready");
  fetched.length = 0;
  const again = (await import(`${updater}-again`)) as { checkForUpdate: () => Promise<Checked>; updateState: () => Checked | null };
  expect(await again.checkForUpdate()).toMatchObject({ state: "ready", version: "0.20.0" });
  expect(fetched.filter((u) => !u.endsWith("/releases/latest"))).toEqual([]);
  writeFileSync(join(data, "update-staged", "Channels.app", "Contents", "Resources", "version.json"), JSON.stringify({ version: "0.19.5" }));
  const third = (await import(`${updater}-third`)) as { checkForUpdate: () => Promise<Checked>; updateState: () => Checked | null };
  expect((await third.checkForUpdate()).state).toBe("downloading");
  expect(fetched.some((u) => u.endsWith(name))).toBe(true);
});
