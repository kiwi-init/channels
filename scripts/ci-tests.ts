import { Glob } from "bun";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FLOWS } from "./ci-flows.ts";
import { share, type Timings } from "./ci-shards.ts";

const TIMINGS = "test/timings.json";
const [group = "", ...flags] = process.argv.slice(2);
const shard = flags.map((f) => /^--shard=([1-9]\d*)\/([1-9]\d*)$/.exec(f)).find(Boolean);
const record = flags.includes("--update-timings");
const all = [...new Glob("test/*.test.ts").scanSync(), ...new Glob("web/src/**/*.test.{ts,tsx}").scanSync()].sort();
const slow = new Set(
  Object.values(FLOWS)
    .flat()
    .map((name) => `test/${name}.test.ts`),
);
const picked = group === "all" ? all : group === "unit" ? all.filter((f) => !slow.has(f)) : FLOWS[group]?.map((name) => `test/${name}.test.ts`);
if (!picked || flags.some((f) => f !== "--update-timings" && !/^--shard=/.test(f)) || flags.some((f) => /^--shard=/.test(f)) !== Boolean(shard) || (shard && Number(shard[1]) > Number(shard[2]))) {
  console.error(`usage: bun scripts/ci-tests.ts ${["all", "unit", ...Object.keys(FLOWS)].join(" | ")} [--shard=I/N] [--update-timings]`);
  process.exit(2);
}
const missing = picked.filter((f) => !all.includes(f));
if (missing.length) {
  console.error(`missing test files: ${missing.join(", ")}`);
  process.exit(1);
}

const files = shard ? share(picked, Number(shard[1]), Number(shard[2]), existsSync(TIMINGS) ? (JSON.parse(readFileSync(TIMINGS, "utf8")) as Timings).files : {}) : picked;

function tmpBehindSymlink(): { dir: string; cleanup: () => void } {
  const tmp = resolve(tmpdir());
  if (realpathSync(tmp) !== tmp) return { dir: tmp, cleanup: () => {} };
  const real = mkdtempSync(join(tmp, "kiwi-tmp-"));
  const link = `${real}.link`;
  symlinkSync(real, link);
  return {
    dir: link,
    cleanup: () => {
      rmSync(link, { force: true });
      rmSync(real, { recursive: true, force: true });
    },
  };
}

const tmp = tmpBehindSymlink();
const timings = existsSync(TIMINGS) || record ? [`--timings=${TIMINGS}`, ...(record ? ["--update-timings"] : [])] : [];
const proc = Bun.spawn(["bun", "test", "--parallel", ...timings, ...files.map((f) => `./${f}`)], {
  stdio: ["inherit", "inherit", "pipe"],
  env: { ...process.env, TMPDIR: tmp.dir },
});
const decoder = new TextDecoder();
let tail = "";
const reading = (async () => {
  for await (const chunk of proc.stderr) {
    process.stderr.write(chunk);
    tail = (tail + decoder.decode(chunk, { stream: true })).slice(-4096);
  }
})();
const code = await proc.exited;
await Promise.race([reading, Bun.sleep(2000)]);
tmp.cleanup();
const ran = [...tail.matchAll(/Ran \d+ tests? across (\d+) files?\./g)].at(-1)?.[1];
if (code === 0 && Number(ran) !== files.length) {
  console.error(`bun test exited 0 after ${ran ?? "an unknown number"} of ${files.length} files: a test ended the run early`);
  process.exit(1);
}
process.exit(code);
