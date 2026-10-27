import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bundleProblems, keyChannelProblems, RELEASE_ID, shortVersion, testBuildProblems, TEST_ID, urlSchemeProblems, versionProblems } from "../desktop/scripts/eb-bundle.ts";

const table = "var internalRpcHandlers = { message: { webviewTagExecuteJavascript: (params) => {} } };";

test("the built app has one internal RPC table for the lock to reach, and a preload with no socket", () => {
  expect(bundleProblems(table, "window.kiwi = bridge;")).toEqual([]);
  expect(bundleProblems(`${table}\n${table}`, "x")).toEqual([expect.stringContaining("defines Electrobun's internal RPC table 2 times")]);
  expect(bundleProblems("var nothing = 1;", "x")).toEqual([expect.stringContaining("0 times")]);
  const wrapped = "var internalRpcHandlers = { message: { webviewTagExecuteJavascript: forOwnWebviewTag((params) => {}) } };";
  expect(bundleProblems(wrapped, "window.kiwi = bridge;")).toEqual([]);
  expect(bundleProblems(`${wrapped}\n${table}`, "x")).toEqual([expect.stringContaining("2 times")]);
  expect(bundleProblems(table, "")).toEqual([expect.stringContaining("preload bundle is empty")]);
  expect(bundleProblems(table, 'new WebSocket("ws://127.0.0.1:50000/socket")')).toEqual([expect.stringContaining("uses a WebSocket")]);
});

test("the release bundle registers kiwi:// and a test bundle never does (T438)", () => {
  const plist = (schemes: string[]) =>
    `<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>x</string>${schemes.length ? `<key>CFBundleURLTypes</key><array><dict><key>CFBundleURLName</key><string>x</string><key>CFBundleURLSchemes</key><array>${schemes.map((s) => `<string>${s}</string>`).join("")}</array></dict></array>` : ""}</dict></plist>`;
  expect(urlSchemeProblems(plist(["kiwi"]), RELEASE_ID, "kiwi")).toEqual([]);
  expect(urlSchemeProblems(plist([]), RELEASE_ID, "kiwi")).toEqual([expect.stringContaining("registers no kiwi:// scheme")]);
  expect(urlSchemeProblems(plist(["other"]), RELEASE_ID, "kiwi")).toEqual([expect.stringContaining("registers no kiwi:// scheme")]);
  expect(urlSchemeProblems(plist([]), "com.kiwiinit.channels.eb-test", "kiwi")).toEqual([]);
  expect(urlSchemeProblems(plist(["kiwi"]), "com.kiwiinit.channels.eb-test", "kiwi")).toEqual([expect.stringContaining("could take links meant for the installed Channels")]);
});

test("a CHANNELS_EB_TEST=1 build is a dev build with the test id, and anything else is refused (T1820)", () => {
  const dev = JSON.stringify({ channel: "dev", identifier: TEST_ID });
  expect(testBuildProblems(true, TEST_ID, dev)).toEqual([]);
  expect(testBuildProblems(false, "com.kiwiinit.channels", JSON.stringify({ channel: "stable" }))).toEqual([]);
  for (const channel of ["stable", "canary"]) expect(testBuildProblems(true, TEST_ID, JSON.stringify({ channel }))).toEqual([expect.stringContaining(`built a ${channel} app`)]);
  expect(testBuildProblems(true, "com.kiwiinit.channels", dev)).toEqual([expect.stringContaining(`a test build is always ${TEST_ID}`)]);
  expect(testBuildProblems(true, TEST_ID, "not json")).toEqual([expect.stringContaining("built a undefined app")]);
});

