import { execFileSync, spawnSync } from "node:child_process";
import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { payloadOf, shippedApp } from "./eb-app.ts";
import { PROBE_PREFIX, type ProbeReport } from "./eb-keys-probe.ts";
import { STORE_PROBE_PREFIX, storePlaces, type StoreProbe } from "./eb-store-probe.ts";
import { sealApp } from "./eb-seal.ts";

const release = path.resolve(process.argv[2] ?? "desktop/release-eb");
const tag = randomBytes(4).toString("hex");
const id = `com.kiwiinit.channels.keys-check-${tag}`;
const asanId = `${id}-asan`;
const legacy = `kiwi-keys-check-${tag}`;
const legacyValue = randomBytes(16).toString("base64");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "eb-keys-"));
const storeId = `${id}-store`;
const importId = `${id}-import`;
const CI = process.env["CI"] === "true";
const failures: string[] = [];
const SEAL_GATE_MS = 500;

const contents = (app: string): string => path.join(app, "Contents");
const plist = (app: string): string => path.join(contents(app), "Info.plist");
const executable = (app: string): string => path.join(contents(app), "MacOS", execFileSync("plutil", ["-extract", "CFBundleExecutable", "raw", plist(app)], { encoding: "utf8" }).trim());

function copy(app: string, name: string): string {
  const to = path.join(tmp, name, path.basename(app));
  execFileSync("ditto", [app, to]);
  return to;
}

interface Run {
  status: number | null;
  stderr: string;
  report: ProbeReport | null;
  ran: string;
}

function run(app: string): Run {
  const extra = fs.openSync(path.join(tmp, "extra"), "a");
  const began = performance.now();
  const r = spawnSync(executable(app), [], {
    encoding: "utf8",
    timeout: 60_000,
    stdio: ["ignore", "pipe", "pipe", "ignore", "ignore", extra],
    env: { ...process.env, BUN_OPTIONS: `--preload ${path.join(tmp, "nowhere.js")}` },
  });
  fs.closeSync(extra);
  const line = r.stdout.split("\n").find((l) => l.startsWith(PROBE_PREFIX));
  const ran = `status ${r.status}, signal ${r.signal}, ${r.error ? `error ${r.error.message}, ` : ""}${Math.round(performance.now() - began)} ms, stdout ${JSON.stringify(r.stdout.slice(-300))}`;
  return { status: r.status, stderr: r.stderr, report: line ? (JSON.parse(line.slice(PROBE_PREFIX.length)) as ProbeReport) : null, ran };
}

