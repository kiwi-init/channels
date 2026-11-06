import { afterAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inModsWorker } from "../desktop/src/mods-run.ts";

const WORKER = join(import.meta.dir, "..", "desktop", "src", "mods-worker.ts");
const made: string[] = [];
const scratch = (tag: string): string => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-mods-worker-${tag}-`));
  made.push(d);
  return d;
};
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_NOSYSTEM: "1" };
const sh = (cwd: string, ...args: string[]): string => execFileSync("git", args, { cwd, env: ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function save(dir: string, version: string, needs: string[]): void {
  writeFileSync(join(dir, "mod.json"), JSON.stringify({ name: "notes", version, shell: "^3.6", needs }));
  writeFileSync(join(dir, "index.tsx"), `export const v = "${version}"\n`);
  sh(dir, "add", "-A");
  sh(dir, "commit", "--quiet", "-m", version);
}

test("the app lists, checks, updates and removes mods in a worker, with kiwi mod's own code, and a refusal comes back as the error", async () => {
  const home = scratch("home");
  const src = scratch("src");
  sh(src, "init", "--quiet", "--initial-branch", "main");
  save(src, "1.0.0", ["panel"]);
  const { addMod } = await import("../src/mods.ts");
  addMod(home, src);

  const listed = await inModsWorker<{ name: string; version: string; source: string; changed: boolean }[]>({ op: "list", home }, WORKER);
  expect(listed).toMatchObject([{ name: "notes", version: "1.0.0", source: src, changed: false }]);

  save(src, "1.1.0", ["panel", "net:example.com"]);
  const found = await inModsWorker<{ changes: { name: string; to: string; added: string[]; applied: boolean }[] }>({ op: "check", home }, WORKER);
  expect(found.changes).toMatchObject([{ name: "notes", to: "1.1.0", added: ["net:example.com"], applied: false }]);
  expect((await inModsWorker<{ version: string }[]>({ op: "list", home }, WORKER))[0]?.version).toBe("1.0.0");

  const took = await inModsWorker<{ changes: { applied: boolean }[] }>({ op: "update", home, name: "notes" }, WORKER);
  expect(took.changes[0]?.applied).toBe(true);
  expect((await inModsWorker<{ version: string }[]>({ op: "list", home }, WORKER))[0]?.version).toBe("1.1.0");

  writeFileSync(join(home, "mods", "notes", "index.tsx"), "export const mine = 1\n");
  await expect(inModsWorker({ op: "remove", home, name: "notes", force: false }, WORKER)).rejects.toThrow("notes has changes that aren't in its source");
  expect(existsSync(join(home, "mods", "notes"))).toBe(true);
  await inModsWorker({ op: "remove", home, name: "notes", force: true }, WORKER);
  expect(existsSync(join(home, "mods", "notes"))).toBe(false);
});
