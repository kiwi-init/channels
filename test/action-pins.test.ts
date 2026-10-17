import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, unpinnedIn } from "../scripts/action-pins.ts";

const SHA = "11d5960a326750d5838078e36cf38b85af677262";
const yaml = (text: string): unknown => Bun.YAML.parse(text);

describe("unpinnedIn", () => {
  test("tags and branches in steps are unpinned, a full SHA with a note is pinned", () => {
    const doc = yaml(`jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n      - uses: oven-sh/setup-bun@main\n      - uses: actions/cache@${SHA} # v4\n      - run: echo hi\n`);
    expect(unpinnedIn(doc, "ci.yml")).toEqual([
      { file: "ci.yml", at: "jobs.a.steps[0].uses", ref: "actions/checkout@v4" },
      { file: "ci.yml", at: "jobs.a.steps[1].uses", ref: "oven-sh/setup-bun@main" },
    ]);
  });

  test("flow style, quoted keys and a value on the next line are read like any other step", () => {
    const doc = yaml(`jobs:\n  a:\n    steps:\n      - {uses: actions/checkout@v4}\n      - "uses": actions/cache@v4\n      - uses:\n          actions/upload-artifact@v4\n`);
    expect(unpinnedIn(doc, "ci.yml").map((u) => u.ref)).toEqual(["actions/checkout@v4", "actions/cache@v4", "actions/upload-artifact@v4"]);
  });

  test("a reusable workflow call is a job's uses, and a local one passes", () => {
    const doc = yaml(`jobs:\n  remote: {uses: org/repo/.github/workflows/build.yml@v1}\n  local:\n    uses: ./.github/workflows/build.yml\n`);
    expect(unpinnedIn(doc, "ci.yml")).toEqual([{ file: "ci.yml", at: "jobs.remote.uses", ref: "org/repo/.github/workflows/build.yml@v1" }]);
  });

  test("matrix data named uses is not an action", () => {
    const doc = yaml(`jobs:\n  a:\n    strategy:\n      matrix:\n        include:\n          - uses: whatever@v1\n    steps:\n      - uses: actions/checkout@${SHA}\n`);
    expect(unpinnedIn(doc, "ci.yml")).toEqual([]);
  });

  test("a short SHA is unpinned, and docker needs a digest", () => {
    const digest = "a".repeat(64);
    const doc = yaml(`jobs:\n  a:\n    steps:\n      - uses: actions/checkout@11d5960\n      - uses: docker://alpine:3\n      - uses: docker://alpine@sha256:${digest}\n`);
    expect(unpinnedIn(doc, "ci.yml").map((u) => u.ref)).toEqual(["actions/checkout@11d5960", "docker://alpine:3"]);
  });

  test("a composite action's steps are checked", () => {
    const doc = yaml(`runs:\n  using: composite\n  steps:\n    - uses: oven-sh/setup-bun@v2\n    - uses: ./.github/actions/other\n`);
    expect(unpinnedIn(doc, "action.yml")).toEqual([{ file: "action.yml", at: "runs.steps[0].uses", ref: "oven-sh/setup-bun@v2" }]);
  });
});

test("check reads every workflow and composite action under .github", async () => {
  const root = mkdtempSync(join(tmpdir(), "kiwi-pins-"));
  try {
    mkdirSync(join(root, ".github/workflows"), { recursive: true });
    mkdirSync(join(root, ".github/actions/setup"), { recursive: true });
    writeFileSync(join(root, ".github/workflows/ci.yml"), `jobs:\n  a:\n    steps:\n      - uses: actions/checkout@${SHA}\n`);
    writeFileSync(join(root, ".github/workflows/release.yaml"), "jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n");
    writeFileSync(join(root, ".github/actions/setup/action.yml"), "runs:\n  steps:\n    - uses: oven-sh/setup-bun@v2\n");
    expect((await check(root)).map((u) => `${u.file} ${u.ref}`)).toEqual([".github/actions/setup/action.yml oven-sh/setup-bun@v2", ".github/workflows/release.yaml actions/checkout@v4"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