function expect(what: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}`);
  if (!ok) failures.push(`${what}: ${detail}`);
}

const okOf = (r: Run, key: string): string | null | undefined => {
  const s = r.report?.[key];
  return s && "ok" in s ? s.ok : undefined;
};

const errorOf = (r: Run, key: string): string => {
  const s = r.report?.[key];
  return s && "error" in s ? s.error : "";
};

function storeRun(app: string): { report: StoreProbe | null; ran: string } {
  const r = spawnSync(executable(app), [], { encoding: "utf8", timeout: 60_000 });
  const line = r.stdout.split("\n").find((l) => l.startsWith(STORE_PROBE_PREFIX));
  return { report: line ? (JSON.parse(line.slice(STORE_PROBE_PREFIX.length)) as StoreProbe) : null, ran: `status ${r.status}, signal ${r.signal}, stderr ${JSON.stringify(r.stderr.slice(-400))}` };
}

const hasItem = (service: string, account: string): boolean => spawnSync("security", ["find-generic-password", "-s", service, "-a", account], { stdio: "ignore" }).status === 0;

function electronStore(home: string, json: unknown, password: string): string {
  const dir = path.join(home, "Library", "Application Support", "kiwi-desktop");
  fs.mkdirSync(dir, { recursive: true });
  const c = createCipheriv("aes-128-cbc", pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1"), Buffer.alloc(16, 0x20));
  const file = path.join(dir, "kiwi-store.bin");
  fs.writeFileSync(file, Buffer.concat([Buffer.from("v10"), c.update(JSON.stringify(json), "utf8"), c.final()]));
  return file;
}

function refused(name: string, good: string, change: (app: string) => void, why: string): void {
  const app = copy(good, name);
  change(app);
  const r = run(app);
  expect(`${name}: the launcher refuses to start (${why})`, r.status !== 0 && r.report === null && r.stderr.includes(why), `status ${r.status}, stderr ${r.stderr.slice(-400)}`);
}

function keychain(args: string[]): void {
  spawnSync("security", args, { stdio: "ignore" });
}

const unquote = (line: string): string => line.trim().replace(/^"|"$/g, "");

interface CiKeychains {
  restore: () => void;
  first: string | null;
  rest: string[];
}

function ciKeychain(): CiKeychains {
  if (!CI) return { restore: () => {}, first: null, rest: [] };
  const kc = path.join(tmp, "keys-check.keychain-db");
  const list = execFileSync("security", ["list-keychains", "-d", "user"], { encoding: "utf8" }).split("\n").map(unquote).filter(Boolean);
  const def = unquote(execFileSync("security", ["default-keychain", "-d", "user"], { encoding: "utf8" }));
  execFileSync("security", ["create-keychain", "-p", "", kc]);
  execFileSync("security", ["set-keychain-settings", kc]);
  execFileSync("security", ["unlock-keychain", "-p", "", kc]);
  execFileSync("security", ["list-keychains", "-d", "user", "-s", kc, ...list]);
  execFileSync("security", ["default-keychain", "-d", "user", "-s", kc]);
  return {
    restore: () => {
      keychain(["list-keychains", "-d", "user", "-s", ...list]);
      if (def) keychain(["default-keychain", "-d", "user", "-s", def]);
      keychain(["delete-keychain", kc]);
    },
    first: kc,
    rest: list,
  };
}

const ci = ciKeychain();
try {
  const base = shippedApp(payloadOf(path.join(release, "artifacts")), tmp);
  const probe = await Bun.build({ entrypoints: [path.join(import.meta.dirname, "eb-keys-probe.ts")], target: "bun" });
  const out = probe.outputs[0];
  if (!probe.success || !out) throw new Error(`the probe didn't bundle: ${probe.logs.join("\n")}`);
  const good = copy(base, "good");
  fs.writeFileSync(path.join(contents(good), "Resources", "main.js"), await out.text());
  const version = path.join(contents(good), "Resources", "version.json");
  fs.writeFileSync(version, JSON.stringify({ ...(JSON.parse(fs.readFileSync(version, "utf8")) as Record<string, unknown>), identifier: id }));
  execFileSync("plutil", ["-replace", "CFBundleIdentifier", "-string", id, plist(good)]);
  sealApp(good);
  execFileSync("plutil", ["-replace", "KiwiLegacyNames", "-json", JSON.stringify([legacy]), plist(good)]);
  execFileSync("security", ["add-generic-password", "-s", `${legacy} Safe Storage`, "-a", `${legacy} Key`, "-w", legacyValue, "-A"]);

  const first = run(good);
  const made = okOf(first, "set");
  expect(
    "first start: no store key yet, one made and saved through the launcher",
    okOf(first, "first") === null && typeof made === "string" && okOf(first, "get") === made,
    JSON.stringify(first.report ?? `${first.ran}; stderr ${first.stderr.slice(-400)}`),
  );
  expect(
    "a new key isn't marked ready until finish, and then it is",
    okOf(first, "markedBefore") === "unmarked" && okOf(first, "finish") === "ok" && okOf(first, "markedAfter") === "marked",
    JSON.stringify([first.report?.["markedBefore"], first.report?.["finish"], first.report?.["markedAfter"]]),
  );
  expect("bun gets only stdio and the key channel: a descriptor the launcher inherited stays behind", okOf(first, "inherited") === null, JSON.stringify(first.report?.["inherited"]));
  expect("bun moves the channel off fd 3 at once and drops KIWI_KEY_FD", okOf(first, "fd3") === null && okOf(first, "env") === null, JSON.stringify([first.report?.["fd3"], first.report?.["env"]]));
  expect(
    "done ends the session: another copy of the socket gets nothing after it",
    okOf(first, "done") === "ended" && okOf(first, "after") === "nothing",
    JSON.stringify([first.report?.["done"], first.report?.["after"]]),
  );
  expect("bun's copy of the key channel is close-on-exec", okOf(first, "cloexec") === "set", JSON.stringify(first.report?.["cloexec"]));
  expect(
    "a child started through libc system() while the channel is open gets no socket and no KIWI_KEY_FD",
    okOf(first, "native") === JSON.stringify({ sockets: [], env: null }),
    JSON.stringify(first.report?.["native"]),
  );
  expect("a child the app starts afterwards gets no socket and no KIWI_KEY_FD", okOf(first, "child") === JSON.stringify({ sockets: [], env: null }), JSON.stringify(first.report?.["child"]));
  expect("a second key never replaces the first", errorOf(first, "replace").includes("never replaces"), JSON.stringify(first.report?.["replace"]));
  expect("the old app's key, read by the launcher", okOf(first, "legacy") === legacyValue, JSON.stringify(first.report?.["legacy"]));
  expect("an app name not in Info.plist's KiwiLegacyNames is refused", errorOf(first, "unlisted").includes("isn't an app whose keys"), JSON.stringify(first.report?.["unlisted"]));
  expect("an unknown request is refused", errorOf(first, "unknown").includes("doesn't know"), JSON.stringify(first.report?.["unknown"]));
  const second = run(good);
  expect(
    "the next start gets the same key",
    typeof made === "string" && okOf(second, "first") === made && second.report?.["set"] === undefined,
    JSON.stringify(second.report ?? second.stderr.slice(-400)),
  );
  expect(
    "the next start can't take back a key an earlier one made, and the key stays marked ready",
    errorOf(second, "drop").includes("made in this session") && okOf(second, "markedKept") === "marked" && okOf(second, "get") === made,
    JSON.stringify([second.report?.["drop"], second.report?.["markedKept"], second.report?.["get"]]),
  );

  const storeBundle = await Bun.build({ entrypoints: [path.join(import.meta.dirname, "eb-store-probe.ts")], target: "bun" });
  const storeOut = storeBundle.outputs[0];
  if (!storeBundle.success || !storeOut) throw new Error(`the store probe didn't bundle: ${storeBundle.logs.join("\n")}`);
  const storeApp = async (name: string, appId: string, legacyNames: string[]): Promise<string> => {
    const app = copy(base, name);
    fs.writeFileSync(path.join(contents(app), "Resources", "main.js"), await storeOut.text());
    const v = path.join(contents(app), "Resources", "version.json");
    fs.writeFileSync(v, JSON.stringify({ ...(JSON.parse(fs.readFileSync(v, "utf8")) as Record<string, unknown>), identifier: appId }));
    execFileSync("plutil", ["-replace", "CFBundleIdentifier", "-string", appId, plist(app)]);
    sealApp(app);
    execFileSync("plutil", ["-replace", "KiwiLegacyNames", "-json", JSON.stringify(legacyNames), plist(app)]);
    return app;
  };
  const store = await storeApp("store", storeId, [legacy]);
  const channel = (JSON.parse(fs.readFileSync(path.join(contents(store), "Resources", "version.json"), "utf8")) as { channel: string }).channel;
  const places = storePlaces(storeId, channel);
  const fresh = storeRun(store);
  expect(
    "store v2 on the Mac, first start: a sealed store and a key made through the launcher and marked ready",
    fresh.report?.kind === "open" &&
      fresh.report.sealed &&
      fresh.report.json === null &&
      fresh.report.imported === null &&
      fresh.report.unmarked === null &&
      hasItem(storeId, "store-key") &&
      hasItem(storeId, "store-key-ready"),
    JSON.stringify(fresh.report ?? fresh.ran),
  );
  const reread = storeRun(store);
  expect("the next start reads it back with the same key", reread.report?.kind === "open" && reread.report.json?.["probeRuns"] === 1, JSON.stringify(reread.report ?? reread.ran));
  fs.rmSync(path.join(places.data, "kiwi-store-v2.bin"), { force: true });
  fs.rmSync(path.join(places.data, "kiwi-store-v2.bin.bak"), { force: true });
  const plantedDir = path.join(places.legacyHome, "Library", "Application Support", "kiwi-desktop");
  fs.mkdirSync(plantedDir, { recursive: true });
  fs.writeFileSync(path.join(plantedDir, "kiwi-store.bin"), JSON.stringify({ person: { name: "planted", sk: "planted" } }));
  const deleted = storeRun(store);
  expect(
    "both copies deleted and a plain Electron store planted beside them: refused as a deleted store, nothing written",
    deleted.report?.kind === "unreadable" && deleted.report.why.includes("the store was deleted") && !fs.existsSync(path.join(places.data, "kiwi-store-v2.bin")),
    JSON.stringify(deleted.report ?? deleted.ran),
  );
  if (CI) {
    execFileSync("security", ["add-generic-password", "-s", "kiwi-desktop Safe Storage", "-a", "kiwi-desktop Key", "-w", legacyValue, "-A"]);
    const imports = await storeApp("import", importId, ["kiwi-desktop"]);
    const file = electronStore(storePlaces(importId, channel).legacyHome, { relayUrl: "https://old.example", channels: [] }, legacyValue);
    const first = storeRun(imports);
    const next = storeRun(imports);
    expect(
      "Electron's kiwi-store.bin is imported once through the launcher's kiwi-desktop key, and the next start reads store v2",
      first.report?.kind === "open" &&
        first.report.imported === file &&
        first.report.json?.["relayUrl"] === "https://old.example" &&
        next.report?.kind === "open" &&
        next.report.imported === null &&
        next.report.json?.["probeRuns"] === 1,
      JSON.stringify([first.report ?? first.ran, next.report ?? next.ran]),
    );
  } else console.log("skip  the Electron import: it reads the keychain's kiwi-desktop item, so it runs only on CI's temporary keychain");

  const main = (app: string): string => path.join(contents(app), "Resources", "main.js");
  refused("main.js changed", good, (app) => fs.appendFileSync(main(app), "\n"), "Resources/main.js was changed");
  refused("a bunfig.toml beside bun", good, (app) => fs.writeFileSync(path.join(contents(app), "MacOS", "bunfig.toml"), 'preload = ["/tmp/x.js"]\n'), "MacOS/bunfig.toml isn't part of the app");
  refused("an app.asar dropped in", good, (app) => fs.writeFileSync(path.join(contents(app), "Resources", "app.asar"), ""), "Resources/app.asar isn't part of the app");
  refused("a link", good, (app) => fs.symlinkSync("/tmp", path.join(contents(app), "Resources", "link")), "Resources/link isn't a plain file or folder");
  refused("a sealed file missing", good, (app) => fs.rmSync(path.join(contents(app), "Resources", "build.json")), "of the app's files are missing");

  const timed = copy(good, "timed");
  const quick = path.join(tmp, "quick");
  fs.writeFileSync(`${quick}.c`, "int main(void) { return 0; }\n");
  execFileSync("clang", ["-O2", "-o", quick, `${quick}.c`]);
  fs.copyFileSync(quick, path.join(contents(timed), "MacOS", "launcher"));
  const files = sealApp(timed);
  const times: number[] = [];
  for (let i = 0; i < 7; i++) {
    const start = performance.now();
    const r = spawnSync(executable(timed), [], { encoding: "utf8" });
    times.push(performance.now() - start);
    if (r.status !== 0) failures.push(`the timed launcher failed: ${r.stderr.slice(-300)}`);
  }
  const median = times.sort((a, b) => a - b)[3] ?? 0;
  expect(`the launcher checks ${files} files in ${median.toFixed(0)} ms (median of 7, gate ${SEAL_GATE_MS} ms)`, median <= SEAL_GATE_MS, `${times.map((t) => t.toFixed(0)).join(", ")} ms`);

  const sanitized = path.join(tmp, "Sanitized.app");
  const sanMacos = path.join(contents(sanitized), "MacOS");
  fs.mkdirSync(sanMacos, { recursive: true });
  const native = path.join(import.meta.dirname, "..", "native", "macos");
  const flags = [
    "-g",
    "-O1",
    "-fno-omit-frame-pointer",
    "-fsanitize=address,undefined",
    "-fno-sanitize-recover=all",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-mmacosx-version-min=12.0",
    "-I",
    native,
    "-framework",
    "CoreFoundation",
    "-framework",
    "Security",
  ];
  const harness = path.join(sanMacos, "kiwi-keys-test");
  execFileSync("clang", [...flags, "-o", harness, path.join(native, "kiwi-keys.c"), path.join(native, "kiwi-keys-test.c")]);
  execFileSync("clang", [...flags, "-o", path.join(sanMacos, "kiwi-launcher"), path.join(native, "kiwi-launcher.c"), path.join(native, "kiwi-keys.c")]);
  fs.copyFileSync(quick, path.join(sanMacos, "launcher"));
  fs.writeFileSync(
    plist(sanitized),
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleExecutable</key><string>kiwi-launcher</string><key>CFBundleIdentifier</key><string>${asanId}</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>\n`,
  );
  sealApp(sanitized);
  execFileSync("plutil", ["-replace", "KiwiLegacyNames", "-json", JSON.stringify([`${legacy}-asan`]), plist(sanitized)]);
  const sanEnv: NodeJS.ProcessEnv = { ...process.env, ASAN_OPTIONS: "halt_on_error=1:detect_leaks=0", UBSAN_OPTIONS: "halt_on_error=1:print_stacktrace=1" };
  const sanRun = (file: string, args: string[]) => spawnSync(file, args, { encoding: "utf8", env: sanEnv, timeout: 300_000 });
  const clean = (r: { stderr: string }): boolean => !/AddressSanitizer|UndefinedBehaviorSanitizer|runtime error:/.test(r.stderr);
  const parser = sanRun(harness, ["parser"]);
  for (const line of parser.stdout.split("\n").filter(Boolean)) console.log(`        ${line}`);
  expect(
    "the key server's parser under ASan and UBSan: malformed, truncated, oversized, unknown and random requests, and the ready mark's finished, finish and drop",
    parser.status === 0 && clean(parser),
    `status ${parser.status}: ${parser.stderr.slice(-1200)}`,
  );
  const said = (line: string): boolean => parser.stdout.split("\n").includes(`ok    ${line}`);
  expect(
    `drop deletes by the item reference SecItemAdd gave, on ${ci.first ? "CI's temporary keychain" : "this Mac's keychain"}: the key the session made goes, and a key put in its place stays`,
    said("a key made in this session and not yet marked is taken back, once") && said("a key put in place of the one this session made is never taken back"),
    parser.stdout.slice(-1500),
  );
  if (ci.first) {
    const second = path.join(tmp, "keys-check-decoy.keychain-db");
    execFileSync("security", ["create-keychain", "-p", "", second]);
    execFileSync("security", ["set-keychain-settings", second]);
    execFileSync("security", ["unlock-keychain", "-p", "", second]);
    execFileSync("security", ["list-keychains", "-d", "user", "-s", ci.first, second, ...ci.rest]);
    execFileSync("security", ["add-generic-password", "-s", asanId, "-a", "store-key", "-w", "decoy", "-A", second]);
    const decoy = sanRun(harness, ["decoy"]);
    const kept = spawnSync("security", ["find-generic-password", "-s", asanId, "-a", "store-key", "-w", second], { encoding: "utf8" }).stdout.trim();
    keychain(["list-keychains", "-d", "user", "-s", ci.first, ...ci.rest]);
    keychain(["delete-keychain", second]);
    expect(
      "on the real Security framework, a key taken back by its item reference is the only one removed: a store key of the same name in another keychain of the search list stays",
      decoy.status === 0 && clean(decoy) && kept === "decoy",
      `${decoy.stdout} ${decoy.stderr.slice(-600)} kept ${JSON.stringify(kept)}`,
    );
  } else console.log("skip  the store key of the same name in a second keychain: it changes the keychain search list, so it runs only on CI's temporary keychains");
  const sealedRun = sanRun(harness, ["seal"]);
  expect(
    "the seal check under ASan and UBSan passes a sealed app",
    sealedRun.status === 0 && sealedRun.stdout.trim() === "sealed" && clean(sealedRun),
    `${sealedRun.stdout} ${sealedRun.stderr.slice(-800)}`,
  );
  const launched = sanRun(path.join(sanMacos, "kiwi-launcher"), []);
  expect(
    "the launcher under ASan and UBSan checks the app, starts the next one and serves to its end",
    launched.status === 0 && clean(launched),
    `status ${launched.status}: ${launched.stderr.slice(-800)}`,
  );
  fs.appendFileSync(path.join(sanMacos, "launcher"), "x");
  const changed = sanRun(harness, ["seal"]);
  expect(
    "the seal check under ASan and UBSan refuses a changed file",
    changed.status === 78 && changed.stdout.includes("MacOS/launcher was changed") && clean(changed),
    `${changed.stdout} ${changed.stderr.slice(-800)}`,
  );
} finally {
  for (const service of [id, asanId, storeId, importId]) for (const account of ["store-key", "store-key-ready"]) keychain(["delete-generic-password", "-s", service, "-a", account]);
  keychain(["delete-generic-password", "-s", `${legacy} Safe Storage`, "-a", `${legacy} Key`]);
  ci.restore();
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const appId of [id, storeId, importId]) fs.rmSync(path.join(os.homedir(), "Library", "Application Support", appId), { recursive: true, force: true });
}

if (failures.length) {
  console.error(`eb-keys-check: ${failures.length} failed\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("eb-keys-check: the launcher holds the key and refuses a changed app");
