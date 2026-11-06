import { describe, expect, test } from "bun:test";
import { CallExited, CallNotStarted, CallTimedOut, DeadlinePassed, poll, runCall } from "../scripts/smoke-calls.ts";

const hung = (limitMs: number) => runCall({ cmd: "sh", args: ["-c", "echo started $$; exec sleep 30"], limitMs, name: "kiwi note smoke-url" });

const caught = async (work: Promise<unknown>): Promise<{ error: unknown; ms: number }> => {
  const start = performance.now();
  const error = await work.then(
    () => undefined,
    (e: unknown) => e,
  );
  return { error, ms: performance.now() - start };
};

const pidIn = (e: unknown): number => {
  const pid = e instanceof CallTimedOut ? /started (\d+)/.exec(e.out)?.[1] : undefined;
  if (!pid) throw new Error(`no pid in ${String(e)}`);
  return Number(pid);
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    // ESRCH: no such process, not even a zombie, so it was killed and reaped.
    return false;
  }
};

describe("the app smoke's CLI calls have time limits (#1612)", () => {
  test("a call that exits 0 returns its output", async () => {
    expect(await runCall({ cmd: "sh", args: ["-c", "echo hello"], limitMs: 5_000 })).toBe("hello\n");
  });

  test("a hung call is killed and reaped at its limit, and the failure names the call and its output", async () => {
    const { error, ms } = await caught(hung(300));
    expect(error).toBeInstanceOf(CallTimedOut);
    expect(String(error)).toContain("kiwi note smoke-url was still running after 300 ms, so it was killed");
    expect(String(error)).toContain("started");
    expect(ms).toBeLessThan(2_000);
    expect(alive(pidIn(error))).toBe(false);
  });

  test("a call that exits non-zero reports its code and output, and one that can't start says so", async () => {
    const exited = await caught(runCall({ cmd: "sh", args: ["-c", "echo 'no fact \"smoke-url\"' >&2; exit 2"], limitMs: 5_000 }));
    expect(exited.error).toBeInstanceOf(CallExited);
    expect(exited.error).toMatchObject({ code: 2 });
    expect(String(exited.error)).toContain('no fact "smoke-url"');
    const missing = await caught(runCall({ cmd: "kiwi-smoke-no-such-command", args: [], limitMs: 5_000 }));
    expect(missing.error).toBeInstanceOf(CallNotStarted);
    expect(String(missing.error)).toContain("kiwi-smoke-no-such-command didn't start");
  });

  test("a hung call inside the loop gets only the time left, so it fails as a timeout within the loop's deadline", async () => {
    const limits: number[] = [];
    let calls = 0;
    const { error, ms } = await caught(
      poll("the agent sees the note go", 600, 50, async (limitMs) => {
        limits.push(limitMs);
        calls++;
        if (calls === 1) return { done: false, seen: "smoke-url is still https://example.test" };
        await hung(limitMs);
        return { done: false, seen: "unreachable" };
      }),
    );
    expect(error).toBeInstanceOf(CallTimedOut);
    expect(ms).toBeLessThan(1_500);
    expect(limits[1]).toBeLessThan(600);
    expect(alive(pidIn(error))).toBe(false);
  });

  test("the loop stops at its deadline with what the agent last saw, and returns once the attempt is done", async () => {
    const { error, ms } = await caught(poll("the agent sees the note go", 300, 50, async () => ({ done: false, seen: "smoke-url is still https://example.test" })));
    expect(error).toBeInstanceOf(DeadlinePassed);
    expect(String(error)).toContain("the agent sees the note go: not within 300 ms; last seen: smoke-url is still https://example.test");
    expect(ms).toBeLessThan(1_000);
    let n = 0;
    expect(await poll("third time", 5_000, 10, async () => (++n === 3 ? { done: true, value: n } : { done: false, seen: String(n) }))).toBe(3);
  });
});
