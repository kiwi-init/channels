import { expect, test } from "bun:test";
import { runBounded } from "../src/daemon/wake.ts";

test("a wake command that ignores TERM and leaves a child on its stderr still ends at its deadline", async () => {
  const started = Date.now();
  let pid = 0;
  const ran = await runBounded(["/bin/sh", "-c", 'trap "" TERM; (sleep 3 >&2 &); sleep 20'], 300, (child) => (pid = child.pid));
  expect(ran).toBeNull();
  expect(Date.now() - started).toBeLessThan(2_000);
  let gone = false;
  for (let i = 0; i < 20 && !gone; i++) {
    try {
      process.kill(pid, 0);
      await Bun.sleep(50);
    } catch {
      gone = true;
    }
  }
  expect(gone).toBe(true);
});

test("a wake command that ends says its exit code and what it printed on stderr", async () => {
  expect(await runBounded(["/bin/sh", "-c", "echo nope >&2; exit 3"], 5_000)).toEqual({ code: 3, err: "nope\n" });
  expect(await runBounded(["/bin/sh", "-c", "exit 0"], 5_000)).toEqual({ code: 0, err: "" });
});
