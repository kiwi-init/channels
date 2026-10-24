import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import desktopPackage from "../package.json" with { type: "json" };
import { developerIdRequirement } from "../src/signer.ts";
import { swapAsset } from "../src/update-asset.ts";
import { MB, mb, payloadOf, shippedApp, sizeOf } from "./eb-app.ts";
import { makeDmg } from "./eb-dmg.ts";
import { sealApp, sealProblems } from "./eb-seal.ts";

const PACKED_LIMIT = 40 * MB;
const IDENTIFIER = "com.kiwiinit.channels";
const FORBIDDEN = [
  "com.apple.security.device.audio-input",
  "com.apple.security.device.camera",
  "com.apple.security.cs.disable-library-validation",
  "com.apple.security.cs.allow-dyld-environment-variables",
  "com.apple.security.cs.disable-executable-page-protection",
];
const MACH_O = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca]);

const [releaseEb, outDir] = process.argv.slice(2);
if (!releaseEb || !outDir) throw new Error("usage: bun desktop/scripts/eb-release.ts <desktop/release-eb> <out dir>");
const desktop = path.resolve(import.meta.dirname, "..");
const entitlements = path.join(desktop, "build", "entitlements.app.plist");
const keychain = process.env.EB_SIGN_KEYCHAIN ?? "";
const notary = { key: process.env.APPLE_API_KEY ?? "", id: process.env.APPLE_API_KEY_ID ?? "", issuer: process.env.APPLE_API_ISSUER ?? "" };
const signed = keychain !== "";
if (!signed && process.env.REHEARSAL !== "true")
  throw new Error("eb-release: a release can't publish an unsigned Mac app (Macs would never update to it): set EB_SIGN_KEYCHAIN, or run it as a rehearsal");
if (signed && (!notary.key || !notary.id || !notary.issuer)) throw new Error("eb-release: signing without notarizing: set APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER");

interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

function tool(cmd: string, args: string[]): Ran {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * MB });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function must(cmd: string, args: string[], what: string): Ran {
  const r = tool(cmd, args);
  if (r.code !== 0) throw new Error(`eb-release: ${what} failed (${cmd} exited ${r.code})\n${r.stdout}${r.stderr}`);
  return r;
}

function isMachO(file: string): boolean {
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(4);
    return fs.readSync(fd, head, 0, 4, 0) === 4 && MACH_O.has(head.readUInt32BE(0));
  } finally {
    fs.closeSync(fd);
  }
}

function machOs(dir: string): string[] {
  return fs.readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    const st = fs.lstatSync(p);
    if (st.isDirectory()) return machOs(p);
    return st.isFile() && isMachO(p) ? [p] : [];
  });
}

