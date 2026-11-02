import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChannelConfig, Config } from "../src/config.ts";
import { gitRepos, launchFolders, remoteFolders, seatFolders, withLaunchRoot, withoutLaunchRoot } from "../src/launch/folders.ts";

const dir = mkdtempSync(join(tmpdir(), "kiwi-folders-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const folder = (name: string): string => {
  const path = join(dir, name);
  mkdirSync(path, { recursive: true });
  return path;
};

const channel = (roomId: string): ChannelConfig => ({ roomId, relay: "https://relay.example", code: "mc2-x" }) as ChannelConfig;

describe("the folders a channel's seats work in on this computer", () => {
  test("most recently seen first, one per folder, only this channel's, only folders that still exist", () => {
    const app = folder("app");
    const site = folder("site");
    const other = folder("other");
    const cfg: Config = {
      channels: { dev: channel("room-dev"), ops: channel("room-ops") },
      bindings: {
        [app]: [
          { alias: "dev", as: "otter", at: 10, seen: 50 },
          { alias: "dev", as: "llama", at: 20 },
        ],
        [site]: { alias: "dev", as: "marmot", at: 5, seen: 90 },
        [other]: { alias: "ops", as: "orca", seen: 100 },
        [join(dir, "gone")]: { alias: "dev", as: "ghost", seen: 200 },
      },
    };
    expect(seatFolders(cfg, "room-dev")).toEqual([site, app]);
    expect(seatFolders(cfg, "room-ops")).toEqual([other]);
    expect(seatFolders(cfg)).toEqual([other, site, app]);
    expect(seatFolders({ channels: {} }, "room-dev")).toEqual([]);
  });
});

describe("the folders an agent can be started in on a computer none has worked on yet", () => {
  const home = folder("home");
  const repo = (path: string, at: number, file = false) => {
    const dir = join(home, path);
    mkdirSync(dir, { recursive: true });
    if (file) writeFileSync(join(dir, ".git"), "gitdir: /elsewhere\n");
    else mkdirSync(join(dir, ".git"));
    utimesSync(join(dir, ".git"), at, at);
    return dir;
  };
  const shallow = repo("notes", 100);
  const deep = repo("www/team/app", 300);
  const worktree = repo("www/team-T7", 200, true);
  repo("www/team/app/vendor/lib", 400);
  repo("a/b/c/too-deep", 500);
  repo(".config/hidden", 600);
  repo("www/node_modules/pkg", 700);
  repo("Library/Caches/thing", 800);
  mkdirSync(join(home, "outside/real"), { recursive: true });
  mkdirSync(join(home, "outside/real/.git"));
  utimesSync(join(home, "outside/real/.git"), 150, 150);
  symlinkSync(join(home, "outside/real"), join(home, "www/linked"));

  test("the home folder's git repos, three levels down, newest first: not hidden folders, node_modules, Library, a repo's insides or a symlink", () => {
    expect(gitRepos(home)).toEqual([deep, worktree, join(home, "outside/real"), shallow]);
  });

  test("a channel's own folders first, then the ones added by hand, then the home repos, each once", () => {
    const added = folder("added");
    const cfg: Config = { channels: { dev: channel("room-dev") }, bindings: { [deep]: { alias: "dev", as: "otter", seen: 5 } }, launchRoots: [added, join(dir, "gone-root")] };
    expect(launchFolders(cfg, "room-dev", home)).toEqual([deep, added, worktree, join(home, "outside/real"), shallow]);
  });

  test("another device starts agents only where seats work and in the folders added by hand, never in the home repos (#1303)", () => {
    const added = folder("added");
    const cfg: Config = { channels: { dev: channel("room-dev") }, bindings: { [deep]: { alias: "dev", as: "otter", seen: 5 } }, launchRoots: [added, join(dir, "gone-root")] };
    expect(remoteFolders(cfg, "room-dev")).toEqual([deep, added]);
    expect(remoteFolders({ channels: {} })).toEqual([]);
  });

  test("a folder is added by its real path, once, never the whole disk or something that isn't a folder; removing it by either path", () => {
    const added = folder("by-hand");
    const link = join(dir, "by-hand-link");
    symlinkSync(added, link);
    const once = withLaunchRoot({ channels: {} }, link);
    if (typeof once === "string") throw new Error(once);
    expect(once.launchRoots).toEqual([realpathSync(added)]);
    expect(withLaunchRoot(once, added)).toEqual(once);
    expect(withLaunchRoot(once, "/")).toBe("a launch folder can't be the whole disk: pick a folder in it");
    writeFileSync(join(dir, "a-file"), "x");
    expect(withLaunchRoot(once, join(dir, "a-file"))).toBe(`${join(dir, "a-file")} isn't a folder on this computer`);
    expect(withoutLaunchRoot(once, link)).toEqual({ channels: {} });
    expect(withoutLaunchRoot({ channels: {}, launchRoots: [join(dir, "gone")] }, join(dir, "gone"))).toEqual({ channels: {} });
  });
});

describe("kiwi folders for the app's Settings (T237)", () => {
  const MAIN_TS = join(import.meta.dir, "..", "src", "cli", "main.ts");
  const home = mkdtempSync(join(tmpdir(), "kiwi-folders-cli-"));
  afterAll(() => rmSync(home, { recursive: true, force: true }));
  const kiwi = (args: string[]) => {
    const r = Bun.spawnSync([process.execPath, MAIN_TS, ...args], { cwd: home, env: { ...process.env, KIWI_HOME: home }, stdout: "pipe", stderr: "pipe" });
    return { code: r.exitCode, out: r.stdout.toString() };
  };

  test("kiwi folders added --json lists the added folders, and add and remove answer with the list they leave", () => {
    const work = realpathSync(folder("cli-work"));
    expect(JSON.parse(kiwi(["folders", "added", "--json"]).out)).toEqual({ roots: [] });
    expect(JSON.parse(kiwi(["folders", "add", work, "--json"]).out)).toEqual({ roots: [work] });
    expect(JSON.parse(kiwi(["folders", "added", "--json"]).out)).toEqual({ roots: [work] });
    expect(kiwi(["folders", "add", join(dir, "not-there"), "--json"]).code).not.toBe(0);
    expect(JSON.parse(kiwi(["folders", "remove", work, "--json"]).out)).toEqual({ roots: [] });
    expect(kiwi(["folders", "added"]).out.trim()).toBe("no folders added");
  });
});
