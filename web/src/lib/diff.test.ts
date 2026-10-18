import { describe, expect, test } from "bun:test"

import { fileStats } from "./diff"

describe("a PR card's files", () => {
  test("each file's additions and deletions, from a unified diff, headers not counted", () => {
    const diff = [
      "diff --git a/web/src/a.ts b/web/src/a.ts",
      "index 1..2 100644",
      "--- a/web/src/a.ts",
      "+++ b/web/src/a.ts",
      "@@ -1,2 +1,3 @@",
      " keep",
      "-old",
      "+new",
      "+more",
      "diff --git a/docs/old.md b/docs/new.md",
      "similarity index 90%",
      "--- a/docs/old.md",
      "+++ b/docs/new.md",
      "@@ -4 +4 @@",
      "-a line",
      "+the line",
    ].join("\n")
    expect(fileStats(diff)).toEqual([
      { path: "web/src/a.ts", additions: 2, deletions: 1 },
      { path: "docs/new.md", additions: 1, deletions: 1 },
    ])
    expect(fileStats("")).toEqual([])
  })
})
