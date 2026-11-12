import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Seat } from "../src/daemon/seat.ts";
import { seatWakes } from "../src/daemon/wake.ts";

describe("a wake attempt that ends on an error", () => {
  const home = mkdtempSync(join(tmpdir(), "kiwi-wake-error-"));
  const prev = process.env.KIWI_HOME;

  beforeAll(() => {
    process.env.KIWI_HOME = home;
  });

  afterAll(() => {
    if (prev === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  });

  test("leaves one line in wake.log saying why, so an agent left asleep leaves a trace", async () => {
    writeFileSync(join(home, "config.json"), "{ not json");
    const seat = { key: "test\u0000claude", alias: "test", agent: "claude", wakeVia: "codex-queue", wakeTimer: null, waking: false, wakeAgain: false, lastWake: null } as unknown as Seat;
    const { scheduleWake } = seatWakes({ dir: home, wakeDelayMs: 0, wakeGapMs: 0, wakeOutstandingMs: 0, stopped: () => false, current: () => true });
    scheduleWake(seat);
    const log = join(home, "wake.log");
    for (const end = Date.now() + 5_000; !existsSync(log) && Date.now() < end;) await Bun.sleep(10);
    const rows = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((line) => line.split("\t"));
    expect(rows.length).toBe(1);
    const [at, alias, agent, via, unread, result, why, cursor] = rows[0]!;
    expect(Number.isNaN(Date.parse(at!))).toBe(false);
    expect([alias, agent, via, unread, result, cursor]).toEqual(["test", "claude", "codex-queue", "0", "failed", "0"]);
    expect(why).toStartWith("the wake attempt ended on an error: ");
    expect(why).toContain("config.json isn't valid JSON");
    expect(seat.wakeTimer).toBeNull();
    expect(seat.waking).toBe(false);
  });
});
