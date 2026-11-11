import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SHELL = readFileSync(join(import.meta.dir, "../ui/src/styles/shell.css"), "utf8");
const BUTTONS = /\.(top-chan|top-drawer|top-lead|top-tools)(?![\w-])/;
const RAISED = /(?:^|;|\s)(box-shadow\s*:[^;]*--shadow[^;]*|background(?:-color)?\s*:[^;]*--float[^;]*)/;

function raisedRules(css: string): string[] {
  const found: string[] = [];
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (rule[1] ?? "").trim();
    const hit = (rule[2] ?? "").match(RAISED);
    if (BUTTONS.test(selector) && hit) found.push(`${selector} { ${hit[1]} }`);
  }
  return found;
}

describe("the top bar's buttons look like the Settings gear (T4165)", () => {
  test("the sidebar, channel and search buttons carry no raised chip", () => {
    expect(raisedRules(SHELL)).toEqual([]);
  });

  test("the check sees a raised chip when one is there", () => {
    expect(raisedRules(".top-chan { background: var(--float); box-shadow: var(--shadow-float); }")).toEqual([".top-chan { background: var(--float) }"]);
  });
});
