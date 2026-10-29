import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OWN_TMUX_DIR } from "@kiwi/core/terminals.ts";
import { keepTmux } from "../desktop/src/tmux.ts";
import { ownTmux } from "../src/daemon/hosted-tmux.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function folder(): string {
  const d = mkdtempSync(join(tmpdir(), "kiwi-desktop-tmux-"));
  dirs.push(d);
  return d;
}

function fakeTmux(dir: string, says: string): string {
  const bin = join(dir, "tmux");
  writeFileSync(bin, `#!/bin/sh\necho "${says}"\n`, { mode: 0o755 });
  return bin;
}

test.if(process.platform !== "win32")("the app's tmux lands in the Kiwi home under its version, where the daemon looks, and a working copy is kept", async () => {
  const [app, home] = [folder(), folder()];
  const bundled = fakeTmux(app, "tmux 3.8");
  const dest = join(home, OWN_TMUX_DIR, "tmux-3.8");
  expect(await keepTmux(bundled, home)).toBe(dest);
  expect(statSync(dest).mode & 0o777).toBe(0o755);
  expect(statSync(join(home, OWN_TMUX_DIR)).mode & 0o777).toBe(0o700);
  expect(ownTmux(home)).toEqual([dest]);
  const placed = statSync(dest).mtimeMs;
  await Bun.sleep(20);
  expect(await keepTmux(bundled, home)).toBe(dest);
  expect(statSync(dest).mtimeMs).toBe(placed);
  expect(readdirSync(join(home, OWN_TMUX_DIR))).toEqual(["tmux-3.8"]);
});

test.if(process.platform !== "win32")("a newer app adds its version next to the old one, which a running server may still need", async () => {
  const home = folder();
  await keepTmux(fakeTmux(folder(), "tmux 3.8"), home);
  await keepTmux(fakeTmux(folder(), "tmux 3.9a"), home);
  expect(ownTmux(home).map((bin) => bin.slice(bin.lastIndexOf("/") + 1))).toEqual(["tmux-3.9a", "tmux-3.8"]);
});

test.if(process.platform !== "win32")("a broken copy is replaced, and something that isn't tmux is never placed", async () => {
  const home = folder();
  const bundled = fakeTmux(folder(), "tmux 3.8");
  const dest = (await keepTmux(bundled, home))!;
  writeFileSync(dest, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  expect(await keepTmux(bundled, home)).toBe(dest);
  expect(readFileSync(dest, "utf8")).toContain("tmux 3.8");
  const other = folder();
  expect(await keepTmux(fakeTmux(folder(), "not tmux"), other)).toBeNull();
  expect(readdirSync(other)).toEqual([]);
});
