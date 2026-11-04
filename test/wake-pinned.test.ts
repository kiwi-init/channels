import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type SeatRecord } from "../src/config.ts";
import { bindDirectory } from "../src/seats.ts";
import { wakeHarness } from "./wake-harness.ts";

setDefaultTimeout(60_000);

const w = wakeHarness();
const { calls, bindAs, until, seat, quiet, bin, home } = w;

const seatAtWork = (): SeatRecord | undefined => {
  const v = loadConfig().bindings?.["/work"];
  return Array.isArray(v) ? v[0] : v;
};

function dropped(): { dir: string; restore: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "kiwi-wake-drop-"));
  const path = join(dir, "codex");
  writeFileSync(path, `#!/bin/sh\necho dropped >> "$FAKE_WAKE_LOG"\necho "---" >> "$FAKE_WAKE_LOG"\n`);
  chmodSync(path, 0o755);
  const before = process.env.PATH;
  process.env.PATH = `${dir}:${before ?? ""}`;
  return {
    dir,
    restore: () => {
      process.env.PATH = before;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("a wake runs the harness binary its seat pinned, never a later one on PATH (#1302)", () => {
  test("a codex dropped earlier on PATH after the seat pinned its own is never run", async () => {
    bindAs({ harness: "codex", session: "thread-1", bin: join(bin, "codex") });
    const before = await quiet();
    const drop = dropped();
    try {
      await w.ownerCh.send("wake the pinned codex", { to: ["claude"] });
      await until("a wake", () => calls().length === before + 1);
      expect(calls().at(-1)?.[0]).toBe("codex");
    } finally {
      drop.restore();
    }
  });

  test("a seat from before pinning resolves its binary once, keeps it, and the next wake runs that one", async () => {
    bindAs({ harness: "codex", session: "thread-1" });
    const before = await quiet();
    await w.ownerCh.send("first wake pins", { to: ["claude"] });
    await until("the first wake", () => calls().length === before + 1);
    await until("the pinned path in the seat", () => seatAtWork()?.bin === join(bin, "codex"));
    const drop = dropped();
    try {
      const next = await quiet();
      await w.ownerCh.send("second wake", { to: ["claude"] });
      await until("the second wake", () => calls().length === next + 1);
      expect(calls().at(-1)?.[0]).toBe("codex");
    } finally {
      drop.restore();
    }
  });

  test("a pinned binary that's gone fails the wake with its path, and nothing on PATH runs instead", async () => {
    const gone = join(bin, "codex-removed");
    bindAs({ harness: "codex", session: "thread-1", bin: gone });
    const before = await quiet();
    try {
      await w.ownerCh.send("wake a removed codex", { to: ["claude"] });
      await until("the failed wake", async () => (await seat())?.wake.last?.ok === false);
      await until("the wake log's reason", () => existsSync(join(home, "wake.log")) && readFileSync(join(home, "wake.log"), "utf8").includes(gone));
      expect(calls().length).toBe(before);
    } finally {
      bindAs({ harness: "codex", session: "thread-1" });
    }
  });

  test("a Codex or OpenCode seat pins the binary on the PATH it was recorded from", () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-pin-seat-"));
    try {
      expect(bindDirectory(dir, { alias: "test", as: "claude", harness: "opencode", session: "s-1" })).toBe(true);
      const v = loadConfig().bindings?.[dir];
      expect((Array.isArray(v) ? v[0] : v)?.bin).toBe(join(bin, "opencode"));
      expect(bindDirectory(dir, { alias: "test", as: "claude", harness: "claude", session: "c-1" })).toBe(true);
      const c = loadConfig().bindings?.[dir];
      expect((Array.isArray(c) ? c.at(-1) : c)?.bin).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
