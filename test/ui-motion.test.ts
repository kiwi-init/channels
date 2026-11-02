import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const UI = join(import.meta.dir, "../ui/src");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.(css|tsx?)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

test("no ui style animates forever: an idle app draws nothing (#1379)", () => {
  const forever = files(UI).flatMap((f) =>
    readFileSync(f, "utf8")
      .split("\n")
      .flatMap((line, i) => (/\binfinite\b/.test(line) && /animation|iteration/i.test(line) ? [`${f.slice(UI.length + 1)}:${i + 1}: ${line.trim()}`] : [])),
  );
  expect(forever).toEqual([]);
});
