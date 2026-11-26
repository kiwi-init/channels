import { describe, expect, test } from "bun:test";

import { errorText } from "../desktop/src/main-log.ts";

const shaped = (message: string, stack: string | undefined, name = "Error"): Error => {
  const e = new Error(message);
  e.name = name;
  Object.defineProperty(e, "stack", { value: stack });
  return e;
};

describe("main.log error lines", () => {
  test("a stack with its own first line (Bun, V8) is written as it is", () => {
    const stack = "Error: the window's page stopped (its web content process ended)\n    at gone (keep-alive-eb.ts:22:9)";
    expect(errorText(shaped("the window's page stopped (its web content process ended)", stack))).toBe(stack);
  });

  test("a JavaScriptCore stack, frames only, gets the name and message first", () => {
    const text = errorText(shaped("the window's page stopped (its web content process ended)", "gone@index.js:6853:22\nglobal code@index.js:6861:3"));
    expect(text).toBe("Error: the window's page stopped (its web content process ended)\ngone@index.js:6853:22\nglobal code@index.js:6861:3");
  });

  test("no stack at all still names the error", () => {
    expect(errorText(shaped("the store is locked", undefined, "Refused"))).toBe("Refused: the store is locked");
  });

  test("an error with no message is its name", () => {
    expect(errorText(shaped("", "@index.js:1:1"))).toBe("Error\n@index.js:1:1");
  });

  test("anything else is its string", () => {
    expect(errorText("plain")).toBe("plain");
  });
});
