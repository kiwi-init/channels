import { afterEach, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { kiwiCli } from "../desktop/src/bundled-daemon.ts";
import { keepCli } from "../desktop/src/cli.ts";
import { useHost } from "../desktop/src/host.ts";
import { fakeHost } from "./fake-host.ts";

const dirs: string[] = [];
const before = process.env["KIWI_INSTALL"];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  if (before === undefined) delete process.env["KIWI_INSTALL"];
  else process.env["KIWI_INSTALL"] = before;
});

function folder(): string {
  const d = mkdtempSync(join(tmpdir(), "kiwi-cli-"));
  dirs.push(d);
  return d;
}

test("the app's kiwi.js becomes a working kiwi in the install folder, built with the app's own Bun, and a current one is kept", async () => {
  const dir = folder();
  const bundle = join(dir, "kiwi.js");
  writeFileSync(bundle, 'if (process.argv.includes("--version")) console.log("kiwi 9.9.9");\n');
  process.env["KIWI_INSTALL"] = join(dir, "bin");
  const kept = await keepCli(bundle, "9.9.9");
  expect(kept).toEqual({ path: join(dir, "bin", "kiwi"), version: "9.9.9", updated: true });
  expect(execFileSync(kept.path, ["--version"], { encoding: "utf8" }).trim()).toBe("kiwi 9.9.9");
  expect(readdirSync(join(dir, "bin"))).toEqual(["kiwi"]);
  expect(await keepCli(bundle, "9.9.9")).toEqual({ path: kept.path, version: "9.9.9", updated: false });
}, 30_000);

test("a kiwi.js that doesn't build leaves nothing in the install folder", async () => {
  const dir = folder();
  const bundle = join(dir, "kiwi.js");
  writeFileSync(bundle, 'import "./missing-module.js";\n');
  process.env["KIWI_INSTALL"] = join(dir, "bin");
  await expect(keepCli(bundle, "9.9.9")).rejects.toThrow("didn't build");
  expect(readdirSync(join(dir, "bin"))).toEqual([]);
}, 30_000);

test("a kiwi.js with a macro doesn't build: the compile refuses macros, so none runs in the app or in the compile", async () => {
  const dir = folder();
  const bundle = join(dir, "kiwi.js");
  const seen = join(dir, "macro-ran");
  writeFileSync(join(dir, "m.ts"), `import { writeFileSync } from "node:fs";\nexport function m(): string {\n  writeFileSync(${JSON.stringify(seen)}, String(process.pid));\n  return "x";\n}\n`);
  writeFileSync(bundle, 'import { m } from "./m.ts" with { type: "macro" };\nif (process.argv.includes("--version")) console.log(`kiwi 9.9.9 ${m()}`);\n');
  process.env["KIWI_INSTALL"] = join(dir, "bin");
  await expect(keepCli(bundle, "9.9.9")).rejects.toThrow("didn't build");
  expect(existsSync(seen)).toBe(false);
  expect(readdirSync(join(dir, "bin"))).toEqual([]);
}, 30_000);

