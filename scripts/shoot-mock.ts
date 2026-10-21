import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const base = args[0] ?? "http://127.0.0.1:5199/mock.html";
const out = resolve(args[1] ?? "shots");
const only = args[2]?.split(",");
mkdirSync(out, { recursive: true });

const SIZES = { wide: { width: 1440, height: 900 }, narrow: { width: 390, height: 844 } } as const;
const SHOTS: { d: string; size: keyof typeof SIZES; height?: number }[] = [
  { d: "list", size: "wide" },
  { d: "tree", size: "wide", height: 1640 },
  { d: "request", size: "wide", height: 1000 },
  { d: "request", size: "narrow", height: 1300 },
  { d: "stuck", size: "wide" },
  { d: "stuck", size: "narrow", height: 1300 },
  { d: "both", size: "wide", height: 1400 },
  { d: "both", size: "narrow", height: 1900 },
];

const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
try {
  for (const theme of ["dark", "light"] as const)
    for (const s of SHOTS) {
      if (only && !only.includes(s.d)) continue;
      const viewport = { ...SIZES[s.size], ...(s.height ? { height: s.height } : {}) };
      const page = await browser.newPage({ viewport, deviceScaleFactor: 2, colorScheme: theme });
      page.on("pageerror", (e) => console.log(`page error ${s.d}: ${e.message}`));
      await page.goto(`${base}?d=${s.d}&theme=${theme}`);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(400);
      const file = join(out, `${s.d}-${s.size}-${theme}.png`);
      await page.screenshot({ path: file });
      console.log(file);
      await page.close();
    }
} finally {
  await browser.close();
}
