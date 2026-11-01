import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DEFAULT_RELAY } from "@kiwi/core/relay-url.ts";
import { JOIN_SCHEME } from "../src/deep-links.ts";
import { PAGE_TEMPLATE, pageWithCsp } from "../src/eb-page.ts";
import type { FromWorker, ToWorker } from "../src/keys-shim.ts";
import { bundleProblems, keyChannelProblems, shortVersion, testBuildProblems, urlSchemeProblems, versionProblems } from "./eb-bundle.ts";
import { hostKey, mismatches, pinFor, PINS } from "./eb-pins.ts";
import { sealApp } from "./eb-seal.ts";
import { ELECTROBUN_LAUNCHER } from "./linux-files.ts";

const buildDir = process.env.ELECTROBUN_BUILD_DIR;
const os = process.env.ELECTROBUN_OS;
const arch = process.env.ELECTROBUN_ARCH;
if (!buildDir || !os || !arch) throw new Error("run by electrobun build: ELECTROBUN_BUILD_DIR, _OS and _ARCH are unset");
if (os !== "macos" && os !== "linux") throw new Error(`the Electrobun shell builds only on macOS and Linux, not ${os}`);

const desktop = path.resolve(import.meta.dirname, "..");
const web = path.resolve(desktop, process.env.KIWI_UI_DIST ?? "../ui/dist");
if (!fs.existsSync(path.join(web, "index.html"))) throw new Error(`${web}/index.html is missing: run \`bun run ui:build\` in the repo root first`);
const index = fs.readFileSync(path.join(web, "index.html"), "utf8");
pageWithCsp(index, DEFAULT_RELAY);

function resourcesOf(dir: string, depth: number): string[] {
  if (depth < 0) return [];
  const here = path.join(dir, "Resources");
  if (fs.existsSync(path.join(here, "app"))) return [here];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => resourcesOf(path.join(dir, d.name), depth - 1));
}