const CHANNEL = "var launcherKeys = (() => {\n  try {\n    return keySources();\n  } catch (e) {\n    return new Error(errorText(e));\n  }\n})();\n";
const INERT = [
  'import { createRequire } from "node:module";',
  'import fs from "fs";',
  "var __defProp = Object.defineProperty;",
  "var __require = createRequire(import.meta.url);",
  "var init_windowEvents = __esm(() => { windowEvents_default = { close: (data) => new Event(data) }; });",
  "var exports_Socket = {};",
  "__export(exports_Socket, { send: () => send });",
  'var MAX = 4 * 1024, O_CLOEXEC = process.platform === "darwin" ? 16777216 : 524288;',
  "var enc = new TextEncoder;",
  'var BLOB = enc.encode("kiwi-image");',
  'var MAGIC = Buffer.from("kiwi-store/2\\n", "latin1");',
  'var CAPS = ["write", "tasks", "merge"];',
  "var caps = (...c) => CAPS.filter((x) => c.includes(x));",
  'var PRESETS = [{ id: "builder", capabilities: caps("write", "merge") }];',
  "var IDS = new Set(PRESETS.map((p) => p.id));",
  'class Event { name; static kind = "event"; constructor(n) { this.name = n; } }',
  "function keySources() { return {}; }",
].join("\n");

test("the key channel is taken before anything else in the main bundle runs: constants, declarations and the bundler's lazy wrappers may come first, nothing that runs code (T1710)", () => {
  expect(keyChannelProblems(`${INERT}\n${CHANNEL}init_native();\nuseHost(ebHost);\n`)).toEqual([]);
  const ran = (line: string): string[] => keyChannelProblems(`${INERT}\n${line}\n${CHANNEL}`);
  expect(ran("init_native();")).toEqual([expect.stringContaining("1 top-level statement runs before the key channel is taken")]);
  expect(ran("init_native();")[0]).toContain("init_native();");
  expect(ran('var child = spawn("sh", ["-c", "true"]);')).toHaveLength(1);
  expect(ran("var lib = dlopen(path, {});")).toHaveLength(1);
  expect(ran("class Booted { static ready = boot(); }")).toHaveLength(1);
  expect(ran("class Booted { static { boot(); } }")).toHaveLength(1);
  expect(ran("var loud = (() => { boot(); return 1; })();")).toHaveLength(1);
  expect(ran("var all = CAPS.map((c) => { boot(); return c; });")).toHaveLength(1);
  expect(ran("var started = start();\nfunction start() { boot(); return 1; }")).toHaveLength(1);
  expect(ran("globalThis.kiwi = 1;")).toHaveLength(1);
  expect(ran("for (const c of CAPS) boot(c);")).toHaveLength(1);
  expect(keyChannelProblems(`${INERT}\ninit_native();\nboot();\n${CHANNEL}`)).toEqual([expect.stringContaining("2 top-level statements run")]);
});

test("a key channel Bun wrapped in __esm fails: its bare declaration sits early but keySources() runs only when init is called, after an import above it already ran (T1710, #814's review)", () => {
  const wrapped = [
    INERT,
    "var launcherKeys;",
    "var init_launcher_channel_eb = __esm(() => {",
    "  launcherKeys = (() => {",
    "    try {",
    "      return keySources();",
    "    } catch (e) {",
    "      return new Error(errorText(e));",
    "    }",
    "  })();",
    "});",
    'spawnSync("true");',
    "init_launcher_channel_eb();",
  ].join("\n");
  expect(keyChannelProblems(wrapped)).toEqual([expect.stringContaining("declares launcherKeys without calling keySources() there")]);
  expect(keyChannelProblems(`${INERT}\nvar launcherKeys = errorOnly();\n`)).toEqual([expect.stringContaining("without calling keySources() there")]);
});

test("a non-builtin import runs before every line of the bundle, wherever it sits, and a bundle that never takes the channel fails (T1710)", () => {
  expect(keyChannelProblems(`${INERT}\n${CHANNEL}import Electrobun from "electrobun/main";\n`)).toEqual([expect.stringContaining("imports electrobun/main")]);
  expect(keyChannelProblems(`import "bun:ffi";\nimport path from "node:path";\nimport { spawn } from "child_process";\n${CHANNEL}`)).toEqual([]);
  expect(keyChannelProblems(INERT)).toEqual([expect.stringContaining("never takes the launcher's key channel")]);
});

