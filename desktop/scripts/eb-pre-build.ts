import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { fileSha256, hostKey, pinFor, PINS, treeSha256 } from "./eb-pins.ts";

const desktop = path.resolve(import.meta.dirname, "..");
const key = hostKey();

const hutch = process.env.ELECTROBUN_HUTCH_BINARY;
const pinnedHutch = pinFor(PINS.hutch.platforms, key, "Hutch archive").files["bin/hutch"];
if (!hutch || fileSha256(hutch) !== pinnedHutch) throw new Error("eb-pre-build: this build isn't running the pinned Hutch; build through desktop/scripts/eb.ts (bun run build:eb, start:eb)");

const devkit = treeSha256(path.join(desktop, ".hutch", "devkit", "api"));
const pinnedDevkit = pinFor(PINS.devkit, key, "devkit");
if (devkit !== pinnedDevkit) throw new Error(`eb-pre-build: Electrobun's devkit in desktop/.hutch/devkit/api is ${devkit}, pinned ${pinnedDevkit}`);

const iconset = path.join(desktop, "release-eb", "icon.iconset");
fs.rmSync(iconset, { recursive: true, force: true });
fs.mkdirSync(path.dirname(iconset), { recursive: true });
execFileSync("iconutil", ["-c", "iconset", path.join(desktop, "build", "icon.icns"), "-o", iconset], { stdio: "inherit" });
