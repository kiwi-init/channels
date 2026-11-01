import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { compareVersions } from "@kiwi/core/versions.ts";
import { minisignVerifies } from "./minisign.ts";
import { RELEASE_KEY } from "./release-key.ts";

const RELEASES = "https://github.com/kiwi-init/channels/releases";

type UpgradeOptions = {
  executable: string;
  source: boolean;
  version: string;
  platform: string;
  arch: string;
  releaseKey?: string;
  request?: (url: string, init: RequestInit) => Promise<Response>;
  report?: (message: string) => void;
};

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 15_000 }, (error, stdout) => (error ? reject(error) : resolve(stdout.trim())));
  });
}

export async function upgrade(options: UpgradeOptions): Promise<void> {
  if (options.source) throw new Error("this Kiwi runs from source; update your checkout and rebuild with bun run install:local");
  const executable = await realpath(options.executable);
  if (/[\\/]Cellar[\\/]kiwi[\\/]/.test(executable)) throw new Error("this Kiwi is managed by Homebrew; run brew upgrade kiwi");
  if (/\.app[\\/]Contents[\\/]/.test(executable)) throw new Error("this Kiwi belongs to the desktop app; update Channels instead");
  if (!["linux", "darwin"].includes(options.platform) || !["x64", "arm64"].includes(options.arch)) {
    throw new Error(`no Kiwi upgrade for ${options.platform}-${options.arch}`);
  }
  const report = options.report ?? (() => {});
  const request = options.request ?? fetch;
  const get = (url: string, redirect: RequestInit["redirect"] = "follow"): Promise<Response> =>
    request(url, { redirect, signal: AbortSignal.timeout(120_000), headers: { "user-agent": "kiwi-upgrade" } });
  report(`Checking for updates (installed: ${options.version})…`);
  const latest = await get(`${RELEASES}/latest`, "manual");
  const location = latest.headers.get("location") ?? "";
  const tag = location.startsWith(`${RELEASES}/tag/`) ? location.slice(`${RELEASES}/tag/`.length) : "";
  if (latest.status < 300 || latest.status >= 400 || !/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error("GitHub did not return a stable Kiwi release; try again later");
  const version = tag.slice(1);
  if (compareVersions(options.version, version) >= 0) {
    report(`Kiwi ${options.version} is already up to date (latest stable: ${version}).`);
    return;
  }
  const before = await stat(executable);
  let stage: string | null = null;
  try {
    const base = `${RELEASES}/download/${tag}`;
    const name = `kiwi-${options.platform}-${options.arch}.gz`;
    const sums = await get(`${base}/SHA256SUMS`);
    if (!sums.ok) throw new Error(`could not download SHA256SUMS (HTTP ${sums.status})`);
    const sumsBody = Buffer.from(await sums.arrayBuffer());
    const sig = await get(`${base}/SHA256SUMS.minisig`);
    if (!sig.ok) throw new Error(`the release carries no SHA256SUMS.minisig (HTTP ${sig.status}); your installed Kiwi was kept`);
    if (!minisignVerifies(sumsBody, await sig.text(), options.releaseKey ?? RELEASE_KEY)) {
      throw new Error("the release's signature doesn't match the key this Kiwi pins; your installed Kiwi was kept");
    }
    const entries = sumsBody
      .toString("utf8")
      .split("\n")
      .map((line) => line.trim().split(/\s+/));
    const matches = entries.filter((entry) => entry[1] === name);
    const expected = matches.length === 1 ? matches[0]?.[0] : undefined;
    if (!expected || !/^[a-f0-9]{64}$/i.test(expected)) throw new Error(`SHA256SUMS does not contain one valid checksum for ${name}`);
    report(`Downloading Kiwi ${version}…`);
    const response = await get(`${base}/${name}`);
    if (!response.ok) throw new Error(`could not download ${name} (HTTP ${response.status})`);
    const packed = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(packed).digest("hex") !== expected.toLowerCase()) throw new Error("download checksum does not match; your installed Kiwi was kept");
    stage = await mkdtemp(join(dirname(executable), `.kiwi-upgrade-${process.pid}-`));
    const candidate = join(stage, "kiwi");
    await writeFile(candidate, gunzipSync(packed, { maxOutputLength: 256 * 1024 * 1024 }), { mode: 0o700 });
    if ((await run(candidate, ["--version"])) !== version) throw new Error("downloaded Kiwi did not report the expected version; your installed Kiwi was kept");
    await chmod(candidate, before.mode & 0o777);
    const current = await stat(executable);
    if (current.ino !== before.ino || current.mtimeMs !== before.mtimeMs || current.size !== before.size) throw new Error("Kiwi changed during the upgrade; run kiwi upgrade again");
    await rename(candidate, executable);
    report(`Upgraded Kiwi ${options.version} → ${version} at ${executable}.`);
    try {
      const cleaned = await run(executable, ["cleanup", "--quiet"]);
      if (cleaned) report(cleaned);
    } catch {
      // The binary is installed; cleanup failure must not misreport the upgrade as failed.
      report("Kiwi was upgraded, but cleanup did not finish; run kiwi cleanup.");
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && typeof error.code === "string" && ["EACCES", "EPERM", "EROFS"].includes(error.code)) {
      throw new Error(`cannot update Kiwi in ${dirname(executable)}; run as that folder's owner or reinstall in a writable directory`, { cause: error });
    }
    throw error;
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true });
  }
}
