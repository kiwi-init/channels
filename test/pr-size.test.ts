import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { type Api, diffFiles, isTest, labelPr, measure, parseNumstat, SIZES, sizeOf, syncLabels } from "../scripts/pr-size.ts";

const temp = mkdtempSync(join(tmpdir(), "kiwi-pr-size-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8" }).trim();

const put = (root: string, path: string, body: string): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), body);
};

const lines = (n: number, tag = "line"): string => Array.from({ length: n }, (_, i) => `${tag} ${i}`).join("\n") + "\n";

interface Call {
  method: string;
  path: string;
  body?: unknown;
}

const fake = (answers: Record<string, unknown>): { api: Api; calls: Call[] } => {
  const calls: Call[] = [];
  const api: Api = async (method, path, body) => {
    calls.push(body === undefined ? { method, path } : { method, path, body });
    return answers[`${method} ${path}`] ?? null;
  };
  return { api, calls };
};

describe("sizes", () => {
  test("each size starts where the one before it ends", () => {
    const cases: [number, string][] = [
      [0, "size:XS"],
      [9, "size:XS"],
      [10, "size:S"],
      [29, "size:S"],
      [30, "size:M"],
      [99, "size:M"],
      [100, "size:L"],
      [499, "size:L"],
      [500, "size:XL"],
      [999, "size:XL"],
      [1000, "size:XXL"],
      [250_000, "size:XXL"],
    ];
    for (const [n, label] of cases) expect([n, sizeOf(n)]).toEqual([n, label]);
  });

  test("labels fit GitHub: unique names, hex colours, descriptions under 100 characters", () => {
    expect(new Set(SIZES.map((s) => s.name)).size).toBe(SIZES.length);
    for (const s of SIZES) {
      expect(s.color).toMatch(/^[0-9a-f]{6}$/);
      expect(s.description.length).toBeLessThanOrEqual(100);
    }
  });
});

describe("isTest", () => {
  test("test folders, test files and the browser checks count as tests", () => {
    for (const path of [
      "test/github-prs.test.ts",
      "test/__snapshots__/a.snap",
      "test/fixtures/minisign/key.pub",
      "ui/src/chat/feed.test.tsx",
      "packages/app/src/store.test.ts",
      "root.test.ts",
      "desktop/eb-tests/bridge-rpc.test.ts",
      "ios/ChannelsUITests/GestureTests.swift",
      "android/app/src/test/java/com/kiwiinit/channels/DockTest.kt",
      "android/app/src/androidTest/java/A.kt",
      "scripts/ui-stash-click.ts",
      "scripts/ui-scroll-fps.ts",
    ])
      expect([path, isTest(path)]).toEqual([path, true]);
  });

  test("code, the bundle budget and test-sounding names outside test folders are code", () => {
    for (const path of ["src/cli/main.ts", "scripts/ui-bundle.ts", "scripts/ci-tests.ts", "ui/src/test.ts", "src/latest/a.ts", "android/app/src/main/java/A.kt", ".github/workflows/pr-size.yml"])
      expect([path, isTest(path)]).toEqual([path, false]);
  });
});

describe("parseNumstat", () => {
  test("reads plain entries, binaries as zero, renames by their new path, and paths with tabs", () => {
    const z = ["3\t1\tsrc/a.ts", "-\t-\tlogo.png", "2\t0\t", "old/b.ts", "test/b.test.ts", "1\t1\tweird\tname.ts", ""].join("\0");
    expect(parseNumstat(z)).toEqual([
      { path: "src/a.ts", lines: 4 },
      { path: "logo.png", lines: 0 },
      { path: "test/b.test.ts", lines: 2 },
      { path: "weird\tname.ts", lines: 2 },
    ]);
  });

  test("an empty diff has no files", () => {
    expect(parseNumstat("")).toEqual([]);
  });
});

describe("measure", () => {
  test("a PR with code and tests is sized by its code", () => {
    expect(
      measure([
        { path: "src/a.ts", lines: 12 },
        { path: "test/a.test.ts", lines: 400 },
      ]),
    ).toEqual({ code: 12, tests: 400, lines: 12, label: "size:S" });
  });

  test("a tests-only PR is sized by its tests", () => {
    expect(measure([{ path: "test/a.test.ts", lines: 120 }])).toEqual({ code: 0, tests: 120, lines: 120, label: "size:L" });
  });

  test("no line changes is XS", () => {
    expect(measure([{ path: "logo.png", lines: 0 }])).toEqual({ code: 0, tests: 0, lines: 0, label: "size:XS" });
  });
});

