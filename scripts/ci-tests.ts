import { Glob } from "bun";
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FLOWS } from "./ci-flows.ts";

const [group = "", ...extra] = process.argv.slice(2);
const all = [...new Glob("test/*.test.ts").scanSync(), ...new Glob("web/src/**/*.test.{ts,tsx}").scanSync()].sort();
const flows = FLOWS.map((name) => `test/${name}.test.ts`);
const files = group === "all" ? all : group === "unit" ? all.filter((f) => !flows.includes(f)) : group === "flows" ? flows : undefined;
if (!files || extra.length) {
  console.error("usage: bun scripts/ci-tests.ts all | unit | flows");
  process.exit(2);
}
const missing = files.filter((f) => !all.includes(f));
if (missing.length) {
  console.error(`missing test files: ${missing.join(", ")}`);
  process.exit(1);
}

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
const proc = Bun.spawn(["bun", "test", "--parallel", ...files.map((f) => `./${f}`)], {
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