const built: string[] = [];
afterAll(() => {
  for (const d of built.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function bundleMain(before: string | null, lazy = false): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "kiwi-eb-order-"));
  built.push(dir);
  const stub = join(dir, "electrobun-stub.ts");
  writeFileSync(
    stub,
    "export default {}; export const BrowserView = class {}; export const BrowserWindow = class {}; export const PATHS = {}; export const Utils = {}; export const BuildConfig = {}; export const ApplicationMenu = {}; export const Tray = class {}; export const internalRpcHandlers = {}; export const AppEngine = class {}; export const placeFiles = () => {}; export const readFolder = () => new Map();\n",
  );
  const entry = join(dir, "entry.ts");
  const side = join(dir, "side.ts");
  writeFileSync(side, 'import { spawnSync } from "node:child_process";\nspawnSync("true");\nexport {};\n');
  const channel = JSON.stringify(join(import.meta.dir, "../desktop/src/launcher-channel-eb.ts"));
  writeFileSync(
    entry,
    `${before === null ? "" : `import ${JSON.stringify(side)};\n`}import ${JSON.stringify(join(import.meta.dir, "../desktop/src/main-eb.ts"))};\n${lazy ? `export const lazyKeys = () => import(${channel});\n` : ""}`,
  );
  const out = await Bun.build({
    entrypoints: [entry],
    target: "bun",
    plugins: [{ name: "electrobun-stub", setup: (b) => void b.onResolve({ filter: /^electrobun(\/main)?$|\.hutch\// }, () => ({ path: stub })) }],
    throw: false,
  });
  if (!out.success || !out.outputs[0]) throw new Error(out.logs.map(String).join("\n"));
  return out.outputs[0].text();
}

test("main-eb.ts as built: its first import takes the key channel before any other module's top level, and an import added above it is caught (T1710)", async () => {
  expect(keyChannelProblems(await bundleMain(null))).toEqual([]);
  expect(keyChannelProblems(await bundleMain("side"))).toEqual([expect.stringContaining('spawnSync("true")')]);
  expect(keyChannelProblems(await bundleMain("side", true))).toEqual([expect.stringContaining("without calling keySources() there")]);
  expect(keyChannelProblems(await bundleMain(null, true))).toEqual([expect.stringContaining("import launcher-channel-eb.ts only statically")]);
}, 60_000);

test("the Mac app names its version where Finder and About read it: CFBundleShortVersionString, the x.y.z of CFBundleVersion", () => {
  const info = (keys: Record<string, string>) =>
    `<dict>${Object.entries(keys)
      .map(([k, v]) => `<key>${k}</key>\n  <string>${v}</string>`)
      .join("")}</dict>`;
  expect(versionProblems(info({ CFBundleVersion: "0.28.0", CFBundleShortVersionString: "0.28.0" }))).toEqual([]);
  expect(versionProblems(info({ CFBundleVersion: "0.28.0-rc.1", CFBundleShortVersionString: "0.28.0" }))).toEqual([]);
  expect(versionProblems(info({ CFBundleVersion: "0.28.0" }))).toEqual(["Info.plist names no CFBundleShortVersionString, so Finder and About show no version"]);
  expect(versionProblems(info({ CFBundleVersion: "0.28.0", CFBundleShortVersionString: "0.27.4" }))).toEqual([
    "Info.plist's CFBundleShortVersionString is 0.27.4, not 0.28.0 from CFBundleVersion 0.28.0",
  ]);
  expect(versionProblems(info({ CFBundleShortVersionString: "0.28.0" }))).toEqual(["Info.plist names no CFBundleVersion"]);
  expect([shortVersion("1.2.3"), shortVersion("1.2.3-rc.4"), shortVersion("1.2.3+build.5")]).toEqual(["1.2.3", "1.2.3", "1.2.3"]);
});
