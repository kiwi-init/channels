import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { keepCli } from "../desktop/src/cli.ts";

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
