import { afterAll, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appImageName, debName, type LinuxArch } from "../desktop/scripts/linux-files.ts";
import { useHost } from "../desktop/src/host.ts";
import { fakeHost, type FakeHost } from "./fake-host.ts";
import { throwawayKey } from "./minisign-sign.ts";

const releaseKey = throwawayKey();
const otherKey = throwawayKey();
void mock.module("../desktop/src/release-key.ts", () => ({ RELEASE_KEY: releaseKey.publicKey }));

type Checked = { state: string; version?: string; url?: string; blocked?: true; deb?: string };
interface Updater {
  checkForUpdate(): Promise<Checked>;
  updateState(): Checked | null;
  applyUpdate(relaunch: boolean): boolean;
}

const platformWas = process.platform;
const envWas = { TMPDIR: process.env["TMPDIR"], APPIMAGE: process.env["APPIMAGE"], APPDIR: process.env["APPDIR"] };
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
  restore("APPDIR");
  globalThis.fetch = realFetch;
  for (const dir of readdirSync(root)) chmodSync(join(root, dir), 0o755);
  rmSync(root, { recursive: true, force: true });
});

const arch: LinuxArch = process.arch === "arm64" ? "arm64" : "x64";
const PAGE = "https://github.com/kiwi-init/channels/releases/tag/v0.27.0";
const NEW = "the 0.27.0 AppImage";
const OLD = "the 0.26.0 AppImage";
const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

const DOWNLOAD = "https://github.com/kiwi-init/channels/releases/download/v0.27.0/";
const LATEST = "https://github.com/kiwi-init/channels/releases/latest";
const ASSETS = "https://release-assets.githubusercontent.com/github-production-release-asset/";

interface Release {
  sums?: string;
  signature?: string | null;
  redirect?: (name: string) => string | null;
}

function release(o: Release = {}): string[] {
  const seen: string[] = [];
  const sums = o.sums ?? `${sha(NEW)}  ${appImageName("0.27.0", arch)}\n`;
  const signature = o.signature === undefined ? releaseKey.sign(sums) : o.signature;
  const files: Record<string, string> = {
    [appImageName("0.27.0", arch)]: NEW,
    [debName("0.27.0", arch)]: "the 0.27.0 deb",
    SHA256SUMS: sums,
    ...(signature === null ? {} : { "SHA256SUMS.minisig": signature }),
  };
  const where = (name: string) => `${DOWNLOAD}${name}`;
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      const url = String(input);
      seen.push(url);
      if (url === LATEST) return new Response(null, { status: 302, headers: { location: PAGE } });
      const name = Object.keys(files).find((n) => url === where(n) || url === `${ASSETS}${n}` || url.endsWith(`/${n}`));
      if (!name) return new Response("", { status: 404 });
      const to = url === where(name) ? (o.redirect?.(name) ?? null) : null;
      return to ? new Response(null, { status: 302, headers: { location: to } }) : new Response(files[name]);
    },
    { preconnect: realFetch.preconnect },
  );
  return seen;
}

let loaded = 0;
const setEnv = (name: "APPIMAGE" | "APPDIR", value: string | undefined): void => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

function mounted(name: string): { appDir: string; exe: string } {
  const appDir = join(root, `.mount_${name}`);
  const exe = join(appDir, "Channels", "bin", "bun");
  mkdirSync(join(appDir, "Channels", "bin"), { recursive: true });
  writeFileSync(exe, "bun");
  return { appDir, exe };
}

const DEB_EXE = join(root, "opt", "Channels", "bin", "bun");
mkdirSync(join(root, "opt", "Channels", "bin"), { recursive: true });
writeFileSync(DEB_EXE, "bun");

async function launch(appImage: string | undefined, data: string, run: { appDir?: string; exe: string } = appImage ? mounted(`${loaded}`) : { exe: DEB_EXE }): Promise<{ fake: FakeHost; u: Updater }> {
  setEnv("APPIMAGE", appImage);
  setEnv("APPDIR", run.appDir);
  mkdirSync(data, { recursive: true });
  const fake = fakeHost({ packaged: true, version: "0.26.0", paths: { data, logs: join(root, "logs"), exe: run.exe } });
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
  release({ redirect: (name) => `${ASSETS}${name}` });
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
  release({ sums: `${"0".repeat(64)}  ${appImageName("0.27.0", arch)}\n` });
  const { fake, u } = await launch(appImage, join(root, "data-mismatch"));
  expect((await u.checkForUpdate()).state).toBe("downloading");
  expect(await settled(u)).toEqual({ version: "0.27.0", state: "available", url: PAGE });
  expect(u.applyUpdate(true)).toBe(false);
  expect(readFileSync(appImage, "utf8")).toBe(OLD);
  expect(fake.did.filter((d) => d.startsWith("relaunch"))).toEqual([]);
  expect(downloads()).toEqual([]);
});

