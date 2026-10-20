import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { minWindowWidth } from "../desktop/src/window-size.ts";

const web = join(import.meta.dir, "..", "web");
const breakpointMd = (file: string): number | null => {
  const m = /--breakpoint-md:\s*([\d.]+)(rem|px)/.exec(readFileSync(file, "utf8"));
  return m ? Number(m[1]) * (m[2] === "rem" ? 16 : 1) : null;
};

test("a Mac window is never narrower than the dashboard's md breakpoint: below it the phone layout's headers sit under the traffic lights", () => {
  const md = breakpointMd(join(web, "src", "index.css")) ?? breakpointMd(Bun.resolveSync("tailwindcss/theme.css", web));
  expect(md).not.toBeNull();
  expect(minWindowWidth("darwin")).toBeGreaterThanOrEqual(md ?? Infinity);
});
