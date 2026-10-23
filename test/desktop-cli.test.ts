import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

test("kiwi.js is compiled in a child process with a minimal environment, never in the app's own process", async () => {
  const dir = folder();
  const bundle = join(dir, "kiwi.js");
  const seen = join(dir, "macro-ran-in");
  writeFileSync(
    join(dir, "m.ts"),
    `import { writeFileSync } from "node:fs";\nexport function m(): string {\n  writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ pid: process.pid, keyFd: process.env.KIWI_KEY_FD ?? null }));\n  return "x";\n}\n`,
  );
  writeFileSync(bundle, 'import { m } from "./m.ts" with { type: "macro" };\nif (process.argv.includes("--version")) console.log(`kiwi 9.9.9 ${m()}`);\n');
  process.env["KIWI_INSTALL"] = join(dir, "bin");
  process.env["KIWI_KEY_FD"] = "3";
  try {
    await keepCli(bundle, "9.9.9");
  } finally {
    delete process.env["KIWI_KEY_FD"];
  }
  const ran = JSON.parse(readFileSync(seen, "utf8")) as { pid: number; keyFd: string | null };
  expect(ran.pid).not.toBe(process.pid);
  expect(ran.keyFd).toBeNull();
}, 30_000);

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
