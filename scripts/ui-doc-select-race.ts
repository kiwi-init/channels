#!/usr/bin/env bun
import { join } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright-core";

const PAGE = join(import.meta.dir, "..", "ui", "src", "chat", "doc", "screen-selection.page.ts");
const LINE = "nxz rq  ilx lsqnhadj e sqxabgygd";
const BACK = 10;
const RUNS = Number(process.argv.find((a) => a.startsWith("--runs="))?.slice(7) ?? 20);

const built = await Bun.build({ entrypoints: [PAGE], target: "browser" });
if (!built.success) throw new Error(built.logs.map(String).join("\n"));
const js = await built.outputs[0]!.text();

interface Race {
  mount: (line: string, wired: boolean) => void;
  caretToEnd: () => void;
  start: (gap: number) => void;
  stop: () => void;
  line: () => string;
}

async function open(browser: Browser, wired: boolean): Promise<Page> {
  const page = await browser.newPage();
  await page.setContent("<!doctype html><meta charset=utf-8><style>p{white-space:pre-wrap}</style>");
  await page.addScriptTag({ content: js });
  await page.evaluate(({ line, wired }) => (window as unknown as { race: Race }).race.mount(line, wired), { line: LINE, wired });
  for (let i = 0; i < 100 && !(await page.evaluate(() => (window as unknown as { race: Race }).race.line())); i++) await page.waitForTimeout(20);
  await page.evaluate(() => (window as unknown as { race: Race }).race.caretToEnd());
  await page.waitForTimeout(30);
  await page.evaluate(() => (window as unknown as { race: Race }).race.start(0));
  return page;
}

async function after(page: Page): Promise<string> {
  await page.evaluate(() => (window as unknown as { race: Race }).race.stop());
  await page.waitForTimeout(30);
  const line = await page.evaluate(() => (window as unknown as { race: Race }).race.line());
  await page.close();
  return line;
}

const checks: { name: string; want: string; run: (page: Page) => Promise<void> }[] = [
  {
    name: `⇧← over the whole line, then a letter, replaces the line`,
    want: "c",
    run: async (page) => {
      for (let i = 0; i < LINE.length; i++) await page.keyboard.press("Shift+ArrowLeft");
      await page.keyboard.type("c");
    },
  },
  {
    name: `← ${BACK} times, then a letter, lands ${BACK} letters back`,
    want: `${LINE.slice(0, -BACK)}c${LINE.slice(-BACK)}`,
    run: async (page) => {
      for (let i = 0; i < BACK; i++) await page.keyboard.press("ArrowLeft");
      await page.keyboard.type("c");
    },
  },
];

let failed = 0;
for (const engine of ["chromium", "webkit"] as const) {
  const browser = engine === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
  try {
    for (const check of checks) {
      const misses = { wired: 0, bare: 0 };
      let sample = "";
      for (const wired of [false, true]) {
        for (let r = 0; r < RUNS; r++) {
          const page = await open(browser, wired);
          await check.run(page);
          const got = await after(page);
          if (got === check.want) continue;
          misses[wired ? "wired" : "bare"]++;
          if (wired) sample = got;
        }
      }
      if (misses.wired) failed++;
      console.log(
        `${misses.wired ? "✗" : "✓"} ${engine}: ${check.name}, with remote edits landing between the keys: ${RUNS - misses.wired}/${RUNS}` +
          ` (without the fix ${RUNS - misses.bare}/${RUNS})${sample ? `, e.g. ${JSON.stringify(sample)}` : ""}`,
      );
    }
  } finally {
    await browser.close();
  }
}
if (failed) {
  console.error(`${failed} selection checks lost keys to remote edits`);
  process.exitCode = 1;
}
