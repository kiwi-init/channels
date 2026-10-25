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
  test("a release or dev build sets KIWI_HOME and KIWI_INSTALL to ~/.kiwi-livewire, over whatever the environment said", () => {
    const got = livewireKiwiEnv(home, false);
    expect(got).toEqual({ KIWI_HOME: path.join(home, ".kiwi-livewire"), KIWI_INSTALL: path.join(home, ".kiwi-livewire", "bin") });
    for (const dir of Object.values(got)) expect(outside(dir)).toBe(true);
    const env: Record<string, string> = { KIWI_HOME: stable, KIWI_INSTALL: path.join(stable, "bin") };
    Object.assign(env, got);
    expect(env).toEqual(got);
  });

  test("a test build changes nothing: it keeps the throwaway HOME and KIWI_HOME its driver gives it", () => {
    expect(livewireKiwiEnv(home, true)).toEqual({});
  });

  test("it never adds its CLI folder to a shell profile, so stable's kiwi stays first on PATH", () => {
    expect(ensureOnPath()).toBeNull();
  });
});
