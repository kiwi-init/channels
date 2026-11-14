import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright-core";
import { pageErrors } from "./page-errors.ts";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};

if (process.argv.includes("--help")) {
  console.log(`Holds the markdown parser's async parse for some painted frames while a page that draws its own controls re-renders (#2423):
Channel settings and the task pane. They make new action links on every render, so a parse that lands late must never leave
the old tree drawn with the new controls: no native checkboxes, no empty body, no missing controls, and a control pressed in
that window runs its current action.

  bun scripts/ui-sheet-parse.ts --dist ui/dist [--browser webkit|chromium] [--hold 8] [--shots DIR]

--shots saves each page a few frames into a 60-frame hold, for a before and after picture.`);
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

type Scene = { name: string; shot: string; root: string; control: string; first: string; again: string; least: number; frame: string };
type Sample = { boxes: number; controls: number; text: number };
type Run = { samples: Sample[]; before: string[]; after: string[]; held: number; hit: string };

const SCENES: Scene[] = [
  {
    name: "Channel settings",
    shot: "channel-settings",
    root: ".cset .ctl-page",
    control: '[role="switch"]',
    first: "Mute on this computer",
    again: "Mute on this computer",
    least: 3,
    frame: '[role="dialog"]',
  },
  { name: "the task pane", shot: "task-working", root: ".page-text", control: "button.btn", first: "Mark done", again: "Reopen", least: 4, frame: ".page-text" },
];

const PRESS = async ({ hold, scene }: { hold: number; scene: Scene }): Promise<Run> => {
  const w = window as unknown as { holdFrames: number; parsesHeld: number };
  const roots = () => [...document.querySelectorAll(scene.root)];
  const controls = () => roots().flatMap((r) => [...r.querySelectorAll<HTMLElement>(scene.control)]);
  const nameOf = (c: Element) => c.getAttribute("aria-label") ?? c.textContent?.trim() ?? "";
  const states = () => controls().map((c) => `${nameOf(c)}${c.hasAttribute("aria-checked") ? `=${c.getAttribute("aria-checked")}` : ""}`);
  const frame = () => new Promise((done) => requestAnimationFrame(done));
  const sample = (): Sample => ({
    boxes: roots().reduce((n, r) => n + r.querySelectorAll('input[type="checkbox"]').length, 0),
    controls: controls().length,
    text: roots().reduce((n, r) => n + (r.textContent?.trim().length ?? 0), 0),
  });
  const first = controls().find((c) => nameOf(c) === scene.first);
  if (!first) throw new Error(`no ${scene.first} control in ${scene.name}`);
  const box = first.getBoundingClientRect();
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
  first.click();
  await frame();
  await frame();
  const there = document.elementFromPoint(x, y);
  const control = there?.closest(scene.control);
  const hit = control ? `the ${nameOf(control)} control` : there ? `<${there.tagName.toLowerCase()}${there instanceof HTMLInputElement ? ` type=${there.type}` : ""}>` : "nothing";
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
  for (const scene of SCENES) {
    console.log(`${scene.name} (?shot=${scene.shot}):`);
    wrapped = 0;
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await pageErrors(page, (e) => fails.push(`page threw: ${e}`));
    await page.addInitScript(HOLD);
    await page.goto(`http://127.0.0.1:${server.port}/?shot=${scene.shot}`);
    await page.waitForFunction(
      ({ root, control, name }) => [...document.querySelectorAll(root)].some((r) => [...r.querySelectorAll(control)].some((e) => (e.getAttribute("aria-label") ?? e.textContent?.trim()) === name)),
      { root: scene.root, control: scene.control, name: scene.first },
      { timeout: 20_000 },
    );
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1000);
    expect(wrapped === 1, `the bundle has one async markdown parse to hold, found ${wrapped}`);
    const loaded = await page.evaluate(() => (window as unknown as { parsesHeld: number }).parsesHeld);
    expect(loaded > 0, `the hold runs in this bundle: ${loaded} parses held while the page loaded`);

    const run = await page.evaluate(PRESS, { hold, scene });
    const plain = run.samples.filter((s) => s.boxes !== 0).length;
    const empty = run.samples.filter((s) => s.text === 0).length;
    const fewer = run.samples.filter((s) => s.controls < scene.least).length;
    console.log(`     ${run.samples.length} frames sampled, ${run.held} async parses held ${hold} frames each, second press landed on ${run.hit}`);
    expect(plain === 0, `no frame draws ${scene.name} as plain markdown with native checkboxes (${plain} of ${run.samples.length} did)`);
    expect(empty === 0, `no frame draws ${scene.name} with an empty body (${empty} of ${run.samples.length} did)`);
    expect(fewer === 0, `every frame keeps at least ${scene.least} of its controls (${fewer} of ${run.samples.length} had fewer)`);
    expect(run.hit === `the ${scene.again} control`, `the second press, two frames after the rows changed, lands on ${scene.again} (it landed on ${run.hit})`);
    expect(
      JSON.stringify(run.after) === JSON.stringify(run.before),
      `pressing ${scene.first} then ${scene.again} runs only their current actions, and ${scene.name} ends where it started: ${JSON.stringify(run.before)} -> ${JSON.stringify(run.after)}`,
    );

    if (shots) {
      mkdirSync(shots, { recursive: true });
      const file = join(shots, `${scene.shot}-held-${engine}.png`);
      await page.evaluate(() => {
        (window as unknown as { holdFrames: number }).holdFrames = 60;
      });
      const pressed = await page.evaluate(
        ({ root, control, names }) => {
          const c = [...document.querySelectorAll(root)]
            .flatMap((r) => [...r.querySelectorAll<HTMLElement>(control)])
            .find((e) => names.includes(e.getAttribute("aria-label") ?? e.textContent?.trim() ?? ""));
          c?.click();
          return c?.getAttribute("aria-label") ?? c?.textContent?.trim() ?? null;
        },
        { root: scene.root, control: scene.control, names: [scene.first, scene.again] },
      );
      if (pressed === null) throw new Error(`no ${scene.first} or ${scene.again} control in ${scene.name} to press for the shot`);
      await page.waitForTimeout(150);
      await page.locator(scene.frame).first().screenshot({ path: file });
      await page.waitForTimeout(1500);
      console.log(`     saved ${file}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  await server.stop(true);
}
if (fails.length) {
  console.error(fails.join("\n"));
  process.exit(1);
}
