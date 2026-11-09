import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("Android translates every label the core gives a question for you (#759)", () => {
  const asks = read("packages/app/src/asks.ts");
  const labels = [...asks.matchAll(/"([^"]+ for (?:you|everyone))"/g)].map((m) => m[1]!);
  expect(labels.length).toBeGreaterThanOrEqual(8);
  const mapped = read("android/app/src/main/java/com/kiwiinit/channels/ui/Needs.kt");
  for (const label of new Set(labels)) expect(mapped).toContain(`"${label}" to R.string.`);
});
