import { describe, expect, test } from "bun:test";
import { inTasks } from "./in-tasks.ts";

const task = (): Promise<void> => new Promise((done) => setTimeout(done, 0));
const until = async (done: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !done(); i++) await task();
};

describe("events handed to the page in tasks of their own", () => {
  test("nothing is handed in the caller's own step, nor in the microtasks right after it", async () => {
    const got: number[] = [];
    const page = inTasks<number>((e) => got.push(e));
    page.hand(1);
    expect(got).toEqual([]);
    await Promise.resolve();
    await Promise.resolve();
    expect(got).toEqual([]);
    await until(() => got.length === 1);
    expect(got).toEqual([1]);
    page.stop();
  });

  test("events arrive in the order they were handed, one task each", async () => {
    const got: string[] = [];
    let tasks = 0;
    let within = 0;
    const page = inTasks<string>((e) => {
      got.push(e);
      within++;
      tasks += within === 1 ? 1 : 0;
      queueMicrotask(() => {
        within = 0;
      });
    });
    for (const e of ["a", "b", "c", "d"]) page.hand(e);
    await until(() => got.length === 4);
    expect(got).toEqual(["a", "b", "c", "d"]);
    expect(tasks).toBe(4);
    page.stop();
  });

  test("an event handed while another is being taken waits for its own task", async () => {
    const got: string[] = [];
    const page = inTasks<string>((e) => {
      got.push(e);
      if (e === "first") {
        page.hand("second");
        expect(got).toEqual(["first"]);
      }
    });
    page.hand("first");
    await until(() => got.length === 2);
    expect(got).toEqual(["first", "second"]);
    page.stop();
  });

  test("after a stop nothing more is handed, not even what was already on its way", async () => {
    const got: number[] = [];
    const page = inTasks<number>((e) => got.push(e));
    page.hand(1);
    page.hand(2);
    page.stop();
    page.hand(3);
    for (let i = 0; i < 5; i++) await task();
    expect(got).toEqual([]);
  });
});
