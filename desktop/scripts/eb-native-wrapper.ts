import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { type ArchiveTreePin, PINS, treeSha256 } from "./eb-pins.ts";

const PATCHES = ["electrobun-wayland.patch", "electrobun-titlebar.patch", "electrobun-tray.patch"].map((name) => path.resolve(import.meta.dirname, "..", "native", "linux", name));
const CACHE = path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "kiwi-eb-native");
const GTK = ["webkit2gtk-4.1", "gtk+-3.0"];
const INDICATOR = "ayatana-appindicator3-0.1";
const SOURCES = ["nativeWrapper", "wayland_screen_capture", "wayland_pipewire_capture"];

function pinnedTree(name: string, pin: ArchiveTreePin): string {
  const dir = path.join(CACHE, `${name}-${pin.tree}`, path.basename(pin.keep));
  if (fs.existsSync(dir) && treeSha256(dir) === pin.tree) {
    console.log(`eb-native-wrapper: ${name} from the cache, ${dir}`);
    return dir;
  }
  fs.mkdirSync(CACHE, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(CACHE, `.${name}-`));
  try {
    const started = Date.now();
    const archive = path.join(tmp, "archive");
    execFileSync("curl", ["-fsSL", "--retry", "3", "--retry-all-errors", "--connect-timeout", "30", "--speed-limit", "100000", "--speed-time", "60", "-o", archive, pin.url], { stdio: "inherit" });
    execFileSync("tar", ["-xf", archive, "-C", tmp, pin.keep], { stdio: "inherit" });
    const got = treeSha256(path.join(tmp, pin.keep));
    if (got !== pin.tree) throw new Error(`eb-native-wrapper: ${pin.keep} in ${pin.url} hashes to ${got}, pinned ${pin.tree}`);
    console.log(
      `eb-native-wrapper: ${name}, ${Math.round(fs.statSync(archive).size / 1024 ** 2)} MB from ${pin.url} in ${Math.round((Date.now() - started) / 1000)} s, its ${pin.keep} matching the pin`,
    );
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

const needed = (lib: string): string[] =>
  execFileSync("readelf", ["-d", lib], { encoding: "utf8" })
    .split("\n")
    .map((l) => /\(NEEDED\)\s+Shared library: \[([^\]]+)\]/.exec(l)?.[1])
    .filter((n): n is string => n !== undefined);

export function buildNativeWrapper(wrapper: string, asar: string): void {
  const pins = PINS.nativeWrapper;
  const source = pinnedTree("source", pins.source);
  const cef = pinnedTree("cef", pins.cef);
  const dawn = pinnedTree("dawn", pins.dawn);
  const theirs = exported(wrapper);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-eb-native-"));
  try {
    const native = path.join(work, "package", "src", "native");
    fs.cpSync(source, native, { recursive: true });
    for (const patch of PATCHES) execFileSync("patch", ["-p1", "--forward", "--batch", "--fuzz=0", "-d", work, "-i", patch], { stdio: "inherit" });
    const flags = [
      "-std=c++20",
      "-fPIC",
      ...pkgConfig("--cflags", [...GTK, INDICATOR]),
      ...pkgConfig("--cflags", ["libpipewire-0.3"]),
      `-I${path.dirname(cef)}`,
      `-I${dawn}`,
      "-DELECTROBUN_ENABLE_WAYLAND_SCREEN_CAPTURE",
    ];
    const objects = SOURCES.map((name) => {
      const started = Date.now();
      const object = path.join(work, `${name}.o`);
      execFileSync("g++", ["-c", ...flags, "-o", object, path.join(native, "linux", `${name}.cpp`)], { stdio: "inherit" });
      console.log(`eb-native-wrapper: compiled ${name}.cpp in ${Math.round((Date.now() - started) / 1000)} s`);
      return object;
    });
    const built = path.join(work, "libNativeWrapper.so");
    execFileSync("g++", ["-shared", "-o", built, ...objects, asar, ...pkgConfig("--libs", GTK), "-ldl", "-lpthread"], { stdio: "inherit" });
    const linked = needed(built).filter((n) => /appindicator/.test(n));
    if (linked.length) throw new Error(`eb-native-wrapper: the patched libNativeWrapper.so links ${linked.join(", ")}, so it won't start where AppIndicator isn't installed`);
    const ours = new Set(exported(built));
    const lost = theirs.filter((s) => !ours.has(s));
    if (lost.length) throw new Error(`eb-native-wrapper: the patched libNativeWrapper.so doesn't export ${lost.length} of Electrobun's functions: ${lost.slice(0, 10).join(", ")}`);
    fs.copyFileSync(built, wrapper);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
