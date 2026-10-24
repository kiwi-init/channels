import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { type ArchiveTreePin, PINS, treeSha256 } from "./eb-pins.ts";

const WAYLAND_PATCH = path.resolve(import.meta.dirname, "..", "native", "linux", "electrobun-wayland.patch");
const CACHE = path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "kiwi-eb-native");
const GTK = ["webkit2gtk-4.1", "gtk+-3.0", "ayatana-appindicator3-0.1"];
const SOURCES = ["nativeWrapper", "wayland_screen_capture", "wayland_pipewire_capture"];

async function pinnedTree(name: string, pin: ArchiveTreePin): Promise<string> {
  const dir = path.join(CACHE, `${name}-${pin.tree}`, path.basename(pin.keep));
  if (fs.existsSync(dir) && treeSha256(dir) === pin.tree) return dir;
  fs.mkdirSync(CACHE, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(CACHE, `.${name}-`));
  try {
    const res = await fetch(pin.url, { signal: AbortSignal.timeout(600_000) });
    if (!res.ok) throw new Error(`eb-native-wrapper: ${pin.url} answered ${res.status}`);
    const archive = path.join(tmp, "archive");
    await Bun.write(archive, res);
    execFileSync("tar", ["-xf", archive, "-C", tmp, pin.keep], { stdio: "inherit" });
    const got = treeSha256(path.join(tmp, pin.keep));
    if (got !== pin.tree) throw new Error(`eb-native-wrapper: ${pin.keep} in ${pin.url} hashes to ${got}, pinned ${pin.tree}`);
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.renameSync(path.join(tmp, pin.keep), dir);
    return dir;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const pkgConfig = (what: string, packages: string[]): string[] =>
  execFileSync("pkg-config", [what, ...packages], { encoding: "utf8" })
    .trim()
    .split(/\s+/)
    .filter(Boolean);

const exported = (lib: string): string[] =>
  execFileSync("nm", ["-D", "--defined-only", lib], { encoding: "utf8" })
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .filter((f) => f.length === 3 && f[1] === "T")
    .map((f) => f[2] as string);

export async function buildNativeWrapper(wrapper: string, asar: string): Promise<void> {
  const pins = PINS.nativeWrapper;
  const source = await pinnedTree("source", pins.source);
  const cef = await pinnedTree("cef", pins.cef);
  const dawn = await pinnedTree("dawn", pins.dawn);
  const theirs = exported(wrapper);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-eb-native-"));
  try {
    const native = path.join(work, "package", "src", "native");
    fs.cpSync(source, native, { recursive: true });
    execFileSync("patch", ["-p1", "--forward", "--batch", "--fuzz=0", "-d", work, "-i", WAYLAND_PATCH], { stdio: "inherit" });
    const flags = [
      "-std=c++20",
      "-fPIC",
      ...pkgConfig("--cflags", GTK),
      ...pkgConfig("--cflags", ["libpipewire-0.3"]),
      `-I${path.dirname(cef)}`,
      `-I${dawn}`,
      "-DELECTROBUN_ENABLE_WAYLAND_SCREEN_CAPTURE",
    ];
    const objects = SOURCES.map((name) => {
      const object = path.join(work, `${name}.o`);
      execFileSync("g++", ["-c", ...flags, "-o", object, path.join(native, "linux", `${name}.cpp`)], { stdio: "inherit" });
      return object;
    });
    const built = path.join(work, "libNativeWrapper.so");
    execFileSync("g++", ["-shared", "-o", built, ...objects, asar, ...pkgConfig("--libs", GTK), "-ldl", "-lpthread"], { stdio: "inherit" });
    const ours = new Set(exported(built));
    const lost = theirs.filter((s) => !ours.has(s));
    if (lost.length) throw new Error(`eb-native-wrapper: the patched libNativeWrapper.so doesn't export ${lost.length} of Electrobun's functions: ${lost.slice(0, 10).join(", ")}`);
    fs.copyFileSync(built, wrapper);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