const resources = resourcesOf(buildDir, 3);
if (resources.length !== 1) throw new Error(`expected one app bundle (Resources/app) under ${buildDir}, found ${resources.length}`);
const app = path.join(resources[0] as string, "app");
const template = path.join(app, PAGE_TEMPLATE);
fs.mkdirSync(path.dirname(template), { recursive: true });
fs.writeFileSync(template, index);
const views = path.join(app, "views", "internal");
fs.rmSync(views, { recursive: true, force: true });
fs.cpSync(web, views, { recursive: true, filter: (src) => src !== path.join(web, "index.html") && path.basename(src) !== "_headers" });
if (fs.readdirSync(views).some((n) => n.toLowerCase() === "index.html")) throw new Error("eb-post-build: index.html must not be under views/, where Electrobun would serve it without the CSP");
const cli = path.resolve(desktop, "../dist/kiwi.js");
if (!fs.existsSync(cli)) throw new Error("dist/kiwi.js is missing: run `bun scripts/build-cli.ts --js dist/kiwi.js` in the repo root first");
fs.copyFileSync(cli, path.join(resources[0] as string, "kiwi.js"));
const tmux = path.resolve(desktop, "../dist/tmux");
if (fs.existsSync(tmux)) {
  fs.copyFileSync(tmux, path.join(resources[0] as string, "tmux"));
  fs.chmodSync(path.join(resources[0] as string, "tmux"), 0o755);
} else if (process.env.CHANNELS_EB_RELEASE === "1") throw new Error("dist/tmux is missing: run `bash scripts/build-tmux.sh dist/tmux` in the repo root first");
else console.log("eb-post-build: no dist/tmux, so this build's agents use the computer's own tmux (bash scripts/build-tmux.sh dist/tmux makes one)");
const keysWorker = await Bun.build({ entrypoints: [path.join(desktop, "src", "keys-worker.ts")], target: "bun" });
const keysOut = keysWorker.outputs[0];
if (!keysWorker.success || !keysOut) throw new Error(`the keys worker didn't bundle: ${keysWorker.logs.join("\n")}`);
fs.writeFileSync(path.join(app, "bun", "keys.js"), await keysOut.text());
const searchWorker = await Bun.build({ entrypoints: [path.join(desktop, "src", "search-worker.ts")], target: "bun" });
const searchOut = searchWorker.outputs[0];
if (!searchWorker.success || !searchOut) throw new Error(`the search worker didn't bundle: ${searchWorker.logs.join("\n")}`);
fs.writeFileSync(path.join(app, "bun", "search.js"), await searchOut.text());
const boxWorker = await Bun.build({ entrypoints: [path.join(desktop, "src", "message-box-worker.ts")], target: "bun" });
const boxOut = boxWorker.outputs[0];
if (!boxWorker.success || !boxOut) throw new Error(`the message box worker didn't bundle: ${boxWorker.logs.join("\n")}`);
fs.writeFileSync(path.join(app, "bun", "message-box.js"), await boxOut.text());
const answered = await bundledKeysAnswer(path.join(app, "bun", "keys.js"));
if (answered !== "ok") throw new Error(`the bundled keys worker didn't answer a page's request: ${answered}`);
if (os === "linux") {
  const host = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : process.arch;
  if (host !== arch) throw new Error(`eb-post-build: the Linux launcher is built with this machine's cc, for ${host}, not the ${arch} app`);
  const bin = path.join(path.dirname(resources[0] as string), "bin");
  const theirs = path.join(bin, "launcher");
  if (!fs.existsSync(theirs)) throw new Error(`eb-post-build: no Electrobun launcher at ${theirs}`);
  fs.renameSync(theirs, path.join(bin, ELECTROBUN_LAUNCHER));
  execFileSync("cc", ["-O2", "-Wall", "-Wextra", "-Werror", "-o", theirs, path.join(desktop, "native", "linux", "kiwi-launcher.c")], { stdio: "inherit" });
  console.log(`eb-post-build: bin/launcher keeps the app's environment to an allowlist, then starts Electrobun's (bin/${ELECTROBUN_LAUNCHER})`);
  const wrapper = path.join(bin, "libNativeWrapper.so");
  if (!fs.existsSync(wrapper)) throw new Error(`eb-post-build: no Electrobun native wrapper at ${wrapper}`);
  const linked = execFileSync("readelf", ["-d", wrapper], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line.includes("(NEEDED)") && line.includes("appindicator"));
  if (linked.length) throw new Error(`eb-post-build: Livewire ${PINS.electrobun}'s libNativeWrapper.so links AppIndicator, so the app won't start where it isn't installed: ${linked.join("; ")}`);
  console.log(`eb-post-build: bin/libNativeWrapper.so is Livewire ${PINS.electrobun}'s own (native Wayland, AppIndicator loaded at run time)`);
  const webkit = execFileSync("pkg-config", ["--cflags", "--libs", "webkit2gtk-4.1"], { encoding: "utf8" }).trim().split(/\s+/);
  execFileSync("cc", ["-shared", "-fPIC", "-O2", "-Wall", "-Wextra", "-Werror", "-o", path.join(bin, "libkiwi-shell.so"), path.join(desktop, "native", "linux", "kiwi-shell.c"), ...webkit], {
    stdio: "inherit",
  });
  process.exit(0);
}
const contents = path.dirname(resources[0] as string);

const key = hostKey("darwin", arch === "x64" ? "x64" : "arm64");
const bundle = path.dirname(contents);
const pinned = pinFor(PINS.app, key, "app files");
const bad = mismatches(bundle, pinned);
if (bad.length) throw new Error(`eb-post-build: Electrobun's files in the app don't match their pins: ${bad.join("; ")}`);
const OURS = new Set(["libkiwi-shell.dylib", "kiwi-launcher"]);
const extra = fs.readdirSync(path.join(contents, "MacOS")).filter((f) => !OURS.has(f) && !Object.hasOwn(pinned, `Contents/MacOS/${f}`));
if (extra.length) throw new Error(`eb-post-build: Contents/MacOS holds files nobody pinned: ${extra.join(", ")}`);

