import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { cleanup } from "../src/cleanup.ts";

const DEAD = 2 ** 22 + 4242;
const made: string[] = [];

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "kiwi-cleanup-"));
  made.push(root);
  const p = { home: join(root, "home"), bin: join(root, "home", "bin"), tmp: join(root, "tmp"), bun: join(root, "bun"), path: "" };
  for (const d of [p.home, p.bin, p.tmp, p.bun]) mkdirSync(d, { recursive: true });
  writeFileSync(join(p.bin, "kiwi"), "#!/bin/sh\n");
  chmodSync(join(p.bin, "kiwi"), 0o755);
  p.path = p.bin;
  return { root, ...p };
}

afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("kiwi cleanup", () => {
  test("a fresh install has nothing to clean up", () => {
    const s = sandbox();
    expect(cleanup(s)).toEqual({ removed: [], warnings: [] });
  });

  test("copies an update left half-way are removed, the binary stays", () => {
    const s = sandbox();
    writeFileSync(join(s.bin, "kiwi.new-123"), "x");
    writeFileSync(join(s.bin, "kiwi.exe.new-9"), "x");
    expect(cleanup(s).removed.sort()).toEqual([join(s.bin, "kiwi.exe.new-9"), join(s.bin, "kiwi.new-123")]);
    expect(existsSync(join(s.bin, "kiwi"))).toBe(true);
  });

  test("interrupted CLI upgrade staging goes while a running upgrade and other folders stay", () => {
    const s = sandbox();
    const dead = join(s.bin, `.kiwi-upgrade-${DEAD}-abc123`);
    const live = join(s.bin, `.kiwi-upgrade-${process.pid}-abc123`);
    const other = join(s.bin, ".kiwi-upgrade-unrelated");
    for (const dir of [dead, live, other]) mkdirSync(dir);
    expect(cleanup(s).removed).toEqual([dead]);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(other)).toBe(true);
  });

  test("older clients' listener files go once their process is gone; live ones and handed-over marks stay", () => {
    const s = sandbox();
    const listeners = join(s.home, "listeners");
    const hooks = join(s.home, "listen-hooks");
    mkdirSync(listeners);
    mkdirSync(hooks);
    writeFileSync(join(listeners, `ch.dead.${DEAD}`), "{}");
    writeFileSync(join(listeners, `ch.live.${process.pid}`), "{}");
    writeFileSync(join(hooks, "ch.dead.s1"), String(DEAD));
    writeFileSync(join(hooks, "ch.live.s1.delivered"), "7");
    const { removed } = cleanup(s);
    expect(removed.sort()).toEqual([join(hooks, "ch.dead.s1"), join(listeners, `ch.dead.${DEAD}`)]);
    expect(existsSync(join(listeners, `ch.live.${process.pid}`))).toBe(true);
    expect(existsSync(join(hooks, "ch.live.s1.delivered"))).toBe(true);
  });

  test("an empty listeners folder is removed with its last dead file", () => {
    const s = sandbox();
    const listeners = join(s.home, "listeners");
    mkdirSync(listeners);
    writeFileSync(join(listeners, `ch.dead.${DEAD}`), "{}");
    expect(cleanup(s).removed).toContain(listeners);
    expect(existsSync(listeners)).toBe(false);
  });

  test("the app's update downloads older than a day go; a fresh one and other folders stay", () => {
    const s = sandbox();
    const now = Date.now();
    for (const d of ["kiwi-update-old", "kiwi-update-new", "someone-else"]) mkdirSync(join(s.tmp, d));
    const old = (now - 2 * 86_400_000) / 1000;
    utimesSync(join(s.tmp, "kiwi-update-old"), old, old);
    utimesSync(join(s.tmp, "someone-else"), old, old);
    expect(cleanup({ ...s, now }).removed).toEqual([join(s.tmp, "kiwi-update-old")]);
  });

  test("an old Bun install of kiwi loses its command; anyone else's Bun commands stay", () => {
    const s = sandbox();
    const globals = join(s.bun, "install", "global", "node_modules");
    for (const [pkg, name] of [
      ["channel-one", "channel-one"],
      ["other", "something-else"],
    ] as const) {
      mkdirSync(join(globals, pkg, "src", "cli"), { recursive: true });
      writeFileSync(join(globals, pkg, "package.json"), JSON.stringify({ name }));
      writeFileSync(join(globals, pkg, "src", "cli", "main.ts"), "");
    }
    mkdirSync(join(s.bun, "bin"));
    symlinkSync(join(globals, "channel-one", "src", "cli", "main.ts"), join(s.bun, "bin", "mc"));
    symlinkSync(join(globals, "other", "src", "cli", "main.ts"), join(s.bun, "bin", "kiwi"));
    const out = cleanup(s);
    expect(out.removed).toEqual([join(s.bun, "bin", "mc")]);
    expect(out.warnings).toEqual([`an old Bun install of kiwi stays in ${join(globals, "channel-one")}: \`bun remove -g channel-one\` removes it`]);
    expect(existsSync(join(s.bun, "bin", "kiwi"))).toBe(true);
  });

  test("an old Bun install is found when its folder is reached through a symlink, as macOS's /var is", () => {
    const s = sandbox();
    const real = join(s.root, "real-bun");
    const bun = join(s.root, "linked-bun");
    const globals = join(real, "install", "global", "node_modules");
    mkdirSync(join(globals, "channel-one", "src", "cli"), { recursive: true });
    writeFileSync(join(globals, "channel-one", "package.json"), JSON.stringify({ name: "channel-one" }));
    writeFileSync(join(globals, "channel-one", "src", "cli", "main.ts"), "");
    mkdirSync(join(real, "bin"));
    symlinkSync(real, bun);
    symlinkSync(join(bun, "install", "global", "node_modules", "channel-one", "src", "cli", "main.ts"), join(bun, "bin", "mc"));
    const out = cleanup({ ...s, bun });
    expect(out.removed).toEqual([join(bun, "bin", "mc")]);
    expect(out.warnings).toEqual([`an old Bun install of kiwi stays in ${join(bun, "install", "global", "node_modules", "channel-one")}: \`bun remove -g channel-one\` removes it`]);
  });

  test("another kiwi ahead on PATH is named, never removed; one after it, or a link to it, is fine", () => {
    const s = sandbox();
    const ahead = join(s.root, "ahead");
    const after = join(s.root, "after");
    const linked = join(s.root, "linked");
    for (const d of [ahead, after, linked]) mkdirSync(d);
    writeFileSync(join(ahead, "kiwi"), "");
    writeFileSync(join(after, "kiwi"), "");
    symlinkSync(join(s.bin, "kiwi"), join(linked, "kiwi"));
    const out = cleanup({ ...s, path: [linked, ahead, s.bin, after].join(delimiter) });
    expect(out.removed).toEqual([]);
    expect(out.warnings).toEqual([`${join(ahead, "kiwi")} comes before ${join(s.bin, "kiwi")} on your PATH, so plain \`kiwi\` runs that one: remove it`]);
    expect(existsSync(join(ahead, "kiwi"))).toBe(true);
  });
});

test("kiwi cleanup --quiet, as the installer runs it, takes --quiet even when it removed something (issue #714)", () => {
  const s = sandbox();
  mkdirSync(join(s.home, "listeners"), { recursive: true });
  writeFileSync(join(s.home, "listeners", `seat.${DEAD}`), "");
  const r = Bun.spawnSync([process.execPath, join(import.meta.dir, "..", "src", "cli", "main.ts"), "cleanup", "--quiet"], {
    cwd: s.root,
    env: { ...process.env, KIWI_HOME: s.home },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(r.exitCode).toBe(0);
  expect(r.stdout.toString()).toContain("removed");
  expect(r.stderr.toString()).not.toContain("doesn't use --quiet");
});
