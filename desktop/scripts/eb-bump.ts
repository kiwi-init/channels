import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { PINS, sha256, treeSha256, type Pins } from "./eb-pins.ts";

const REPO = "kiwi-init/electrobun-livewire";
const PINS_FILE = path.join(import.meta.dir, "..", "electrobun-pins.json");
const RENAMED: Record<string, string> = { uninstall: "extractor" };

export interface Release {
  version: string;
  url: string;
}

export const coreUrl = (base: string, version: string, key: string): string => `${base}/v${version}/electrobun-core-${key.replace(/^macos-/, "darwin-")}.tar.gz`;

export function coreName(pinned: string): string {
  const name = path.posix.basename(pinned);
  return RENAMED[name] ?? name;
}

export function bumped(pins: Pins, version: string, devkit: Record<string, string>, cores: Record<string, ReadonlyMap<string, string>>): Pins {
  const app = Object.fromEntries(
    Object.entries(pins.app).map(([key, files]) => {
      const core = cores[key];
      if (!core) throw new Error(`no core for ${key}, which pins app files`);
      return [key, Object.fromEntries(Object.entries(files).map(([rel, was]) => [rel, core.get(coreName(rel)) ?? was]))];
    }),
  );
  const devkits = Object.fromEntries(
    Object.keys(pins.devkit).map((key) => {
      const got = devkit[key];
      if (!got) throw new Error(`no devkit for ${key}`);
      return [key, got];
    }),
  );
  return { ...pins, electrobun: version, devkit: devkits, app };
}

export function changes(before: Pins, after: Pins): string[] {
  const out: string[] = [];
  for (const [key, files] of Object.entries(after.app)) for (const [rel, sha] of Object.entries(files)) if (before.app[key]?.[rel] !== sha) out.push(`${key} ${rel}`);
  for (const [key, sha] of Object.entries(after.devkit)) if (before.devkit[key] !== sha) out.push(`${key} devkit`);
  return out;
}

async function latest(): Promise<Release> {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${REPO}'s latest release answered ${res.status}`);
  const r: unknown = await res.json();
  if (typeof r !== "object" || r === null || !("tag_name" in r) || typeof r.tag_name !== "string" || !("html_url" in r) || typeof r.html_url !== "string")
    throw new Error(`${REPO}'s latest release has no tag`);
  if ("prerelease" in r && r.prerelease === true) throw new Error(`${REPO}'s latest release ${r.tag_name} is a pre-release`);
  return { version: r.tag_name.replace(/^v/, ""), url: r.html_url };
}

async function unpack(url: string, into: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  fs.mkdirSync(into, { recursive: true });
  const archive = path.join(into, "core.tar.gz");
  fs.writeFileSync(archive, new Uint8Array(await res.arrayBuffer()));
  const tar = spawnSync("tar", ["-xzf", archive, "-C", into], { stdio: "inherit" });
  if (tar.status !== 0) throw new Error(`couldn't unpack ${url}`);
  fs.rmSync(archive);
}

function topFiles(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    if (fs.lstatSync(file).isFile()) out.set(name, sha256(fs.readFileSync(file)));
  }
  return out;
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
}

function output(values: Record<string, string>): void {
  const file = process.env.GITHUB_OUTPUT;
  const lines = Object.entries(values).map(([k, v]) => (v.includes("\n") ? `${k}<<EOF\n${v}\nEOF` : `${k}=${v}`));
  if (file) fs.appendFileSync(file, `${lines.join("\n")}\n`);
  else console.log(lines.join("\n"));
}

if (import.meta.main) {
  const wanted = flag("--version")?.replace(/^v/, "");
  const release: Release = wanted ? { version: wanted, url: `https://github.com/${REPO}/releases/tag/v${wanted}` } : await latest();
  const force = process.argv.includes("--force");
  if (release.version === PINS.electrobun && !force) {
    console.log(`Channels already builds on Livewire ${release.version}`);
    output({ changed: "false", version: release.version });
  } else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "eb-bump-"));
    try {
      const keys = [...new Set([...Object.keys(PINS.devkit), ...Object.keys(PINS.app)])];
      await Promise.all(keys.map((key) => unpack(coreUrl(PINS.releasesBaseUrl, release.version, key), path.join(tmp, key))));
      const devkit = Object.fromEntries(Object.keys(PINS.devkit).map((key) => [key, treeSha256(path.join(tmp, key, "api"))]));
      const cores = Object.fromEntries(Object.keys(PINS.app).map((key) => [key, topFiles(path.join(tmp, key))]));
      const next = bumped(PINS, release.version, devkit, cores);
      const moved = changes(PINS, next);
      fs.writeFileSync(PINS_FILE, `${JSON.stringify(next, null, 2)}\n`);
      const notes = [`Livewire ${release.version}: ${release.url}`, "", moved.length ? `Pins that moved: ${moved.join(", ")}.` : "No pinned file changed."].join("\n");
      console.log(notes);
      output({ changed: String(release.version !== PINS.electrobun || moved.length > 0), version: release.version, url: release.url, notes });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
}