test("an AppImage can retry after a failed download and restart into the verified update", async () => {
  const appImage = installed("Retry");
  release({ sums: `${"0".repeat(64)}  ${appImageName("0.27.0", arch)}\n` });
  const { fake, u } = await launch(appImage, join(root, "data-retry"));
  await u.checkForUpdate();
  expect((await settled(u))?.state).toBe("available");
  expect(readFileSync(appImage, "utf8")).toBe(OLD);
  release();
  expect((await u.checkForUpdate()).state).toBe("downloading");
  expect((await settled(u))?.state).toBe("ready");
  expect(readFileSync(appImage, "utf8")).toBe(OLD);
  expect(u.applyUpdate(true)).toBe(true);
  expect(readFileSync(appImage, "utf8")).toBe(NEW);
  expect(fake.did).toContain(`relaunch ${appImage}`);
  expect(downloads()).toEqual([]);
});

test("an AppImage whose SHA256SUMS isn't signed with the pinned release key is never staged (issue #203)", async () => {
  const name = appImageName("0.27.0", arch);
  const good = `${sha(NEW)}  ${name}\n`;
  for (const [i, bad] of [
    { signature: otherKey.sign(good) },
    { signature: releaseKey.sign(`${sha("something else")}  ${name}\n`) },
    { signature: releaseKey.sign(good).replace(/\n[A-Za-z0-9+/=]+\n$/, `\n${"A".repeat(86)}==\n`) },
    { signature: "not a signature" },
  ].entries()) {
    const appImage = installed(`Unsigned${i}`);
    const seen = release(bad);
    const { fake, u } = await launch(appImage, join(root, `data-unsigned-${i}`));
    expect((await u.checkForUpdate()).state).toBe("downloading");
    expect(await settled(u)).toEqual({ version: "0.27.0", state: "available", url: PAGE });
    expect(seen.some((url) => url.endsWith(`/${name}`))).toBe(false);
    expect(u.applyUpdate(true)).toBe(false);
    expect(readFileSync(appImage, "utf8")).toBe(OLD);
    expect(fake.did.filter((d) => d.startsWith("relaunch"))).toEqual([]);
    expect(downloads()).toEqual([]);
  }
});

test("an AppImage whose release has no SHA256SUMS.minisig is never staged: it fetches SHA256SUMS and the missing signature, never the AppImage, and offers the release", async () => {
  const appImage = installed("NoSignature");
  const seen = release({ signature: null });
  const { u } = await launch(appImage, join(root, "data-no-signature"));
  expect((await u.checkForUpdate()).state).toBe("downloading");
  expect(await settled(u)).toEqual({ version: "0.27.0", state: "available", url: PAGE });
  expect(seen).toEqual([LATEST, `${DOWNLOAD}SHA256SUMS`, `${DOWNLOAD}SHA256SUMS.minisig`]);
  expect(readFileSync(appImage, "utf8")).toBe(OLD);
  expect(downloads()).toEqual([]);
});

test("an AppImage in a folder it can't write says it can't update itself and downloads nothing", async () => {
  const appImage = installed("ReadOnly");
  chmodSync(join(root, "ReadOnly"), 0o555);
  const seen = release();
  const { u } = await launch(appImage, join(root, "data-readonly"));
  expect(await u.checkForUpdate()).toEqual({ version: "0.27.0", state: "available", url: PAGE, blocked: true });
  expect(seen).toEqual([LATEST]);
});

test("a deb install never swaps itself: it's offered the release's .deb for its CPU and downloads nothing", async () => {
  const seen = release();
  const { u } = await launch(undefined, join(root, "data-deb"));
  expect(await u.checkForUpdate()).toEqual({ version: "0.27.0", state: "available", url: PAGE, deb: `${DOWNLOAD}${debName("0.27.0", arch)}` });
  expect(seen).toEqual([LATEST]);
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
  expect(seen).toEqual([LATEST]);
  expect(existsSync(join(data, "update-failed"))).toBe(true);
});

test("a deb install started from another AppImage app (its APPIMAGE inherited) is offered its .deb and never touches that app", async () => {
  const other = join(root, "Other");
  mkdirSync(other);
  const cursor = join(other, "Cursor.AppImage");
  writeFileSync(cursor, "the Cursor AppImage");
  const seen = release();
  const { fake, u } = await launch(cursor, join(root, "data-inherited"), { appDir: join(root, ".mount_CursorXYZ"), exe: DEB_EXE });
  expect(await u.checkForUpdate()).toEqual({ version: "0.27.0", state: "available", url: PAGE, deb: `${DOWNLOAD}${debName("0.27.0", arch)}` });
  expect(seen).toEqual([LATEST]);
  expect(u.applyUpdate(false)).toBe(false);
  expect(readFileSync(cursor, "utf8")).toBe("the Cursor AppImage");
  expect(fake.did.filter((d) => d.startsWith("relaunch"))).toEqual([]);
});

test("an AppImage takes its update only from GitHub: a redirect off GitHub's hosts is refused", async () => {
  const appImage = installed("OffGithub");
  const hops = release({ redirect: (name) => `https://evil.example/${name}` });
  const next = await launch(appImage, join(root, "data-redirect"));
  expect((await next.u.checkForUpdate()).state).toBe("downloading");
  expect(await settled(next.u)).toEqual({ version: "0.27.0", state: "available", url: PAGE });
  expect(hops.some((h) => h.startsWith("https://evil.example/"))).toBe(false);
  expect(readFileSync(appImage, "utf8")).toBe(OLD);
  expect(downloads()).toEqual([]);
});
