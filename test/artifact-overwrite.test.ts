import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Step = { uses?: string; with?: Record<string, unknown> };
type Workflow = { jobs: Record<string, { steps?: Step[] }> };

const dir = ".github/workflows";
const uploads = readdirSync(dir)
  .filter((f) => /\.ya?ml$/.test(f))
  .flatMap((file) => {
    const wf = Bun.YAML.parse(readFileSync(join(dir, file), "utf8")) as Workflow;
    return Object.entries(wf.jobs).flatMap(([job, j]) =>
      (j.steps ?? []).filter((s) => s.uses?.startsWith("actions/upload-artifact@")).map((s) => ({ at: `${file} ${job} ${String(s.with?.name)}`, overwrite: s.with?.overwrite })),
    );
  });

test("every artifact upload replaces the one an earlier attempt left, so a re-run's download reads the re-run", () => {
  expect(uploads.length).toBeGreaterThanOrEqual(7);
  expect(uploads.filter((u) => u.overwrite !== true).map((u) => u.at)).toEqual([]);
});
