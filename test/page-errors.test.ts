import { describe, expect, test } from "bun:test";
import { describePageError } from "../scripts/page-error-lines.ts";

const told = (lines: string[]): string => lines.join("\n    ");

describe("a page error in a harness says where it came from", () => {
  test("a thrown error names the check it came after and its frames, without the server's address", () => {
    expect(
      describePageError({
        message: "x is not defined",
        stack: "ReferenceError: x is not defined\n    at go (http://127.0.0.1:5123/assets/index-abc.js:12:345)\n    at http://127.0.0.1:5123/assets/index-abc.js:1:2",
        after: "ok   the list keeps its place",
      }),
    ).toBe(told(["x is not defined", "after: ok   the list keeps its place", "stack:", "  at go (assets/index-abc.js:12:345)", "  at assets/index-abc.js:1:2"]));
  });

  test("WebKit's frames lose the address too", () => {
    expect(
      describePageError({ message: "x is not defined", stack: "go@http://127.0.0.1:5123/assets/index-abc.js:12:345\nglobal code@http://127.0.0.1:5123/assets/index-abc.js:1:2", after: "ok   first" }),
    ).toBe(told(["x is not defined", "after: ok   first", "stack:", "  go@assets/index-abc.js:12:345", "  global code@assets/index-abc.js:1:2"]));
  });

  test("a long stack is cut to its first eight frames", () => {
    const stack = Array.from({ length: 20 }, (_, i) => `f${i}@http://127.0.0.1:1/a.js:${i}:1`).join("\n");
    const lines = describePageError({ message: "boom", stack, after: "ok   first" }).split("\n");
    expect(lines.filter((l) => l.includes("@a.js")).length).toBe(8);
    expect(lines.at(-1)).toBe("      f7@a.js:7:1");
  });

  test("an error the engine gives no stack for says so, and one before any check says that", () => {
    expect(describePageError({ message: "ResizeObserver loop completed with undelivered notifications.", stack: "", after: "" })).toBe(
      told(["ResizeObserver loop completed with undelivered notifications.", "before anything was printed", "stack: the engine gave none"]),
    );
  });

  test("a resize observer loop lists what changed size and which observers ran", () => {
    expect(
      describePageError({
        message: "ResizeObserver loop completed with undelivered notifications.",
        after: "ok   the comments keep their place",
        observers: {
          late: ["div.msg-text 355x56 -> 355x84, watched by observer 3 (made at assets/index-abc.js:9:1)"],
          untold: [],
          ran: ["observer 3 (made at assets/index-abc.js:9:1): div.msg-text 355x56", "observer 5: div.feed 900x600"],
          loading: [],
        },
      }),
    ).toBe(
      told([
        "ResizeObserver loop completed with undelivered notifications.",
        "after: ok   the comments keep their place",
        "stack: the engine gave none",
        "changed size after its observer last ran:",
        "  div.msg-text 355x56 -> 355x84, watched by observer 3 (made at assets/index-abc.js:9:1)",
        "resize observers that ran just before:",
        "  observer 3 (made at assets/index-abc.js:9:1): div.msg-text 355x56",
        "  observer 5: div.feed 900x600",
      ]),
    );
  });

  test("a loop with nothing recorded says that instead of an empty list", () => {
    expect(describePageError({ message: "ResizeObserver loop limit exceeded", after: "ok   first", observers: { late: [], untold: [], ran: [], loading: [] } })).toBe(
      told([
        "ResizeObserver loop limit exceeded",
        "after: ok   first",
        "stack: the engine gave none",
        "no watched element had changed size or was new when the error came",
        "no resize observer ran just before",
      ]),
    );
  });

  test("a loop from an element put under watch too late names it, with no line about a size change", () => {
    expect(
      describePageError({
        message: "ResizeObserver loop completed with undelivered notifications.",
        after: "ok   first",
        observers: {
          late: [],
          untold: ["article.msg 592x36, put under watch 4 ms before by observer 1 (made at assets/index-abc.js:29:1)"],
          ran: ["observer 1 (made at assets/index-abc.js:29:1): article.msg 592x36"],
          loading: [],
        },
      }),
    ).toBe(
      told([
        "ResizeObserver loop completed with undelivered notifications.",
        "after: ok   first",
        "stack: the engine gave none",
        "put under watch, and its observer was not told its size yet:",
        "  article.msg 592x36, put under watch 4 ms before by observer 1 (made at assets/index-abc.js:29:1)",
        "resize observers that ran just before:",
        "  observer 1 (made at assets/index-abc.js:29:1): article.msg 592x36",
      ]),
    );
  });

  test("a loop while stylesheets load in <head> names them first, as what held the layout back", () => {
    const lines = describePageError({
      message: "ResizeObserver loop completed with undelivered notifications.",
      after: "ok   first",
      observers: {
        late: ["div.feed-list 560x902 -> 560x926, watched by observer 7"],
        untold: [],
        ran: ["observer 1: article.msg 560x8"],
        loading: ["assets/card-abc.css", "assets/tasks-def.css"],
      },
    }).split("\n    ");
    expect(lines.slice(3, 7)).toEqual([
      "2 stylesheets were still loading in <head>, and WebKit lays out nothing new until they arrive, so what the page added meanwhile is sized late:",
      "  assets/card-abc.css, assets/tasks-def.css",
      "changed size after its observer last ran:",
      "  div.feed-list 560x902 -> 560x926, watched by observer 7",
    ]);
  });

  test("one stylesheet reads as one", () => {
    const told = describePageError({
      message: "ResizeObserver loop completed with undelivered notifications.",
      after: "ok   first",
      observers: { late: [], untold: [], ran: [], loading: ["assets/card-abc.css"] },
    });
    expect(told).toContain("1 stylesheet was still loading in <head>");
  });
});
