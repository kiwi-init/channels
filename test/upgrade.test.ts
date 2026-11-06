import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { upgrade } from "../src/cli/upgrade.ts";
import { throwawayKey } from "./minisign-sign.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Unpacker = readonly [string, ...string[]];

const sha = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");
const XZ_BODY = '#!/bin/sh\ncase "$1" in\n--version) echo 2026.10.4 ;;\nesac\n: from-xz\n';
const CAT: Unpacker = ["/bin/cat"];

function brokenXz(): Unpacker {
  const dir = mkdtempSync(join(tmpdir(), "kiwi-upgrade-xz-"));
  dirs.push(dir);
  const xz = join(dir, "xz");
  writeFileSync(xz, '#!/bin/sh\nhead -c 16 "$2"; echo "xz: Unsupported filter chain" >&2; exit 1\n', { mode: 0o755 });
  return [xz, "-dc"];
}

function fixture(
  settings: {
    version?: string;
    checksum?: string;
    body?: string;
    status?: number;
    location?: string;
    cleanupFails?: boolean;
    tamper?: boolean;
    noSig?: boolean;
    xz?: string | Buffer;
    xzChecksum?: string;
    noGz?: boolean;
    unpacker?: Unpacker | null;
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "kiwi-upgrade-test-"));
  dirs.push(dir);
  const executable = join(dir, "kiwi");
  const old = "#!/bin/sh\necho 2026.10.1\n";
  writeFileSync(executable, old, { mode: 0o751 });
  const body = settings.body ?? `#!/bin/sh\ncase "$1" in\n--version) echo 2026.10.4 ;;\ncleanup) ${settings.cleanupFails ? "exit 1" : `printf cleaned > '${join(dir, "cleaned")}'`} ;;\nesac\n`;
  const packed = gzipSync(body);
  const sum = settings.checksum ?? sha(packed);
  const xz = settings.xz === undefined ? null : Buffer.from(settings.xz);
  const key = throwawayKey();
  const sumsText = (settings.noGz ? "" : `${sum}  kiwi-linux-x64.gz\n`) + (xz ? `${settings.xzChecksum ?? sha(xz)}  kiwi-linux-x64.xz\n` : "");
  const sigText = key.sign(settings.tamper ? "different checksums entirely" : sumsText, "kiwi v2026.10.4 SHA256SUMS");
  const urls: string[] = [];
  const messages: string[] = [];
  const request = async (url: string, init: RequestInit): Promise<Response> => {
    urls.push(url);
    if (url.endsWith("/latest")) {
      expect(init.redirect).toBe("manual");
      return new Response(null, { status: 302, headers: { location: settings.location ?? "https://github.com/kiwi-init/channels/releases/tag/v2026.10.4" } });
    }
    expect(url).toContain("/download/v2026.10.4/");
    if (url.endsWith("SHA256SUMS.minisig")) {
      if (settings.noSig) return new Response("not found", { status: 404 });
      return new Response(sigText);
    }
    if (url.endsWith("SHA256SUMS")) return new Response(sumsText);
    if (url.endsWith(".xz") && xz) return new Response(xz, { status: settings.status ?? 200 });
    return new Response(packed, { status: settings.status ?? 200 });
  };
  const options = {
    executable,
    source: false,
    version: settings.version ?? "2026.10.1",
    platform: "linux",
    arch: "x64",
    releaseKey: key.publicKey,
    request,
    report: (message: string): void => {
      messages.push(message);
    },
    ...(settings.unpacker === undefined ? {} : { xz: settings.unpacker }),
  };
  return { dir, executable, old, body, urls, messages, options };
}

test("upgrades a custom install atomically, preserving permissions and running cleanup", async () => {
  const f = fixture();
  const before = statSync(f.executable);
  await upgrade(f.options);
  expect(readFileSync(f.executable, "utf8")).toBe(f.body);
  expect(statSync(f.executable).ino).not.toBe(before.ino);
  expect(statSync(f.executable).mode & 0o777).toBe(0o751);
  expect(readFileSync(join(f.dir, "cleaned"), "utf8")).toBe("cleaned");
  expect(readdirSync(f.dir).sort()).toEqual(["cleaned", "kiwi"]);
  expect(f.messages.join("\n")).toContain("Upgraded Kiwi 2026.10.1 → 2026.10.4");
});

