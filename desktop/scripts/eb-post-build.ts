import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { FromWorker, ToWorker } from "../src/keys-shim.ts";
import { bundleProblems } from "./eb-bundle.ts";
import { sealApp } from "./eb-seal.ts";

const buildDir = process.env.ELECTROBUN_BUILD_DIR;
const os = process.env.ELECTROBUN_OS;
const arch = process.env.ELECTROBUN_ARCH;
if (!buildDir || !os || !arch) throw new Error("run by electrobun build: ELECTROBUN_BUILD_DIR, _OS and _ARCH are unset");
if (os !== "macos") throw new Error(`the Electrobun shell builds only on macOS for now, not ${os}`);

const apps = fs.readdirSync(buildDir).filter((f) => f.endsWith(".app"));
if (apps.length !== 1) throw new Error(`expected one .app in ${buildDir}, found ${apps.length}`);
const contents = path.join(buildDir, apps[0] as string, "Contents");

const desktop = path.resolve(import.meta.dirname, "..");
const web = path.resolve(desktop, "../web/dist");
if (!fs.existsSync(path.join(web, "index.html"))) throw new Error("web/dist/index.html is missing: run `bun run web:build` in the repo root first");
const views = path.join(contents, "Resources", "app", "views", "internal");
fs.rmSync(views, { recursive: true, force: true });
fs.cpSync(web, views, { recursive: true, filter: (src) => path.basename(src) !== "_headers" });

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
    "-o",
    path.join(contents, "MacOS", "kiwi-launcher"),
    path.join(desktop, "native", "macos", "kiwi-launcher.c"),
    path.join(desktop, "native", "macos", "kiwi-keys.c"),
  ],
  { stdio: "inherit" },
);
execFileSync("plutil", ["-replace", "CFBundleExecutable", "-string", "kiwi-launcher", path.join(contents, "Info.plist")]);

const app = path.join(contents, "Resources", "app");
const keysWorker = await Bun.build({ entrypoints: [path.join(desktop, "src", "keys-worker.ts")], target: "bun" });
const keysOut = keysWorker.outputs[0];
if (!keysWorker.success || !keysOut) throw new Error(`the keys worker didn't bundle: ${keysWorker.logs.join("\n")}`);
fs.writeFileSync(path.join(app, "bun", "keys.js"), await keysOut.text());
const answered = await bundledKeysAnswer(path.join(app, "bun", "keys.js"));
if (answered !== "ok") throw new Error(`the bundled keys worker didn't answer a page's request: ${answered}`);
const problems = bundleProblems(fs.readFileSync(path.join(app, "bun", "index.js"), "utf8"), fs.readFileSync(path.join(app, "views", "preload", "index.js"), "utf8"));
if (problems.length) throw new Error(`eb-post-build: ${problems.join("; ")}`);
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
      send({ to: "host", m: { type: "init", relay: "https://relay.invalid", dir, seats: [], person: null } });
      send({ to: "host", m: { type: "port" }, port: 1 });
      send({ to: "port", port: 1, data: { id: 1, op: "nudge" } });
    });
  } finally {
    worker.terminate();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
