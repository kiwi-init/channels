import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateConfig } from "../src/config.ts";
import { bindDirectory, bindingFor, seatsFor, seatsNear } from "../src/seats.ts";

let home = "";
let main = "";
let tree = "";
const prev = process.env.KIWI_HOME;
const plain = { who: {} };

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "init.defaultBranch=main", ...args], { cwd, stdio: "pipe" });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kiwi-worktree-"));
  main = join(home, "repo");
  tree = join(home, "scratch", "T7-fix");
  mkdirSync(main);
  git(main, "init", "-q");
  writeFileSync(join(main, "a.txt"), "a\n");
  git(main, "add", ".");
  git(main, "commit", "-qm", "a");
  git(main, "worktree", "add", "-q", "-b", "T7-fix", tree);
  mkdirSync(join(tree, "web", "src"), { recursive: true });
  process.env.KIWI_HOME = home;
  updateConfig((c) => {
    c.channels.ch = { roomId: "room", ownerPk: "o", ownerXpk: "x", epoch: 0, keys: {}, relay: "http://127.0.0.1:1", code: "mc2-x" };
    c.channels.other = { roomId: "room2", ownerPk: "o", ownerXpk: "x", epoch: 0, keys: {}, relay: "http://127.0.0.1:1", code: "mc2-y" };
  });
});

afterEach(() => {
  if (prev === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = prev;
  rmSync(home, { recursive: true, force: true });
});

test("from a git worktree outside the joined folder, kiwi finds the seat of the worktree's main checkout, deep folders too", () => {
  bindDirectory(main, { alias: "ch", as: "dev" });
  expect(bindingFor(tree, plain)).toMatchObject({ alias: "ch", as: "dev" });
  expect(bindingFor(join(tree, "web", "src"), plain)).toMatchObject({ alias: "ch", as: "dev" });
  expect(seatsNear(tree).map((b) => b.as)).toEqual(["dev"]);
});

test("two seats in the main checkout still need -c/--as from the worktree, as they do from the checkout", () => {
  bindDirectory(main, { alias: "ch", as: "dev", session: "s1" });
  bindDirectory(main, { alias: "other", as: "lead", session: "s2" });
  expect(bindingFor(tree, plain)).toBeNull();
  expect(bindingFor(main, plain)).toBeNull();
  expect(
    seatsNear(tree)
      .map((b) => `${b.as} in ${b.alias}`)
      .sort(),
  ).toEqual(["dev in ch", "lead in other"]);
});

test("a seat bound in the worktree itself wins over the main checkout's", () => {
  bindDirectory(main, { alias: "ch", as: "dev" });
  bindDirectory(tree, { alias: "other", as: "scout" });
  expect(bindingFor(tree, plain)).toMatchObject({ alias: "other", as: "scout" });
});

test("a folder that is no worktree, or a submodule's .git file, finds nothing it wasn't bound to", () => {
  bindDirectory(main, { alias: "ch", as: "dev" });
  const loose = join(home, "loose");
  mkdirSync(loose);
  expect(seatsFor(loose, plain)).toEqual([]);
  const sub = join(home, "sub");
  mkdirSync(join(home, "modules", "sub"), { recursive: true });
  mkdirSync(sub);
  writeFileSync(join(sub, ".git"), `gitdir: ${join(home, "modules", "sub")}\n`);
  expect(seatsFor(sub, plain)).toEqual([]);
});