test.each(["2026.10.4", "2026.10.5", "2026.11.0-rc.1"])("does not download or downgrade %s", async (version) => {
  const f = fixture({ version });
  await upgrade(f.options);
  expect(f.urls).toHaveLength(1);
  expect(readFileSync(f.executable, "utf8")).toBe(f.old);
  expect(f.messages.join("\n")).toContain("already up to date");
});

test.each([
  { checksum: "0".repeat(64) },
  { checksum: "invalid" },
  { status: 503 },
  { body: "#!/bin/sh\necho 0.0.0\n" },
  { body: "not an executable" },
  { location: "https://example.com/releases/tag/v2026.10.4" },
  { location: "https://github.com/kiwi-init/channels/releases/tag/v2026.10.4-rc.1" },
])("keeps the old binary and removes staging on failure: %j", async (settings) => {
  const f = fixture(settings);
  await expect(upgrade(f.options)).rejects.toThrow();
  expect(readFileSync(f.executable, "utf8")).toBe(f.old);
  expect(readdirSync(f.dir)).toEqual(["kiwi"]);
});

test("reports cleanup failure without reporting the installed upgrade as failed", async () => {
  const f = fixture({ cleanupFails: true });
  await upgrade(f.options);
  expect(readFileSync(f.executable, "utf8")).toBe(f.body);
  expect(f.messages.join("\n")).toContain("run kiwi cleanup");
});