execFileSync(
  "clang",
  [
    "-dynamiclib",
    "-fobjc-arc",
    "-O2",
    "-Wall",
    "-Werror",
    "-Wno-unused-parameter",
    "-arch",
    arch === "x64" ? "x86_64" : "arm64",
    "-mmacosx-version-min=12.0",
    "-framework",
    "AppKit",
    "-framework",
    "WebKit",
    "-framework",
    "UserNotifications",
    "-framework",
    "ImageIO",
    "-o",
    path.join(contents, "MacOS", "libkiwi-shell.dylib"),
    path.join(desktop, "native", "macos", "kiwi-shell.m"),
  ],
  { stdio: "inherit" },
);

execFileSync(
  "clang",
  [
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-arch",
    arch === "x64" ? "x86_64" : "arm64",
    "-mmacosx-version-min=12.0",
    "-framework",
    "CoreFoundation",
    "-framework",
    "Security",
    ...(process.env.CHANNELS_EB_TEST === "1" ? ["-DKIWI_EB_TEST"] : []),
    "-o",
    path.join(contents, "MacOS", "kiwi-launcher"),
    path.join(desktop, "native", "macos", "kiwi-launcher.c"),
    path.join(desktop, "native", "macos", "kiwi-keys.c"),
  ],
  { stdio: "inherit" },
);
execFileSync("plutil", ["-replace", "CFBundleExecutable", "-string", "kiwi-launcher", path.join(contents, "Info.plist")]);
const bundleVersion = execFileSync("plutil", ["-extract", "CFBundleVersion", "raw", path.join(contents, "Info.plist")], { encoding: "utf8" }).trim();
execFileSync("plutil", ["-replace", "CFBundleShortVersionString", "-string", shortVersion(bundleVersion), path.join(contents, "Info.plist")]);

const bundleId = execFileSync("plutil", ["-extract", "CFBundleIdentifier", "raw", path.join(contents, "Info.plist")], { encoding: "utf8" }).trim();
if (!bundleId) throw new Error("eb-post-build: the app's Info.plist names no CFBundleIdentifier, so its kiwi:// registration can't be checked");
const problems = [
  ...bundleProblems(fs.readFileSync(path.join(app, "bun", "index.js"), "utf8"), fs.readFileSync(path.join(app, "views", "preload", "index.js"), "utf8")),
  ...urlSchemeProblems(fs.readFileSync(path.join(contents, "Info.plist"), "utf8"), bundleId, JOIN_SCHEME),
  ...versionProblems(fs.readFileSync(path.join(contents, "Info.plist"), "utf8")),
  ...testBuildProblems(process.env.CHANNELS_EB_TEST === "1", bundleId, fs.readFileSync(path.join(contents, "Resources", "version.json"), "utf8")),
  ...keyChannelProblems(fs.readFileSync(path.join(app, "bun", "index.js"), "utf8")),
];
if (problems.length) throw new Error(`eb-post-build: ${problems.join("; ")}`);
if (fs.readdirSync(views).some((n) => n.toLowerCase() === "index.html"))
  throw new Error("eb-post-build: index.html is under views/ again by the seal, where Electrobun would serve it without the CSP");
console.log(`eb-post-build: ${sealApp(path.dirname(contents))} files sealed in Info.plist`);

async function bundledKeysAnswer(file: string): Promise<string> {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "kiwi-keys-bundle-"));
  const worker = new Worker(file);
  try {
    return await new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve("no answer in 5 s"), 5_000);
      worker.addEventListener("message", (e: MessageEvent<FromWorker>) => {
        if (e.data.from !== "port") return;
        clearTimeout(timer);
        const d = e.data.data;
        resolve("id" in d && d.id === 1 && d.ok ? "ok" : JSON.stringify(d));
      });
      worker.addEventListener("error", (e) => resolve(`it threw: ${e.message}`));
      const send = (m: ToWorker) => worker.postMessage(m);
      send({ to: "host", m: { type: "init", relay: "https://relay.invalid", dir, seats: [], person: null, mine: [] } });
      send({ to: "host", m: { type: "port" }, port: 1 });
      send({ to: "port", port: 1, data: { id: 1, op: "nudge" } });
    });
  } finally {
    worker.terminate();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
