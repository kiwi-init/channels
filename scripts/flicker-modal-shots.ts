import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright-core";

const flag = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(name);
  return at > 0 ? (process.argv[at + 1] ?? fallback) : fallback;
};
const dist = resolve(flag("--dist", "ui/dist"));
const engine = flag("--engine", "webkit");
const shot = flag("--shot", "channel-settings");
const seconds = Number(flag("--seconds", "20"));
const out = resolve(flag("--out", "flicker-out/modal-shots"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}`);
const dir = join(out, `${engine}-${shot}`);
mkdirSync(dir, { recursive: true });

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});

const browser = await (engine === "chromium" ? chromium : webkit).launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const born = Date.now();
  await page.goto(`http://127.0.0.1:${server.port}/?shot=${shot}`);
  await page.mouse.move(2, 2);
  await page.getByRole("dialog").first().waitFor({ timeout: 20_000 });
  const visible = (Date.now() - born) / 1000;
  const shots: { at: number; same: boolean; bytes: number }[] = [];
  const animations: { at: number; running: string[] }[] = [];
  let last: Buffer | null = null;
  let changed = 0;
  while ((Date.now() - born) / 1000 < visible + seconds) {
    const at = (Date.now() - born) / 1000;
    const png = await page.screenshot({ animations: "allow", caret: "initial" });
    const same = last !== null && png.equals(last);
    if (last !== null && !same) {
      changed++;
      writeFileSync(join(dir, `change-${String(changed).padStart(3, "0")}-${at.toFixed(2)}s-before.png`), last);
      writeFileSync(join(dir, `change-${String(changed).padStart(3, "0")}-${at.toFixed(2)}s-after.png`), png);
    }
    shots.push({ at, same, bytes: png.length });
    last = png;
    if (shots.length % 4 === 1)
      animations.push({
        at,
        running: await page.evaluate(() =>
          document.getAnimations().map((a) => {
            const effect = a.effect as KeyframeEffect | null;
            const target = effect?.target;
            const name = a instanceof CSSAnimation ? a.animationName : a instanceof CSSTransition ? `transition:${a.transitionProperty}` : "script";
            const where =
              target instanceof Element
                ? `${target.tagName.toLowerCase()}.${String(target.getAttribute("class") ?? "")
                    .trim()
                    .split(/\s+/)
                    .slice(0, 2)
                    .join(".")}`
                : "?";
            return `${name} on ${where} (${a.playState})`;
          }),
        ),
      });
  }
  const summary = {
    engine,
    shot,
    dialogVisibleAt: visible,
    screenshots: shots.length,
    changes: changed,
    changeTimes: shots.filter((s, i) => i > 0 && !s.same).map((s) => Number(s.at.toFixed(2))),
    animations,
  };
  writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify({ engine, visible, screenshots: shots.length, changes: changed, changeTimes: summary.changeTimes }));
  const seen = new Map<string, number[]>();
  for (const a of animations) for (const r of a.running) seen.set(r, [...(seen.get(r) ?? []), Number(a.at.toFixed(1))]);
  for (const [r, ts] of seen) console.log(`  ${r}: seen ${ts.length} times, ${ts[0]}s to ${ts[ts.length - 1]}s`);
} finally {
  await browser.close();
  server.stop();
}
