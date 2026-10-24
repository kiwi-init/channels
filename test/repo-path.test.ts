import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

const OLD = ["ojowwalker77", "channels"].join("/");

test("the repo is kiwi-init/channels everywhere: no file names its old path, but CHANGELOG.md, whose history keeps the titles PRs had (T2037)", () => {
  const found = spawnSync("git", ["grep", "-n", "-F", OLD, "--", ".", ":!CHANGELOG.md"], { encoding: "utf8", cwd: new URL("..", import.meta.url).pathname });
  expect(found.status === 1 ? [] : found.stdout.trim().split("\n")).toEqual([]);
});
