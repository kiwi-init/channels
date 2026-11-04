import { Glob } from "bun";
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FLOWS } from "./ci-flows.ts";
import { noteLine, shouldKill, SILENT_MS, verdict, watching } from "./ci-watchdog.ts";

const [group = "", ...extra] = process.argv.slice(2);
const all = [...new Glob("test/*.test.ts").scanSync(), ...new Glob("ui/src/**/*.test.{ts,tsx}").scanSync(), ...new Glob("packages/*/src/**/*.test.{ts,tsx}").scanSync()].sort();
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
  stdio: ["inherit", "pipe", "pipe"],
  env: { ...process.env, TMPDIR: tmp.dir },
});
const watch = watching(Date.now());
let tail = "";
async function pump(stream: ReadableStream<Uint8Array>, out: NodeJS.WriteStream, keepTail: boolean): Promise<void> {
  const decoder = new TextDecoder();
  let rest = "";
  for await (const chunk of stream) {
    out.write(chunk);
    const text = decoder.decode(chunk, { stream: true });
    if (keepTail) tail = (tail + text).slice(-4096);
    const lines = (rest + text).split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) noteLine(watch, line, Date.now());
  }
  if (rest) noteLine(watch, rest, Date.now());
}
const reading = Promise.all([pump(proc.stdout, process.stdout, false), pump(proc.stderr, process.stderr, true)]);

function processDump(pid: number): string {
  const run = (cmd: string[]): string => {
    try {
      return Bun.spawnSync(cmd).stdout.toString();
    } catch {
      // ps, pgrep or /proc missing on this runner: the dump just says less.
      return "";
    }
  };
  const children = run(["pgrep", "-P", String(pid)])
    .split("\n")
    .filter(Boolean);
  const fds = [String(pid), ...children].map((p) => `open files of ${p}:\n${run(["ls", "-l", `/proc/${p}/fd`])}`);
  return [run(["ps", "-eo", "pid,ppid,etime,stat,args", "--forest"]), ...fds].join("\n");
}

let killed: ReturnType<typeof verdict> | null = null;
const silentMs = Number(process.env.KIWI_CI_SILENT_MS) || SILENT_MS;
const timer = setInterval(
  () => {
    if (!shouldKill(files, watch, Date.now(), silentMs)) return;
    clearInterval(timer);
    console.error(`watchdog: bun silent ${silentMs / 1000}s after all files reported, killed`);
    console.error(processDump(proc.pid));
    killed = verdict(files, watch);
    Bun.spawnSync(["pkill", "-KILL", "-P", String(proc.pid)]);
    proc.kill("SIGKILL");
  },
  Number(process.env.KIWI_CI_POLL_MS) || 5_000,
);

const code = await proc.exited;
clearInterval(timer);
await Promise.race([reading, Bun.sleep(2000)]);
tmp.cleanup();
if (killed) {
  console.error(`watchdog: ${killed.why}`);
  process.exit(killed.code);
}
const ran = [...tail.matchAll(/Ran \d+ tests? across (\d+) files?\./g)].at(-1)?.[1];
if (code === 0 && Number(ran) !== files.length) {
  console.error(`bun test exited 0 after ${ran ?? "an unknown number"} of ${files.length} files: a test ended the run early`);
  process.exit(1);
}
process.exit(code);
