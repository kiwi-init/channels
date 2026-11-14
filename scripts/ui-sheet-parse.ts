import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright-core";
import { pageErrors } from "./page-errors.ts";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};

if (process.argv.includes("--help")) {
  console.log(`Holds the markdown parser's async parse for some painted frames while the Channel settings sheet re-renders (#2423).
The settings page makes new action links on every render, so a parse that lands late must never leave the old tree drawn
with the new controls: no native checkboxes, no empty body, and a switch pressed in that window runs its current action.

  bun scripts/ui-sheet-parse.ts --dist ui/dist [--browser webkit|chromium] [--hold 8] [--shots DIR]

--shots saves the sheet a few frames into a 60-frame hold, for a before and after picture.`);
  process.exit(0);
}

const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = flag("--browser") ?? "webkit";
if (engine !== "webkit" && engine !== "chromium") throw new Error(`--browser is webkit or chromium, not ${engine}`);
const hold = Number(flag("--hold") ?? "8");
if (!Number.isInteger(hold) || hold < 2) throw new Error(`--hold is a whole number of frames, 2 or more, not ${flag("--hold")}`);
const shots = flag("--shots");

const ASYNC_PARSE = /async function ([\w$]+)\(([\w$]+),([\w$]+)=\{\}\)\{return ([\w$]+)\(await ([\w$]+)\(\),\2,\3\)\}/g;
let wrapped = 0;

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    if (!(await file.exists())) return new Response("not found", { status: 404 });
    if (!path.endsWith(".js")) return new Response(file);
    const code = await file.text();
    const held = code.replace(ASYNC_PARSE, (...m: string[]) => {
      wrapped++;
      return `async function ${m[1]}(${m[2]},${m[3]}={}){let parser=await ${m[5]}();await globalThis.parseHold?.();return ${m[4]}(parser,${m[2]},${m[3]})}`;
    });
    return new Response(held, { headers: { "content-type": "text/javascript" } });
  },
});

const HOLD = () => {
  const w = window as unknown as { holdFrames: number; parsesHeld: number; parseHold: () => Promise<void> };
  w.holdFrames = 2;
  w.parsesHeld = 0;
  w.parseHold = () => {
    w.parsesHeld++;
    let left = w.holdFrames;
    return new Promise((done) => {
      const step = () => (left-- <= 0 ? done() : void requestAnimationFrame(step));
      step();
    });
  };
};

type Sample = { boxes: number; switches: number; text: number };
type Run = { samples: Sample[]; before: string[]; after: string[]; held: number; hit: string };

const PRESS = async ({ hold, label }: { hold: number; label: string }): Promise<Run> => {
  const w = window as unknown as { holdFrames: number; parsesHeld: number };
  const sheet = () => document.querySelector(".cset .ctl-page");
  const states = () => [...(sheet()?.querySelectorAll('[role="switch"]') ?? [])].map((s) => `${s.getAttribute("aria-label")}=${s.getAttribute("aria-checked")}`);
  const frame = () => new Promise((done) => requestAnimationFrame(done));
  const sample = (): Sample => ({
    boxes: sheet()?.querySelectorAll('input[type="checkbox"]').length ?? -1,
    switches: sheet()?.querySelectorAll('[role="switch"]').length ?? -1,
    text: sheet()?.textContent?.trim().length ?? 0,
  });
  const mute = sheet()?.querySelector<HTMLElement>(`[role="switch"][aria-label="${label}"]`);
  if (!mute) throw new Error(`no ${label} switch in the sheet`);
  const box = mute.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const before = states();
  const held = w.parsesHeld;
  const samples: Sample[] = [];
  let watching = true;
  const watch = () => {
    if (!watching) return;
    samples.push(sample());
    requestAnimationFrame(watch);
  };
  w.holdFrames = hold;
  requestAnimationFrame(watch);
  mute.click();
  await frame();
  await frame();
  const there = document.elementFromPoint(x, y);
  const toggle = there?.closest('[role="switch"]');
  const hit = toggle ? `the ${toggle.getAttribute("aria-label")} switch` : there ? `a ${there.tagName.toLowerCase()}${there instanceof HTMLInputElement ? ` ${there.type}` : ""}` : "nothing";
  (there instanceof HTMLElement ? there : null)?.click();
  for (let i = 0; i < hold + 20; i++) await frame();
  watching = false;
  w.holdFrames = 2;
  return { samples, before, after: states(), held: w.parsesHeld - held, hit };
};

const browser = await (engine === "webkit" ? webkit : chromium).launch();
const fails: string[] = [];
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await pageErrors(page, (e) => fails.push(`page threw: ${e}`));
  await page.addInitScript(HOLD);
  await page.goto(`http://127.0.0.1:${server.port}/?shot=channel-settings`);
  const dialog = page.getByRole("dialog", { name: "Channel settings" });
  const label = "Mute on this computer";
  await dialog.locator(`.ctl-page [role="switch"][aria-label="${label}"]`).waitFor({ timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1000);
  expect(wrapped === 1, `the bundle has one async markdown parse to hold, found ${wrapped}`);
  const loaded = await page.evaluate(() => (window as unknown as { parsesHeld: number }).parsesHeld);
  expect(loaded > 0, `the hold runs in this bundle: ${loaded} parses held while the page loaded`);

  const run = await page.evaluate(PRESS, { hold, label });
  const plain = run.samples.filter((s) => s.boxes !== 0).length;
  const empty = run.samples.filter((s) => s.text === 0).length;
  const fewer = run.samples.filter((s) => s.switches < run.before.length).length;
  console.log(`     ${run.samples.length} frames sampled, ${run.held} async parses held ${hold} frames each, second press landed on ${run.hit}`);
  expect(plain === 0, `no frame draws the sheet as plain markdown with native checkboxes (${plain} of ${run.samples.length} did)`);
  expect(empty === 0, `no frame draws an empty sheet body (${empty} of ${run.samples.length} did)`);
  expect(fewer === 0, `every frame keeps all ${run.before.length} switches (${fewer} of ${run.samples.length} had fewer)`);
  expect(run.hit === `the ${label} switch`, `the second press, two frames after the rows changed, lands on the ${label} switch (it landed on ${run.hit})`);
  expect(
    JSON.stringify(run.after) === JSON.stringify(run.before),
    `pressing ${label} twice runs only its own current action, and every other switch keeps its state: ${JSON.stringify(run.before)} -> ${JSON.stringify(run.after)}`,
  );

  if (shots) {
    mkdirSync(shots, { recursive: true });
    await page.evaluate(() => {
      (window as unknown as { holdFrames: number }).holdFrames = 60;
    });
    await dialog.locator(`.ctl-page [role="switch"][aria-label="${label}"]`).click();
    await page.waitForTimeout(150);
    await dialog.screenshot({ path: join(shots, `sheet-held-${engine}.png`) });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      (window as unknown as { holdFrames: number }).holdFrames = 2;
    });
    console.log(`     saved ${join(shots, `sheet-held-${engine}.png`)}`);
  }
} finally {
  await browser.close();
  await server.stop(true);
}
if (fails.length) {
  console.error(fails.join("\n"));
  process.exit(1);
}
