import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { bundleProblems } from "./eb-bundle.ts";
import { sealApp } from "./eb-seal.ts";

const buildDir = process.env.ELECTROBUN_BUILD_DIR;
const os = process.env.ELECTROBUN_OS;
const arch = process.env.ELECTROBUN_ARCH;
if (!buildDir || !os || !arch) throw new Error("run by electrobun build: ELECTROBUN_BUILD_DIR, _OS and _ARCH are unset");
if (os !== "macos" && os !== "linux") throw new Error(`the Electrobun shell builds only on macOS and Linux, not ${os}`);

const desktop = path.resolve(import.meta.dirname, "..");
const web = path.resolve(desktop, "../web/dist");
if (!fs.existsSync(path.join(web, "index.html"))) throw new Error("web/dist/index.html is missing: run `bun run web:build` in the repo root first");

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
const views = path.join(resources[0] as string, "app", "views", "internal");
fs.rmSync(views, { recursive: true, force: true });
fs.cpSync(web, views, { recursive: true, filter: (src) => path.basename(src) !== "_headers" });
if (os === "linux") process.exit(0);
const contents = path.dirname(resources[0] as string);

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
const problems = bundleProblems(fs.readFileSync(path.join(app, "bun", "index.js"), "utf8"), fs.readFileSync(path.join(app, "views", "preload", "index.js"), "utf8"));
if (problems.length) throw new Error(`eb-post-build: ${problems.join("; ")}`);
console.log(`eb-post-build: ${sealApp(path.dirname(contents))} files sealed in Info.plist`);
