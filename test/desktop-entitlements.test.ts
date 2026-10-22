import { afterAll, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APP = "desktop/build/entitlements.app.plist";
const CLI = "desktop/build/entitlements.cli.plist";
const keys = (file: string) => [...readFileSync(file, "utf8").matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]);
const workflow = readFileSync(".github/workflows/release-build.yml", "utf8");

test("Channels.app runs V8, nothing more: no microphone; only the bundled kiwi gets Bun's DYLD and library entitlements", () => {
  expect(keys(APP)).toEqual(["com.apple.security.cs.allow-jit", "com.apple.security.cs.allow-unsigned-executable-memory"]);
  expect([...keys(APP), ...keys(CLI)]).not.toContain("com.apple.security.device.audio-input");
  expect(keys(CLI)).toEqual([
    "com.apple.security.cs.allow-jit",
    "com.apple.security.cs.allow-unsigned-executable-memory",
    "com.apple.security.cs.disable-executable-page-protection",
    "com.apple.security.cs.disable-library-validation",
    "com.apple.security.cs.allow-dyld-environment-variables",
  ]);
  const mac = (JSON.parse(readFileSync("desktop/package.json", "utf8")) as { build: { mac: { entitlements: string; entitlementsInherit: string; extendInfo?: Record<string, string> } } }).build.mac;
  expect([mac.entitlements, mac.entitlementsInherit]).toEqual(["build/entitlements.app.plist", "build/entitlements.app.plist"]);
  expect(mac.extendInfo?.NSMicrophoneUsageDescription).toBeUndefined();
  expect(workflow).toContain("--entitlements build/entitlements.cli.plist");
  expect(workflow).not.toContain("entitlements.mac.plist");
});

function entitlementsCheck(): string {
  const from = workflow.indexOf('              ents=$(codesign -d --entitlements - --xml "$app"');
  const to = workflow.indexOf("              # -dvv:", from);
  if (from < 0 || to < 0) throw new Error("the signed app's entitlements check moved; update this test");
  return workflow.slice(from, to);
}

const root = mkdtempSync(join(tmpdir(), "kiwi-entitlements-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function bundle(dir: string, exe: string, id: string): void {
  mkdirSync(join(dir, "Contents", "MacOS"), { recursive: true });
  copyFileSync("/usr/bin/true", join(dir, "Contents", "MacOS", exe));
  writeFileSync(
    join(dir, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleExecutable</key><string>${exe}</string><key>CFBundleIdentifier</key><string>com.example.${id}</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>\n`,
  );
}

function signed(name: string, app: string | null, helper: string): { code: number; out: string } {
  const at = join(root, name, "Channels.app");
  const help = join(at, "Contents", "Frameworks", "Channels Helper.app");
  bundle(at, "Channels", "channels");
  bundle(help, "Channels Helper", "helper");
  const sign = (path: string, plist: string | null) => {
    const r = Bun.spawnSync(["codesign", "--force", "--sign", "-", ...(plist ? ["--entitlements", plist] : []), path]);
    if (r.exitCode !== 0) throw new Error(`codesign ${path}: ${r.stderr.toString()}`);
  };
  sign(help, helper);
  sign(at, app);
  const r = Bun.spawnSync(["bash", "-c", `app="$1"\n${entitlementsCheck()}`, "check", at]);
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

test.skipIf(process.platform !== "darwin")("a signed release refuses an app or helper carrying the CLI's entitlements, and passes the app's own", () => {
  const plus = join(root, "plus.plist");
  writeFileSync(plus, readFileSync(APP, "utf8").replace("  </dict>", "    <key>com.apple.security.cs.disable-library-validation</key>\n    <true/>\n  </dict>"));
  const mic = join(root, "mic.plist");
  writeFileSync(mic, readFileSync(APP, "utf8").replace("  </dict>", "    <key>com.apple.security.device.audio-input</key>\n    <true/>\n  </dict>"));
  expect(signed("good", APP, APP)).toEqual({ code: 0, out: "" });
  const cases: [string, string | null, string, string][] = [
    ["helper with the CLI's", APP, CLI, "Channels Helper.app carries com.apple.security.cs.allow-dyld-environment-variables"],
    ["app with library validation off", plus, APP, "Channels.app carries com.apple.security.cs.disable-library-validation"],
    ["app with the CLI's", CLI, APP, "Channels.app carries com.apple.security.cs.allow-dyld-environment-variables"],
    ["app with the microphone", mic, APP, "Channels.app carries com.apple.security.device.audio-input"],
    ["app with no entitlements", null, APP, "couldn't read the entitlements"],
  ];
  for (const [what, app, helper, says] of cases) {
    const r = signed(what.replace(/\W+/g, "-"), app, helper);
    expect({ what, code: r.code }).toEqual({ what, code: 1 });
    expect(r.out).toContain(says);
  }
});
