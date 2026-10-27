import { afterAll, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useHost } from "../desktop/src/host.ts";
import { fakeHost } from "./fake-host.ts";

const root = mkdtempSync(join(tmpdir(), "kiwi-upfail-"));
const bundle = join(root, "Applications", "Channels.app");
const logs = join(root, "logs");
const tmp = join(root, "tmp");
mkdirSync(join(bundle, "Contents", "MacOS"), { recursive: true });
mkdirSync(tmp);
const tmpWas = process.env["TMPDIR"];
process.env["TMPDIR"] = tmp;
afterAll(() => {
  process.env["TMPDIR"] = tmpWas;
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

useHost(fakeHost({ packaged: true, version: "0.19.0", paths: { exe: join(bundle, "Contents", "MacOS", "Channels"), logs, data: join(root, "userData") } }).host);
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
const realFetch = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});
globalThis.fetch = Object.assign(
  async (input: string | URL | Request) => {
    const u = String(input);
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

test.skipIf(mac)("a temp folder that can't be made ends at available, not stuck on downloading, and says why in main.log", async () => {
  release();
  process.env["TMPDIR"] = join(root, "no-such-dir");
  try {
    await checkForUpdate();
    expect(await settled()).toBe("available");
  } finally {
    process.env["TMPDIR"] = tmp;
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
  for (const d of readdirSync(tmp)) rmSync(join(tmp, d), { recursive: true, force: true });
  expect(applyUpdate(false)).toBe(false);
  expect(updateState()?.state).toBe("available");
  expect(readFileSync(join(logs, "main.log"), "utf8")).toContain("the staged Channels 0.20.0 is gone");
});
