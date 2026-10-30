import { spawnSync } from "node:child_process";

export interface Ran {
  status: number | null;
  stdout: string;
  stderr: string;
}

const failed = (err: unknown): Ran => ({ status: null, stdout: "", stderr: err instanceof Error ? err.message : String(err) });

export function runNow(argv: readonly string[], timeoutMs = 5_000): Ran {
  const [bin, ...args] = argv;
  if (!bin) return failed("nothing to run");
  const r = spawnSync(bin, args, { encoding: "utf8", timeout: timeoutMs });
  return {
    status: typeof r.status === "number" ? r.status : null,
    stdout: typeof r.stdout === "string" ? r.stdout : "",
    stderr: typeof r.stderr === "string" && r.stderr ? r.stderr : (r.error?.message ?? ""),
  };
}

export function run(argv: readonly string[], timeoutMs = 10_000, cwd?: string): Promise<Ran> {
  let child: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    child = Bun.spawn([...argv], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  } catch (err) {
    return Promise.resolve(failed(err));
  }
  const done = Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]).then(([, stdout, stderr]): Ran => ({ status: child.exitCode, stdout, stderr }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Ran>((resolve) => {
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ status: null, stdout: "", stderr: `timed out after ${timeoutMs} ms` });
    }, timeoutMs);
  });
  return Promise.race([done, late]).finally(() => clearTimeout(timer));
}

export function said(r: Ran): string {
  return (r.stderr.trim() || r.stdout.trim() || `exit ${r.status}`).split("\n")[0]!.slice(0, 200);
}
