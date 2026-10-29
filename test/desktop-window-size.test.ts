import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { minWindowWidth } from "../desktop/src/window-size.ts";

const ui = join(import.meta.dir, "..", "ui", "src");
const phoneWidth = (): number | null => {
  const shell = /@media \(min-width: (\d+)px\)/.exec(readFileSync(join(ui, "styles", "shell.css"), "utf8"));
  const side = /matchMedia\("\(max-width: (\d+)px\)"\)/.exec(readFileSync(join(ui, "shell", "side.ts"), "utf8"));
  return shell && side ? Math.max(Number(shell[1]) - 1, Number(side[1])) : null;
};

test("a Mac window is wider than the app's phone layout: below it the phone layout's headers sit under the traffic lights", () => {
  const phone = phoneWidth();
  expect(phone).not.toBeNull();
  expect(minWindowWidth("darwin")).toBeGreaterThan(phone ?? Infinity);
});

test("a Linux window fits half a 1366px laptop screen, as tiling compositors size it, and below the phone width the app is the phone layout", () => {
  expect(minWindowWidth("linux")).toBeLessThanOrEqual(1366 / 2 - 8);
});
