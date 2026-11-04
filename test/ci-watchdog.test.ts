import { describe, expect, test } from "bun:test";
import { noteLine, shouldKill, verdict, watching } from "../scripts/ci-watchdog.ts";

const FILES = ["test/a.test.ts", "ui/src/b.test.tsx"];

function seen(lines: string[], at = 0) {
  const w = watching(at);
  for (const l of lines) noteLine(w, l, at);
  return w;
}

describe("the unit job's watchdog (T3093)", () => {
  test("kills only once every file has reported and bun has said nothing for the silent span", () => {
    const all = seen(["##[group]test/a.test.ts:", "(pass) adds", "##[endgroup]", "\x1b[1mui/src/b.test.tsx:\x1b[0m", "(pass) shows"]);
    expect(shouldKill(FILES, all, 119_999)).toBe(false);
    expect(shouldKill(FILES, all, 120_000)).toBe(true);
    const half = seen(["./test/a.test.ts:", "(pass) adds"]);
    expect(shouldKill(FILES, half, 10 * 60_000)).toBe(false);
    const done = seen(["test/a.test.ts:", "ui/src/b.test.tsx:", "Ran 2 tests across 2 files. [1.00s]"]);
    expect(shouldKill(FILES, done, 10 * 60_000)).toBe(false);
  });

  test("after a kill the job passes only when every file reported and none failed", () => {
    expect(verdict(FILES, seen(["test/a.test.ts:", "ui/src/b.test.tsx:"]))).toEqual({ code: 0, why: "all 2 files reported and none failed" });
    expect(verdict(FILES, seen(["test/a.test.ts:", "ui/src/b.test.tsx:", "(fail) breaks [1ms]"])).code).toBe(1);
    expect(verdict(FILES, seen(["test/a.test.ts:"]))).toEqual({ code: 1, why: "1 file never reported: ui/src/b.test.tsx" });
  });
});
