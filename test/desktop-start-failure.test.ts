import { expect, test } from "bun:test";
import { failing, failureBox, heldWithin, type FailureBox } from "../desktop/src/start-failure.ts";

const LOG = "/home/someone/.local/state/Channels/logs/main.log";

function rig(box: (b: FailureBox) => Promise<unknown> = () => Promise.resolve(0)) {
  const seen: string[] = [];
  const logged: Error[] = [];
  const f = failing({
    log: (e) => void (logged.push(e), seen.push(`log ${e.message}`)),
    say: (line) => void seen.push(`say ${line}`),
    box: (b) => (seen.push(`box ${b.message}`), box(b)),
    quit: (code) => void seen.push(`quit ${code}`),
    logFile: () => LOG,
  });
  return { f, seen, logged };
}

test("a start that fails is logged, said on the console, shown in a message box, and only then quits with 1 (T1763)", async () => {
  let dismiss: () => void = () => {};
  const { f, seen, logged } = rig(() => new Promise<void>((r) => (dismiss = r)));
  const cause = new Error("ENOENT: no such file, page/index.html");
  const done = f.fail("the window couldn't start (ENOENT: no such file, page/index.html)", { cause });
  await Promise.resolve();
  expect(seen).toEqual([
    "log the window couldn't start (ENOENT: no such file, page/index.html)",
    "say Channels: the window couldn't start (ENOENT: no such file, page/index.html)",
    "box Channels couldn't start",
  ]);
  expect(logged[0]?.cause).toBe(cause);
  dismiss();
  await done;
  expect(seen.at(-1)).toBe("quit 1");
});

test("the box says what went wrong as a sentence, to open Channels again, and where the details are", () => {
  const box = failureBox("the window's navigation rules didn't take effect; not opening it", LOG);
  expect(box).toEqual({
    type: "error",
    message: "Channels couldn't start",
    detail: `The window's navigation rules didn't take effect; not opening it.\n\nOpen Channels again. If it keeps failing, the details are in ${LOG}`,
  });
  expect(failureBox("a navigation went through; closing", LOG, true).message).toBe("Channels had to close");
  expect(failureBox("Quit it, or restart the computer.", LOG).detail.startsWith("Quit it, or restart the computer.\n")).toBe(true);
});

test("the single-instance lock is let go before the box, so opening Channels again isn't answered by a dead one", async () => {
  const { f, seen } = rig();
  f.releaseFirst(() => void seen.push("release"));
  await f.fail("the web view's permission handler wasn't found");
  expect(seen.filter((s) => !s.startsWith("log") && !s.startsWith("say"))).toEqual(["release", "box Channels couldn't start", "quit 1"]);
});

test("a box that can't show still quits, and main.log keeps why", async () => {
  const { f, seen } = rig(() => Promise.reject(new Error("no display")));
  await f.fail("the window couldn't start (boom)");
  expect(seen).toContain("log no display");
  expect(seen.at(-1)).toBe("quit 1");
});

test("a second failure while the box is up says nothing more, and the exit code can be chosen", async () => {
  const { f, seen } = rig();
  await Promise.all([f.fail("another Channels holds this data folder and didn't answer", { code: 0 }), f.fail("again")]);
  expect(seen.filter((s) => s.startsWith("box"))).toHaveLength(1);
  expect(seen.filter((s) => s.startsWith("quit"))).toEqual(["quit 0"]);
});

test("the canary gets a second, longer wait before the window is refused", async () => {
  const run = (answerOn: number | null) => {
    let loads = 0;
    let seen: () => void = () => {};
    const late: number[] = [];
    const held = heldWithin(
      [10, 30],
      () => {
        loads++;
        if (loads === answerOn) setTimeout(seen, 2);
      },
      (s) => (seen = s),
      (w) => void late.push(w),
    );
    return held.then((ok) => ({ ok, loads, late }));
  };
  expect(await run(1)).toEqual({ ok: true, loads: 1, late: [] });
  expect(await run(2)).toEqual({ ok: true, loads: 2, late: [10] });
  expect(await run(null)).toEqual({ ok: false, loads: 2, late: [10, 30] });
});

test("an answer to the first try that arrives during the second wait still counts", async () => {
  let seen: () => void = () => {};
  const held = heldWithin(
    [5, 40],
    () => {},
    (s) => (seen = s),
    () => {},
  );
  setTimeout(() => seen(), 15);
  expect(await held).toBe(true);
});
