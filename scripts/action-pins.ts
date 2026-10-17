import { Glob } from "bun";
import { join } from "node:path";

export interface Unpinned {
  file: string;
  at: string;
  ref: string;
}

const PINNED = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.\-/]+@[0-9a-f]{40}$/;
const DIGEST = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/;

function record(x: unknown): Record<string, unknown> | null {
  return x !== null && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x)) : null;
}

function judge(file: string, at: string, uses: unknown): Unpinned[] {
  if (uses === undefined) return [];
  if (typeof uses !== "string") return [{ file, at, ref: JSON.stringify(uses) ?? String(uses) }];
  return uses.startsWith("./") || PINNED.test(uses) || DIGEST.test(uses) ? [] : [{ file, at, ref: uses }];
}

function stepsOf(file: string, at: string, steps: unknown): Unpinned[] {
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((step, i) => judge(file, `${at}.steps[${i}].uses`, record(step)?.uses));
}

export function unpinnedIn(doc: unknown, file: string): Unpinned[] {
  const top = record(doc);
  if (!top) return [];
  const jobs = Object.entries(record(top.jobs) ?? {}).flatMap(([name, raw]) => {
    const job = record(raw);
    return job ? [...judge(file, `jobs.${name}.uses`, job.uses), ...stepsOf(file, `jobs.${name}`, job.steps)] : [];
  });
  return [...jobs, ...stepsOf(file, "runs", record(top.runs)?.steps)];
}

export function workflowFiles(root: string): string[] {
  const patterns = [".github/workflows/*.{yml,yaml}", ".github/actions/**/action.{yml,yaml}"];
  return patterns.flatMap((p) => [...new Glob(p).scanSync({ cwd: root, dot: true })]).sort();
}

export async function check(root: string): Promise<Unpinned[]> {
  const found: Unpinned[] = [];
  for (const file of workflowFiles(root)) found.push(...unpinnedIn(Bun.YAML.parse(await Bun.file(join(root, file)).text()), file));
  return found;
}

if (import.meta.main) {
  const root = process.argv[2] ?? ".";
  const found = await check(root);
  const annotate = process.env.GITHUB_ACTIONS === "true";
  for (const u of found) {
    console.log(`${u.file} ${u.at}: ${u.ref} is not pinned to a full commit SHA (write owner/repo@<40-hex sha> # vN)`);
    if (annotate) console.log(`::error file=${u.file}::${u.at}: ${u.ref} is not pinned to a full commit SHA`);
  }
  if (found.length) {
    console.error(`${found.length} action reference(s) not pinned to a commit.`);
    process.exit(1);
  }
  console.log(`every action in ${workflowFiles(root).length} workflow and action files is pinned to a commit.`);
}