test.each([
  { noSig: true, why: /no SHA256SUMS\.minisig/ },
  { tamper: true, why: /signature doesn't match the key this Kiwi pins/ },
])("keeps the old binary when the release's signature can't be trusted: %j", async (settings) => {
  const f = fixture(settings);
  await expect(upgrade(f.options)).rejects.toThrow(settings.why);
  expect(readFileSync(f.executable, "utf8")).toBe(f.old);
  expect(f.urls.filter((u) => /\.(gz|xz)$/.test(u))).toHaveLength(0);
});

test("follows a custom install symlink without replacing the link", async () => {
  const f = fixture();
  const link = join(f.dir, "kiwi-link");
  symlinkSync(f.executable, link);
  await upgrade({ ...f.options, executable: link });
  expect(readFileSync(link, "utf8")).toBe(f.body);
  expect(readFileSync(f.executable, "utf8")).toBe(f.body);
});

test.each(["Cellar/kiwi/2026.10.1/bin/kiwi", "Channels.app/Contents/MacOS/kiwi"])("refuses managed install %s before networking", async (path) => {
  const f = fixture();
  const executable = join(f.dir, path);
  mkdirSync(dirname(executable), { recursive: true });
  writeFileSync(executable, f.old);
  await expect(upgrade({ ...f.options, executable })).rejects.toThrow(path.startsWith("Cellar") ? "brew upgrade kiwi" : "update Channels");
  expect(f.urls).toHaveLength(0);
});

test("refuses source runs and unsupported platforms before networking", async () => {
  const f = fixture();
  await expect(upgrade({ ...f.options, source: true })).rejects.toThrow("runs from source");
  await expect(upgrade({ ...f.options, platform: "win32" })).rejects.toThrow("no Kiwi upgrade");
  expect(f.urls).toHaveLength(0);
});

test("allows a standalone custom install under a resources folder", async () => {
  const f = fixture();
  const executable = join(f.dir, "resources", "kiwi");
  mkdirSync(dirname(executable));
  writeFileSync(executable, f.old, { mode: 0o755 });
  await upgrade({ ...f.options, executable });
  expect(readFileSync(executable, "utf8")).toBe(f.body);
});

test("names the install folder and a remedy when it is not writable", async () => {
  const f = fixture();
  chmodSync(f.dir, 0o555);
  try {
    await expect(upgrade(f.options)).rejects.toThrow("reinstall in a writable directory");
    expect(readFileSync(f.executable, "utf8")).toBe(f.old);
  } finally {
    chmodSync(f.dir, 0o755);
  }
});

test("rejects unsupported options instead of silently ignoring them", async () => {
  const child = Bun.spawn([process.execPath, "src/cli/main.ts", "upgrade", "--quiet"], { stdout: "pipe", stderr: "pipe" });
  expect(await child.exited).toBe(1);
  expect(await new Response(child.stderr).text()).toContain("does not accept --quiet");
});

test("keeps a binary replaced by another updater during download", async () => {
  const f = fixture();
  const request = async (url: string, init: RequestInit): Promise<Response> => {
    const response = await f.options.request(url, init);
    if (url.endsWith(".gz")) writeFileSync(f.executable, "newer install");
    return response;
  };
  await expect(upgrade({ ...f.options, request })).rejects.toThrow("changed during the upgrade");
  expect(readFileSync(f.executable, "utf8")).toBe("newer install");
});

test.each(["upgrade", "update"])("%s routes without needing a configured identity", async (command) => {
  const f = fixture();
  const child = Bun.spawn([process.execPath, "src/cli/main.ts", command], { env: { ...process.env, KIWI_HOME: f.dir }, stdout: "pipe", stderr: "pipe" });
  expect(await child.exited).toBe(1);
  expect(await new Response(child.stderr).text()).toContain("runs from source");
});

test("takes the smaller .xz when the release lists it and it unpacks here", async () => {
  const f = fixture({ xz: XZ_BODY, unpacker: CAT });
  await upgrade(f.options);
  expect(readFileSync(f.executable, "utf8")).toBe(XZ_BODY);
  expect(f.urls.filter((u) => /\.(gz|xz)$/.test(u))).toEqual(["https://github.com/kiwi-init/channels/releases/download/v2026.10.4/kiwi-linux-x64.xz"]);
  expect(readdirSync(f.dir)).toEqual(["kiwi"]);
  expect(f.messages.join("\n")).not.toContain(".gz");
});

test("falls back to the .gz, in one line, when the .xz won't unpack here", async () => {
  const f = fixture({ xz: XZ_BODY, unpacker: brokenXz() });
  await upgrade(f.options);
  expect(readFileSync(f.executable, "utf8")).toBe(f.body);
  expect(f.urls.filter((u) => /\.(gz|xz)$/.test(u)).map((u) => u.slice(u.lastIndexOf(".")))).toEqual([".xz", ".gz"]);
  expect(f.messages.filter((m) => m.includes("taking the .gz instead"))).toEqual(["Couldn't unpack kiwi-linux-x64.xz here (xz 5.4 or newer can); taking the .gz instead."]);
  expect(readdirSync(f.dir).sort()).toEqual(["cleaned", "kiwi"]);
});

test.each([
  { why: "the release lists no .xz", settings: { unpacker: CAT } },
  { why: "nothing here unpacks .xz", settings: { xz: XZ_BODY, unpacker: null } },
])("takes the .gz when $why", async ({ settings }) => {
  const f = fixture(settings);
  await upgrade(f.options);
  expect(readFileSync(f.executable, "utf8")).toBe(f.body);
  expect(f.urls.some((u) => u.endsWith(".xz"))).toBe(false);
  expect(f.messages.join("\n")).not.toContain("taking the .gz instead");
});

test("refuses a .xz whose checksum doesn't match instead of falling back", async () => {
  const f = fixture({ xz: XZ_BODY, xzChecksum: sha("something else"), unpacker: CAT });
  await expect(upgrade(f.options)).rejects.toThrow("download checksum does not match");
  expect(readFileSync(f.executable, "utf8")).toBe(f.old);
  expect(f.urls.some((u) => u.endsWith(".gz"))).toBe(false);
  expect(readdirSync(f.dir)).toEqual(["kiwi"]);
});

test("keeps the old binary when the .xz won't unpack and the release has no .gz", async () => {
  const f = fixture({ xz: XZ_BODY, noGz: true, unpacker: brokenXz() });
  await expect(upgrade(f.options)).rejects.toThrow("no .gz to fall back on");
  expect(readFileSync(f.executable, "utf8")).toBe(f.old);
  expect(readdirSync(f.dir)).toEqual(["kiwi"]);
});

test.skipIf(!Bun.which("xz"))("unpacks a real .xz with the xz found on PATH", async () => {
  const packed = Bun.spawnSync(["xz", "-c", "--x86", "--lzma2"], { stdin: Buffer.from(XZ_BODY) });
  expect(packed.exitCode).toBe(0);
  const f = fixture({ xz: packed.stdout });
  await upgrade(f.options);
  expect(readFileSync(f.executable, "utf8")).toBe(XZ_BODY);
  expect(f.urls.some((u) => u.endsWith(".gz"))).toBe(false);
});
