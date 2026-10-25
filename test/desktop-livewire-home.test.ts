import { describe, expect, test } from "bun:test";
import path from "node:path";

import { ensureOnPath } from "../desktop/src/cli.ts";
import { livewireKiwiEnv } from "../desktop/src/livewire-home.ts";

const home = "/Users/someone";
const stable = path.join(home, ".kiwi");
const outside = (dir: string): boolean => {
  const rel = path.relative(stable, dir);
  return rel.startsWith("..") || path.isAbsolute(rel);
};

describe("Channels Livewire keeps its kiwi CLI and daemon out of ~/.kiwi (T839)", () => {
  test("a release build uses ~/.kiwi-livewire, even when KIWI_HOME or KIWI_INSTALL point at ~/.kiwi", () => {
    for (const env of [{}, { KIWI_HOME: stable }, { KIWI_HOME: stable, KIWI_INSTALL: path.join(stable, "bin") }]) {
      const got = livewireKiwiEnv(env, home, false);
      expect(got).toEqual({ KIWI_HOME: path.join(home, ".kiwi-livewire"), KIWI_INSTALL: path.join(home, ".kiwi-livewire", "bin") });
      expect(outside(got.KIWI_HOME)).toBe(true);
      expect(outside(got.KIWI_INSTALL)).toBe(true);
    }
  });

  test("a test build keeps the throwaway homes its tests give it", () => {
    expect(livewireKiwiEnv({ KIWI_HOME: "/tmp/t/.kiwi", KIWI_INSTALL: "/tmp/t/bin" }, home, true)).toEqual({ KIWI_HOME: "/tmp/t/.kiwi", KIWI_INSTALL: "/tmp/t/bin" });
    expect(livewireKiwiEnv({}, home, true).KIWI_HOME).toBe(path.join(home, ".kiwi-livewire"));
  });

  test("it never adds its CLI folder to a shell profile, so stable's kiwi stays first on PATH", () => {
    expect(ensureOnPath()).toBeNull();
  });
});
