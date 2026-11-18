import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright-core";
import { pageErrors } from "./page-errors.ts";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
if (process.argv.includes("--help")) {
  console.log(
    "usage: bun scripts/ui-face-moods.ts [--dist ui/dist] [--browser webkit|chromium]\n\nA face looks and moves as it did while mounting less (#2453): its first eye shape shows at once, a mood change that keeps the same eye shape leaves it alone, and an eye shape or mark a later mood brings fades in from hidden instead of popping in. Watches atlas's face in the sidebar while the moods-live scene moves it from free to thinking to tool to waiting.",
  );
  process.exit(0);
}
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = flag("--browser") ?? "webkit";
if (engine !== "webkit" && engine !== "chromium") throw new Error(`--browser is webkit or chromium, not ${engine}`);

const WATCH_MS = 6_500;
const PARTS = [".eye-dot", ".eye-bar", ".face-ask"];

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});
const browser = await (engine === "webkit" ? webkit : chromium).launch({ executablePath: engine === "chromium" ? process.env.SMOKE_CHROMIUM || undefined : undefined });
const fails: string[] = [];
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};

interface Seen {
  firstAt: number;
  first: number;
  most: number;
}

interface Kept {
  moods: string[];
  least: number;
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await pageErrors(page, (e) => fails.push(`page threw: ${e}`));
  await page.addInitScript(
    ({ parts, watchMs }: { parts: string[]; watchMs: number }) => {
      const seen: Record<string, { firstAt: number; first: number; most: number }> = {};
      const kept = { moods: [] as string[], least: 1 };
      (window as unknown as { __moods: typeof seen; __kept: typeof kept }).__moods = seen;
      (window as unknown as { __kept: typeof kept }).__kept = kept;
      const tick = () => {
        const row = [...document.querySelectorAll(".side-row")].find((r) => r.textContent?.includes("atlas"));
        const face = row?.querySelector<SVGElement>("svg.face");
        const mood = face?.dataset.mood ?? "";
        if (mood && !kept.moods.includes(mood)) kept.moods.push(mood);
        const dot = face?.querySelector(".eye-dot");
        if (dot && (mood === "free" || mood === "thinking")) kept.least = Math.min(kept.least, Number(getComputedStyle(dot).opacity));
        for (const part of parts) {
          const el = face?.querySelector(part);
          if (!el) continue;
          const opacity = Number(getComputedStyle(el).opacity);
          const was = seen[part];
          if (was) was.most = Math.max(was.most, opacity);
          else seen[part] = { firstAt: Math.round(performance.now()), first: opacity, most: opacity };
        }
        if (performance.now() < watchMs) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    { parts: PARTS, watchMs: WATCH_MS },
  );
  await page.goto(`http://127.0.0.1:${server.port}/?shot=moods-live`);
  await page.waitForFunction((ms: number) => performance.now() > ms, WATCH_MS + 200, { timeout: 30_000 });
  const seen = await page.evaluate(() => (window as unknown as { __moods: Record<string, Seen> }).__moods);
  const kept = await page.evaluate(() => (window as unknown as { __kept: Kept }).__kept);
  const dot = seen[".eye-dot"];
  const bar = seen[".eye-bar"];
  const ask = seen[".face-ask"];
  expect(!!dot && dot.first > 0.99, `the eye shape a face starts with shows at once, with no fade (first frame opacity ${dot?.first ?? "never seen"})`);
  expect(
    kept.moods.includes("thinking") && kept.least > 0.99,
    `a mood change that keeps the same eye shape doesn't touch it (free to thinking: the dot's lowest opacity ${kept.least}, moods seen ${kept.moods.join(", ")})`,
  );
  expect(!!bar && bar.first < 0.5 && bar.most > 0.99, `an eye shape a later mood brings fades in from hidden (tool's bar: first frame ${bar?.first ?? "never seen"}, then ${bar?.most ?? "-"})`);
  expect(!!ask && ask.first < 0.5 && ask.most > 0.99, `a mark a later mood brings fades in from hidden (waiting's question mark: first frame ${ask?.first ?? "never seen"}, then ${ask?.most ?? "-"})`);
  await page.close();
} finally {
  await browser.close();
  server.stop();
}
console.log(`\na face's moods look and move as before, in ${engine}`);
if (fails.length) {
  console.log(`${fails.length} failed in ${engine}`);
  process.exit(1);
}
console.log(`all passed in ${engine}`);
