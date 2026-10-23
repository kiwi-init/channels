import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { DEFAULT_RELAY } from "@kiwi/core/relay-url.ts";
import { PAGE_TEMPLATE, pageWithCsp } from "../src/eb-page.ts";
import { hostKey, mismatches, pinFor, PINS } from "./eb-pins.ts";

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
const index = fs.readFileSync(path.join(web, "index.html"), "utf8");
pageWithCsp(index, DEFAULT_RELAY);
const app = path.join(contents, "Resources", "app");
const template = path.join(app, PAGE_TEMPLATE);
fs.mkdirSync(path.dirname(template), { recursive: true });
fs.writeFileSync(template, index);
const views = path.join(app, "views", "internal");
fs.rmSync(views, { recursive: true, force: true });
const skip = new Set([path.join(web, "index.html"), path.join(web, "_headers")]);
fs.cpSync(web, views, { recursive: true, filter: (src) => !skip.has(src) });
if (fs.existsSync(path.join(views, "index.html"))) throw new Error("eb-post-build: index.html must not be under views/, where Electrobun would serve it without the CSP");

const key = hostKey("darwin", arch === "x64" ? "x64" : "arm64");
const bundle = path.dirname(contents);
const pinned = pinFor(PINS.app, key, "app files");
const bad = mismatches(bundle, pinned);
if (bad.length) throw new Error(`eb-post-build: Electrobun's files in the app don't match their pins: ${bad.join("; ")}`);
const OURS = new Set(["libkiwi-shell.dylib"]);
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
    "-o",
    path.join(contents, "MacOS", "libkiwi-shell.dylib"),
    path.join(desktop, "native", "macos", "kiwi-shell.m"),
  ],
  { stdio: "inherit" },
);