test.skipIf(process.platform === "win32")(
  "every kiwi the app runs (the check of a new build, its version, its cleanup) gets neither the app's fd 3 nor KIWI_KEY_FD, BUN_OPTIONS, NODE_OPTIONS or LD_LIBRARY_PATH, and loads no bunfig.toml or .env from the folder it runs in (T1062)",
  async () => {
    const dir = folder();
    const bundle = join(dir, "kiwi.js");
    const runs = join(dir, "runs");
    const preloaded = join(dir, "preloaded");
    const key = join(dir, "key");
    writeFileSync(key, "not a key");
    const keyIno = statSync(key).ino;
    writeFileSync(join(dir, "preload.js"), `require("node:fs").appendFileSync(${JSON.stringify(preloaded)}, process.pid + "\\n");\n`);
    const proj = join(dir, "proj");
    mkdirSync(proj);
    writeFileSync(join(proj, "bunfig.toml"), `preload = [${JSON.stringify(join(dir, "preload.js"))}]\n`);
    writeFileSync(join(proj, ".env"), "KIWI_FROM_DOTENV=1\n");
    writeFileSync(
      bundle,
      `import { appendFileSync, fstatSync } from "node:fs";\n` +
        `const fd3 = (() => { try { return fstatSync(3).ino; } catch { return null; } })();\n` +
        `const env = ["KIWI_KEY_FD", "BUN_OPTIONS", "NODE_OPTIONS", "LD_LIBRARY_PATH", "KIWI_FROM_DOTENV"].filter((n) => process.env[n] !== undefined);\n` +
        `appendFileSync(${JSON.stringify(runs)}, JSON.stringify({ pid: process.pid, args: process.argv.slice(2), fd3, env }) + "\\n");\n` +
        `if (process.argv.includes("--version")) console.log("kiwi 9.9.9");\n`,
    );
    const helper = join(dir, "helper.ts");
    writeFileSync(
      helper,
      `import { existsSync, readFileSync } from "node:fs";\n` +
        `import { keepCli } from ${JSON.stringify(join(import.meta.dir, "../desktop/src/cli.ts"))};\n` +
        `process.chdir(${JSON.stringify(proj)});\n` +
        `await keepCli(${JSON.stringify(bundle)}, "9.9.9");\n` +
        `await keepCli(${JSON.stringify(bundle)}, "9.9.9");\n` +
        `for (let i = 0; i < 100 && !(existsSync(${JSON.stringify(runs)}) && readFileSync(${JSON.stringify(runs)}, "utf8").includes("cleanup")); i++) await Bun.sleep(100);\n`,
    );
    const keyFd = openSync(key, "r");
    try {
      const ran = spawnSync(process.execPath, [helper], {
        cwd: dir,
        stdio: ["ignore", "pipe", "pipe", keyFd],
        encoding: "utf8",
        timeout: 60_000,
        env: {
          ...process.env,
          KIWI_INSTALL: join(dir, "bin"),
          KIWI_KEY_FD: "3",
          BUN_OPTIONS: `--preload=${join(dir, "preload.js")}`,
          NODE_OPTIONS: `--require=${join(dir, "preload.js")}`,
          LD_LIBRARY_PATH: dir,
        },
      });
      expect({ status: ran.status, stderr: ran.stderr }).toEqual({ status: 0, stderr: "" });
    } finally {
      closeSync(keyFd);
    }
    const seen = readFileSync(runs, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { pid: number; args: string[]; fd3: number | null; env: string[] });
    expect(seen.map((r) => r.args.join(" ")).sort()).toEqual(["--version", "--version", "cleanup --quiet"]);
    expect(seen.filter((r) => r.fd3 === keyIno || r.env.length > 0)).toEqual([]);
    const preloads = readFileSync(preloaded, "utf8").trim().split("\n").map(Number);
    expect(preloads.length).toBeGreaterThan(0);
    expect(preloads.filter((pid) => seen.some((r) => r.pid === pid))).toEqual([]);
  },
  90_000,
);

test("the daemon's own copy: with only kiwi.js in the app, kiwiCli compiles a runnable kiwi into the app's data, never hands back the .js", async () => {
  const resources = folder();
  const data = folder();
  writeFileSync(join(resources, "kiwi.js"), 'if (process.argv.includes("--version")) console.log("kiwi 9.9.9");\n');
  mkdirSync(join(data, "bin"), { recursive: true });
  useHost(fakeHost({ packaged: true, version: "9.9.9", paths: { resources, data } }).host);
  const bin = await kiwiCli();
  expect(bin).toBe(join(data, "bin", "kiwi-9.9.9"));
  expect(execFileSync(bin, ["--version"], { encoding: "utf8" }).trim()).toBe("kiwi 9.9.9");
}, 30_000);
