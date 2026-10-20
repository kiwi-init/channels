import { expect, test } from "bun:test";
import { textStepFor, type KeyInput } from "../desktop/src/text-size.ts";

const press = (key: string, mods: Partial<Pick<KeyInput, "meta" | "control" | "alt">> = {}, type = "keyDown"): KeyInput => ({ type, key, meta: false, control: false, alt: false, ...mods });

test("⌘ with +, - or 0 on a Mac, Ctrl elsewhere, steps the text size, and no other key does", () => {
  expect(textStepFor(press("=", { meta: true }), "darwin")).toBe("bigger");
  expect(textStepFor(press("+", { meta: true }), "darwin")).toBe("bigger");
  expect(textStepFor(press("-", { meta: true }), "darwin")).toBe("smaller");
  expect(textStepFor(press("0", { meta: true }), "darwin")).toBe("reset");
  expect(textStepFor(press("=", { control: true }), "linux")).toBe("bigger");
  expect(textStepFor(press("-", { control: true }), "win32")).toBe("smaller");
  expect(textStepFor(press("0", { control: true }), "linux")).toBe("reset");
  expect(textStepFor(press("=", { control: true }), "darwin")).toBeNull();
  expect(textStepFor(press("=", { meta: true }), "linux")).toBeNull();
  expect(textStepFor(press("=", { meta: true, alt: true }), "darwin")).toBeNull();
  expect(textStepFor(press("=", { meta: true }, "keyUp"), "darwin")).toBeNull();
  expect(textStepFor(press("="), "darwin")).toBeNull();
  expect(textStepFor(press("k", { meta: true }), "darwin")).toBeNull();
});