describe("against a real repository", () => {
  const origin = join(temp, "origin.git");
  const work = join(temp, "work");
  const clone = join(temp, "clone");
  mkdirSync(work);
  git(temp, "init", "--bare", "-q", origin);
  git(work, "init", "-q");
  put(work, "src/a.ts", lines(40));
  put(work, "src/moved.ts", lines(60, "moved"));
  put(work, "test/a.test.ts", lines(5));
  git(work, "add", "-A");
  git(work, "commit", "-qm", "base");
  git(work, "push", "-q", origin, "HEAD:refs/heads/main");
  git(work, "checkout", "-qb", "feature");
  const indented = lines(40).replaceAll("line", "  line").split("\n");
  put(work, "src/a.ts", [...indented.slice(0, 20), "", "", ...indented.slice(20)].join("\n") + lines(7, "new"));
  renameSync(join(work, "src/moved.ts"), join(work, "src/renamed.ts"));
  put(work, "test/a.test.ts", lines(5) + lines(300, "check"));
  git(work, "add", "-A");
  git(work, "commit", "-qm", "feature");
  git(work, "push", "-q", origin, "HEAD:refs/pull/7/head");
  git(work, "checkout", "-q", "main");
  put(work, "src/later.ts", lines(500));
  git(work, "add", "-A");
  git(work, "commit", "-qm", "main moves on");
  git(work, "push", "-q", origin, "HEAD:refs/heads/main");
  git(temp, "clone", "-q", origin, clone);

  test("whitespace and renames cost nothing, main's later commits are not the PR's, tests are left out", () => {
    git(clone, "fetch", "-q", "origin", "refs/pull/7/head");
    const files = diffFiles(clone, "origin/main", "FETCH_HEAD");
    expect(files).toEqual([
      { path: "src/a.ts", lines: 7 },
      { path: "src/renamed.ts", lines: 0 },
      { path: "test/a.test.ts", lines: 300 },
    ]);
    expect(measure(files)).toEqual({ code: 7, tests: 300, lines: 7, label: "size:XS" });
  });

  test("labelPr swaps the old size label for the new one and keeps other labels", async () => {
    const { api, calls } = fake({ "GET /pulls/7": { number: 7, base: { ref: "main" }, labels: [{ name: "size:L" }, { name: "bug" }] } });
    expect((await labelPr(api, clone, 7)).label).toBe("size:XS");
    expect(calls).toEqual([
      { method: "GET", path: "/pulls/7" },
      { method: "DELETE", path: "/issues/7/labels/size%3AL" },
      { method: "POST", path: "/issues/7/labels", body: { labels: ["size:XS"] } },
    ]);
  });

  test("labelPr leaves a PR that already has its size alone", async () => {
    const { api, calls } = fake({ "GET /pulls/7": { number: 7, base: { ref: "main" }, labels: [{ name: "size:XS" }] } });
    await labelPr(api, clone, 7);
    expect(calls).toEqual([{ method: "GET", path: "/pulls/7" }]);
  });
});

describe("syncLabels", () => {
  test("creates missing labels, fixes stale ones and leaves matching ones alone", async () => {
    const [xs, s] = SIZES;
    const { api, calls } = fake({
      [`GET /labels/${encodeURIComponent(xs?.name ?? "")}`]: { name: xs?.name, color: xs?.color, description: xs?.description },
      [`GET /labels/${encodeURIComponent(s?.name ?? "")}`]: { name: s?.name, color: "ededed", description: "" },
    });
    await syncLabels(api);
    const writes = calls.filter((c) => c.method !== "GET");
    expect(writes[0]).toEqual({ method: "PATCH", path: "/labels/size%3AS", body: { color: s?.color, description: s?.description } });
    expect(writes.slice(1).map((c) => [c.method, record(c.body).name])).toEqual([
      ["POST", "size:M"],
      ["POST", "size:L"],
      ["POST", "size:XL"],
      ["POST", "size:XXL"],
    ]);
  });
});

function record(x: unknown): Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x)) : {};
}
