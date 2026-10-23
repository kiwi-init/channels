import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appImageName, debName, type LinuxArch } from "../desktop/scripts/linux-files.ts";
import { useHost } from "../desktop/src/host.ts";
import { fakeHost, type FakeHost } from "./fake-host.ts";

type Checked = { state: string; version?: string; url?: string; blocked?: true; deb?: string };
interface Updater {
  checkForUpdate(): Promise<Checked>;
  updateState(): Checked | null;
  applyUpdate(relaunch: boolean): boolean;
}

const platformWas = process.platform;
const envWas = { TMPDIR: process.env["TMPDIR"], APPIMAGE: process.env["APPIMAGE"] };
const realFetch = globalThis.fetch;
const root = mkdtempSync(join(tmpdir(), "kiwi-uplinux-"));
const tmp = join(root, "tmp");
mkdirSync(tmp);
Object.defineProperty(process, "platform", { value: "linux", configurable: true });
process.env["TMPDIR"] = tmp;

const restore = (name: keyof typeof envWas): void => {
  const was = envWas[name];
  if (was === undefined) delete process.env[name];
  else process.env[name] = was;
};
afterAll(() => {
  Object.defineProperty(process, "platform", { value: platformWas, configurable: true });
  restore("TMPDIR");
  restore("APPIMAGE");
  globalThis.fetch = realFetch;
  for (const dir of readdirSync(root)) chmodSync(join(root, dir), 0o755);
  rmSync(root, { recursive: true, force: true });
});

const arch: LinuxArch = process.arch === "arm64" ? "arm64" : "x64";
const PAGE = "https://github.com/ojowwalker77/channels/releases/tag/v0.27.0";
const NEW = "the 0.27.0 AppImage";
const OLD = "the 0.26.0 AppImage";
const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

function release(sums = `${sha(NEW)}  ${appImageName("0.27.0", arch)}\n`): string[] {
  const seen: string[] = [];
  const files: Record<string, string> = { [appImageName("0.27.0", arch)]: NEW, [debName("0.27.0", arch)]: "the 0.27.0 deb", SHA256SUMS: sums };
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      const url = String(input);
      seen.push(url);
      if (url.endsWith("/releases/latest"))
        return Response.json({ tag_name: "v0.27.0", html_url: PAGE, assets: Object.keys(files).map((name) => ({ name, browser_download_url: `https://dl.example/${name}` })) });
      const body = files[url.replace("https://dl.example/", "")];
      return body === undefined ? new Response("", { status: 404 }) : new Response(body);
    },
    { preconnect: realFetch.preconnect },
  );
  return seen;
}

let loaded = 0;
async function launch(appImage: string | undefined, data: string): Promise<{ fake: FakeHost; u: Updater }> {
  if (appImage === undefined) delete process.env["APPIMAGE"];
  else process.env["APPIMAGE"] = appImage;
  mkdirSync(data, { recursive: true });
  const fake = fakeHost({ packaged: true, version: "0.26.0", paths: { data, logs: join(root, "logs") } });
  useHost(fake.host);
  const u = (await import(`../desktop/src/updater.ts?linux${loaded++}`)) as Updater;
  return { fake, u };
}

async function settled(u: Updater): Promise<Checked | null> {
  for (let i = 0; i < 200 && u.updateState()?.state === "downloading"; i++) await Bun.sleep(10);
  return u.updateState();
}

function installed(name: string): string {
  const dir = join(root, name);
  mkdirSync(dir);
  const file = join(dir, "Channels.AppImage");
  writeFileSync(file, OLD);
  chmodSync(file, 0o755);
  return file;
}

const downloads = (): string[] => readdirSync(tmp).filter((n) => n.startsWith("kiwi-update-"));

test("an AppImage downloads the release's AppImage, checks it against SHA256SUMS, swaps itself in place and relaunches it", async () => {
  const appImage = installed("Applications");
  release();
  const { fake, u } = await launch(appImage, join(root, "data-swap"));
  expect((await u.checkForUpdate()).state).toBe("downloading");
  expect(await settled(u)).toEqual({ version: "0.27.0", state: "ready", url: PAGE });
  expect(readFileSync(appImage, "utf8")).toBe(OLD);
  expect(u.applyUpdate(true)).toBe(true);
  expect(readFileSync(appImage, "utf8")).toBe(NEW);
  expect(statSync(appImage).mode & 0o777).toBe(0o755);
  expect(fake.did).toContain(`relaunch ${appImage}`);
  expect(downloads()).toEqual([]);
});

test("an AppImage whose download doesn't match SHA256SUMS stays as it is and only offers the release", async () => {
  const appImage = installed("Mismatch");
  release(`${"0".repeat(64)}  ${appImageName("0.27.0", arch)}\n`);
  const { fake, u } = await launch(appImage, join(root, "data-mismatch"));
  expect((await u.checkForUpdate()).state).toBe("downloading");
  expect(await settled(u)).toEqual({ version: "0.27.0", state: "available", url: PAGE });
  expect(u.applyUpdate(true)).toBe(false);
  expect(readFileSync(appImage, "utf8")).toBe(OLD);
  expect(fake.did.filter((d) => d.startsWith("relaunch"))).toEqual([]);
  expect(downloads()).toEqual([]);
});

test("an AppImage in a folder it can't write says it can't update itself and downloads nothing", async () => {
  const appImage = installed("ReadOnly");
  chmodSync(join(root, "ReadOnly"), 0o555);
  const seen = release();
  const { u } = await launch(appImage, join(root, "data-readonly"));
  expect(await u.checkForUpdate()).toEqual({ version: "0.27.0", state: "available", url: PAGE, blocked: true });
  expect(seen).toEqual(["https://api.github.com/repos/ojowwalker77/channels/releases/latest"]);
});

test("a deb install never swaps itself: it's offered the release's .deb for its CPU and downloads nothing", async () => {
  const seen = release();
  const { u } = await launch(undefined, join(root, "data-deb"));
  expect(await u.checkForUpdate()).toEqual({ version: "0.27.0", state: "available", url: PAGE, deb: `https://dl.example/${debName("0.27.0", arch)}` });
  expect(seen).toEqual(["https://api.github.com/repos/ojowwalker77/channels/releases/latest"]);
});

test("a swap that fails leaves the AppImage, says it can't update itself, and the next launch doesn't download that version again", async () => {
  const appImage = installed("Locked");
  const data = join(root, "data-locked");
  release();
  const first = await launch(appImage, data);
  await first.u.checkForUpdate();
  expect((await settled(first.u))?.state).toBe("ready");
  chmodSync(join(root, "Locked"), 0o555);
  expect(first.u.applyUpdate(true)).toBe(false);
  expect(readFileSync(appImage, "utf8")).toBe(OLD);
  expect(first.u.updateState()).toEqual({ version: "0.27.0", state: "available", url: PAGE, blocked: true });
  expect(first.fake.did.filter((d) => d.startsWith("relaunch"))).toEqual([]);
  expect(downloads()).toEqual([]);
  chmodSync(join(root, "Locked"), 0o755);
  const seen = release();
  const next = await launch(appImage, data);
  expect(await next.u.checkForUpdate()).toEqual({ version: "0.27.0", state: "available", url: PAGE, blocked: true });
  expect(seen).toEqual(["https://api.github.com/repos/ojowwalker77/channels/releases/latest"]);
  expect(existsSync(join(data, "update-failed"))).toBe(true);
});
