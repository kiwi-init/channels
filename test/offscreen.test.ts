import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const web = resolve(import.meta.dir, "../web/src");
const css = readFileSync(resolve(web, "index.css"), "utf8");
const message = readFileSync(resolve(web, "components/message.tsx"), "utf8");

test("a message off screen skips layout and paint: its content column is content-visibility auto, with a remembered size", () => {
  const rule = css.slice(css.indexOf("@utility offscreen-lazy"), css.indexOf("}", css.indexOf("@utility offscreen-lazy")));
  expect(rule).toContain("content-visibility: auto");
  expect(rule).toContain("contain-intrinsic-size: auto ");
  expect(message).toContain('<div className="-m-1 min-w-0 p-1 offscreen-lazy">');
});
