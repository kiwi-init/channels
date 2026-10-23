import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { bundleProblems } from "./eb-bundle.ts";

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

const app = path.join(contents, "Resources", "app");
const problems = bundleProblems(fs.readFileSync(path.join(app, "bun", "index.js"), "utf8"), fs.readFileSync(path.join(app, "views", "preload", "index.js"), "utf8"));
if (problems.length) throw new Error(`eb-post-build: ${problems.join("; ")}`);