const plist = (app: string, key: string): string => must("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, path.join(app, "Contents", "Info.plist")], `reading ${key}`).stdout.trim();

function sign(target: string, withEntitlements: boolean): void {
  const ents = withEntitlements ? ["--entitlements", entitlements] : [];
  must("codesign", ["--force", "--options", "runtime", "--timestamp", "--keychain", keychain, "--sign", "Developer ID Application", ...ents, target], `signing ${target}`);
}

function notarize(file: string): void {
  const auth = ["--key", notary.key, "--key-id", notary.id, "--issuer", notary.issuer];
  const r = must("xcrun", ["notarytool", "submit", file, ...auth, "--wait", "--output-format", "json"], `notarizing ${path.basename(file)}`);
  const res = JSON.parse(r.stdout) as { id?: unknown; status?: unknown };
  if (res.status === "Accepted") return;
  const log = typeof res.id === "string" ? tool("xcrun", ["notarytool", "log", res.id, ...auth]).stdout : "";
  throw new Error(`eb-release: Apple didn't accept ${path.basename(file)} (${String(res.status)})\n${log}`);
}

function entitlementsOf(file: string): string {
  return tool("codesign", ["-d", "--entitlements", "-", "--xml", file]).stdout;
}

const version = desktopPackage.version;
const zipName = swapAsset(version, "darwin", "arm64");
if (!zipName) throw new Error("eb-release: the updater names no Mac asset");
const dmgName = zipName.replace(/\.zip$/, ".dmg");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "eb-release-"));
try {
  const app = shippedApp(payloadOf(path.join(path.resolve(releaseEb), "artifacts")), tmp);
  if (path.basename(app) !== "Channels.app") throw new Error(`eb-release: the plain app is ${path.basename(app)}, not Channels.app`);
  const id = plist(app, "CFBundleIdentifier");
  if (id !== IDENTIFIER) throw new Error(`eb-release: the app is ${id}, not ${IDENTIFIER}: build it with CHANNELS_EB_RELEASE=1`);
  const built = (JSON.parse(fs.readFileSync(path.join(app, "Contents", "Resources", "version.json"), "utf8")) as { version?: unknown }).version;
  if (built !== version) throw new Error(`eb-release: the app says ${String(built)}, desktop/package.json ${version}`);

  const mainExe = path.join(app, "Contents", "MacOS", plist(app, "CFBundleExecutable"));
  const bun = path.join(app, "Contents", "MacOS", "bun");
  if (signed) {
    for (const f of machOs(app).filter((f) => f !== mainExe)) sign(f, f === bun);
    sealApp(app);
    sign(app, false);
    const forNotary = path.join(tmp, "notarize.zip");
    must("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, forNotary], "zipping for notarization");
    notarize(forNotary);
    must("xcrun", ["stapler", "staple", app], "stapling the app");
  } else {
    for (const f of machOs(app).filter((f) => f !== mainExe)) must("codesign", ["--force", "--sign", "-", f], `ad-hoc signing ${f}`);
    sealApp(app);
    must("codesign", ["--force", "--sign", "-", app], "ad-hoc signing the app");
  }

  fs.mkdirSync(outDir, { recursive: true });
  const zip = path.join(outDir, zipName);
  const dmg = path.join(outDir, dmgName);
  fs.rmSync(zip, { force: true });
  fs.rmSync(dmg, { force: true });
  must("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, zip], "zipping");
  const stage = path.join(tmp, "dmg");
  fs.mkdirSync(stage);
  must("ditto", [app, path.join(stage, "Channels.app")], "staging the dmg");
  fs.symlinkSync("/Applications", path.join(stage, "Applications"));
  makeDmg(stage, dmg, tool);
  if (signed) {
    must("codesign", ["--force", "--timestamp", "--keychain", keychain, "--sign", "Developer ID Application", dmg], "signing the dmg");
    notarize(dmg);
    must("xcrun", ["stapler", "staple", dmg], "stapling the dmg");
  }

  const top = new Set(
    must("zipinfo", ["-1", zip], "listing the zip")
      .stdout.split("\n")
      .filter(Boolean)
      .map((l) => l.split("/")[0])
      .filter((t) => t !== "__MACOSX"),
  );
  if (top.size !== 1 || !top.has("Channels.app")) throw new Error(`eb-release: ${zipName} must hold Channels.app at its root, and holds ${[...top].join(", ")}`);
  for (const f of machOs(app)) {
    const ents = entitlementsOf(f);
    for (const e of FORBIDDEN) if (ents.includes(e)) throw new Error(`eb-release: ${path.relative(app, f)} carries ${e}`);
  }
  if (signed) {
    if (!entitlementsOf(bun).includes("com.apple.security.cs.allow-jit")) throw new Error("eb-release: Bun lost allow-jit; its JavaScript can't run under the hardened runtime");
    must("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], "verifying the signature");
    const req = developerIdRequirement(must("codesign", ["-d", "-r-", app], "reading the designated requirement").stdout);
    if (!req?.includes(`identifier "${IDENTIFIER}"`))
      throw new Error(`eb-release: the app's designated requirement isn't a Developer ID one for ${IDENTIFIER}, so the Electron app's updater would refuse it`);
    must("xcrun", ["stapler", "validate", app], "validating the app's ticket");
    must("spctl", ["--assess", "--type", "execute", "--verbose=2", app], "Gatekeeper on the app");
    must("xcrun", ["stapler", "validate", dmg], "validating the dmg's ticket");
    must("spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=2", dmg], "Gatekeeper on the dmg");
  }

  const unsealed = sealProblems(app);
  if (unsealed.length) throw new Error(`eb-release: the launcher would refuse this app: ${unsealed.join("; ")}`);

  let over = 0;
  for (const f of [zip, dmg]) {
    const bytes = sizeOf(f);
    console.log(`${mb(bytes).padStart(9)}  ${path.basename(f)}  (gate ${mb(PACKED_LIMIT)}: ${bytes > PACKED_LIMIT ? "OVER" : "ok"})`);
    if (bytes > PACKED_LIMIT) over++;
  }
  console.log(`${mb(sizeOf(app)).padStart(9)}  Channels.app on disk`);
  console.log(signed ? "signed with the Developer ID, notarized and stapled" : "rehearsal: ad-hoc signed, not notarized");
  process.exitCode = over ? 1 : 0;
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
