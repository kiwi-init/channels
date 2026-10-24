import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { LEGACY_NAMES } from "../src/legacy-store.ts";

export function sealOf(contents: string, executable: string): Record<string, string> {
  const seal: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(contents, full);
      if (entry.isDirectory()) {
        if (rel !== "_CodeSignature") walk(full);
        continue;
      }
      if (!entry.isFile()) throw new Error(`${rel} isn't a plain file or folder, and the launcher refuses an app with one`);
      if (rel === "Info.plist" || rel === "CodeResources" || rel === path.join("MacOS", executable)) continue;
      seal[rel] = createHash("sha256").update(fs.readFileSync(full)).digest("hex");
    }
  };
  walk(contents);
  return seal;
}

export function sealApp(app: string): number {
  const plist = path.join(app, "Contents", "Info.plist");
  const executable = execFileSync("plutil", ["-extract", "CFBundleExecutable", "raw", plist], { encoding: "utf8" }).trim();
  const seal = sealOf(path.join(app, "Contents"), executable);
  execFileSync("plutil", ["-replace", "KiwiSeal", "-json", JSON.stringify(seal), plist]);
  execFileSync("plutil", ["-replace", "KiwiLegacyNames", "-json", JSON.stringify(LEGACY_NAMES), plist]);
  return Object.keys(seal).length;
}

export function sealDiff(sealed: Record<string, unknown>, now: Record<string, string>): string[] {
  return [
    ...Object.entries(now).flatMap(([rel, sha]) => (sealed[rel] === undefined ? [`${rel} isn't sealed`] : sealed[rel] === sha ? [] : [`${rel} changed after sealing`])),
    ...Object.keys(sealed).flatMap((rel) => (rel in now ? [] : [`${rel} is sealed but gone`])),
  ];
}

export function sealProblems(app: string): string[] {
  const plist = path.join(app, "Contents", "Info.plist");
  const executable = execFileSync("plutil", ["-extract", "CFBundleExecutable", "raw", plist], { encoding: "utf8" }).trim();
  const raw = JSON.parse(execFileSync("plutil", ["-extract", "KiwiSeal", "json", "-o", "-", plist], { encoding: "utf8" })) as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return ["Info.plist's KiwiSeal isn't a dictionary"];
  return sealDiff(raw as Record<string, unknown>, sealOf(path.join(app, "Contents"), executable));
}

if (import.meta.main) {
  const app = process.argv[2];
  if (!app || !app.endsWith(".app")) throw new Error("usage: bun desktop/scripts/eb-seal.ts <path/to/App.app>");
  console.log(`eb-seal: ${sealApp(path.resolve(app))} files of ${app} sealed in its Info.plist`);
}
