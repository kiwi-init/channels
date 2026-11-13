import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};

if (process.argv.includes("--help")) {
  console.log(`Drives the app's four dismissable popovers (a message's GIF picker, the composer's + menu and its GIF picker, the updates panel,
the usage card and a rail folder's menu with its name field) through Escape, Tab, arrow keys, pointer presses inside, outside, on
the toggle, on document and on window, an open <dialog>, window blur and resize. For each it records whether the popover is
still open, whether the event was default-prevented, how far it propagated, page errors, the menu field's save or discard,
and which keydown, pointerdown, blur and resize listeners the popover holds on window and document while open and after it
closes. The result must equal the one recorded from main before the popovers shared one dismissal hook.

  bun scripts/ui-dismiss.ts --dist ui/dist --browser webkit|chromium        compare with scripts/ui-dismiss-base.json
  bun scripts/ui-dismiss.ts --dist DIR --browser ENGINE --write FILE         record the result for ENGINE into FILE`);
  process.exit(0);
}

const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = flag("--browser") ?? "webkit";
if (engine !== "webkit" && engine !== "chromium") throw new Error(`--browser is webkit or chromium, not ${engine}`);
const write = flag("--write");
const BASE = join(import.meta.dir, "ui-dismiss-base.json");

const CATALOG = [
  { reaction: "yes", name: "nod", feeling: "agreeing" },
  { reaction: "wow", name: "gasp", feeling: "surprised" },
];

const INSTRUMENT = `(() => {
  const watched = new Set(["keydown", "pointerdown", "blur", "resize"]);
  const live = new Map();
  const where = (t) => (t === window ? "window" : t === document ? "document" : null);
  const phase = (o) => (typeof o === "boolean" ? o : !!(o && o.capture)) ? "capture" : "bubble";
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    const w = where(this);
    if (w && watched.has(type) && fn) {
      const key = w + " " + type + " " + phase(opts);
      if (!live.has(key)) live.set(key, new Set());
      live.get(key).add(fn);
    }
    return add.call(this, type, fn, opts);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    const w = where(this);
    if (w && watched.has(type) && fn) live.get(w + " " + type + " " + phase(opts))?.delete(fn);
    return remove.call(this, type, fn, opts);
  };
  const seen = [];
  const probe = (name) => () => seen.push(name);
  for (const type of watched) {
    add.call(window, type, probe("window capture"), true);
    add.call(window, type, probe("window bubble"), false);
  }
  const errors = [];
  add.call(window, "error", (e) => errors.push(String(e.message)), false);
  window.__dismiss = {
    listeners: () => Object.fromEntries([...live].filter(([, fns]) => fns.size).map(([k, fns]) => [k, fns.size]).sort(([a], [b]) => (a < b ? -1 : 1))),
    htmlProbe: () => {
      for (const type of watched) {
        add.call(document.documentElement, type, probe("html capture"), true);
        add.call(document.documentElement, type, probe("html bubble"), false);
      }
    },
    seen,
    errors,
  };
})()`;

type Listeners = Record<string, number>;
type Step = { step: string; open: boolean; prevented?: boolean; seen?: string[]; errors?: string[]; listeners: Listeners; folder?: string };
type Popover = { popover: string; steps: Step[] };

const delta = (now: Listeners, before: Listeners): Listeners =>
  Object.fromEntries(
    Object.keys({ ...now, ...before })
      .sort()
      .map((k) => [k, (now[k] ?? 0) - (before[k] ?? 0)] as const)
      .filter(([, n]) => n !== 0),
  );

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    if (path === "/reactions/index.json") return Response.json(CATALOG);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});

const settle = (page: Page) => page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 30)))));

type Target = "active" | "inside" | "outside" | "toggle" | "document" | "window";
type Spec = { name: string; shot: string; popover: string; toggle: string; open: (page: Page) => Promise<void> };

async function dispatch(page: Page, spec: Spec, kind: "keydown" | "pointerdown" | "blur" | "resize", target: Target, key = ""): Promise<{ prevented: boolean; seen: string[] }> {
  return page.evaluate(
    ({ kind, target, key, popover, toggle }) => {
      const d = (window as unknown as { __dismiss: { seen: string[] } }).__dismiss;
      d.seen.length = 0;
      const el =
        target === "window"
          ? window
          : target === "document"
            ? document
            : target === "active"
              ? (document.activeElement ?? document.body)
              : target === "inside"
                ? (document.querySelector(popover)?.firstElementChild ?? document.querySelector(popover))
                : target === "toggle"
                  ? document.querySelector(toggle)
                  : document.body;
      if (!el) return { prevented: false, seen: ["no target"] };
      const ev =
        kind === "keydown"
          ? new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true })
          : kind === "pointerdown"
            ? new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true, button: 0, pointerType: "mouse", isPrimary: true })
            : new Event(kind);
      el.dispatchEvent(ev);
      return { prevented: ev.defaultPrevented, seen: [...d.seen] };
    },
    { kind, target, key, popover: spec.popover, toggle: spec.toggle },
  );
}

const isOpen = async (page: Page, spec: Spec) => (await page.locator(spec.popover).count()) > 0;
const listeners = (page: Page) => page.evaluate(() => (window as unknown as { __dismiss: { listeners: () => Listeners } }).__dismiss.listeners());
const errors = (page: Page) => page.evaluate(() => (window as unknown as { __dismiss: { errors: string[] } }).__dismiss.errors.splice(0));

async function ensureOpen(page: Page, spec: Spec): Promise<void> {
  if (await isOpen(page, spec)) return;
  await spec.open(page);
  await page.locator(spec.popover).first().waitFor({ timeout: 10_000 });
  await settle(page);
}

const CASES: { step: string; kind: "keydown" | "pointerdown" | "blur" | "resize"; target: Target; key?: string; dialog?: true }[] = [
  { step: "ArrowDown", kind: "keydown", target: "active", key: "ArrowDown" },
  { step: "a letter", kind: "keydown", target: "active", key: "a" },
  { step: "Tab", kind: "keydown", target: "active", key: "Tab" },
  { step: "Escape", kind: "keydown", target: "active", key: "Escape" },
  { step: "Escape on body", kind: "keydown", target: "outside", key: "Escape" },
  { step: "pointer inside", kind: "pointerdown", target: "inside" },
  { step: "pointer on the toggle", kind: "pointerdown", target: "toggle" },
  { step: "pointer outside", kind: "pointerdown", target: "outside" },
  { step: "pointer on document", kind: "pointerdown", target: "document" },
  { step: "pointer on window", kind: "pointerdown", target: "window" },
  { step: "Escape with a dialog open", kind: "keydown", target: "active", key: "Escape", dialog: true },
  { step: "pointer outside with a dialog open", kind: "pointerdown", target: "outside", dialog: true },
  { step: "window blur", kind: "blur", target: "window" },
  { step: "window resize", kind: "resize", target: "window" },
];

async function drive(page: Page, spec: Spec): Promise<Popover> {
  await page.goto(`http://127.0.0.1:${server.port}/?shot=${spec.shot}`);
  await page.locator(spec.toggle).first().waitFor({ state: "attached", timeout: 15_000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => (window as unknown as { __dismiss: { htmlProbe: () => void } }).__dismiss.htmlProbe());
  await errors(page);
  const before = await listeners(page);
  const steps: Step[] = [];
  await ensureOpen(page, spec);
  steps.push({ step: "opened", open: true, listeners: delta(await listeners(page), before) });
  for (const c of CASES) {
    await ensureOpen(page, spec);
    if (c.dialog) await page.evaluate(() => document.body.append(Object.assign(document.createElement("dialog"), { id: "dismiss-probe-dialog", open: true })));
    const { prevented, seen } = await dispatch(page, spec, c.kind, c.target, c.key);
    await settle(page);
    if (c.dialog) await page.evaluate(() => document.getElementById("dismiss-probe-dialog")?.remove());
    steps.push({ step: c.step, open: await isOpen(page, spec), prevented, seen, errors: await errors(page), listeners: delta(await listeners(page), before) });
  }
  await ensureOpen(page, spec);
  await page
    .locator(spec.toggle)
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await settle(page);
  steps.push({ step: "toggle clicked while open", open: await isOpen(page, spec), errors: await errors(page), listeners: delta(await listeners(page), before) });
  await ensureOpen(page, spec);
  await ensureOpen(page, spec);
  steps.push({ step: "reopened", open: await isOpen(page, spec), listeners: delta(await listeners(page), before) });
  return { popover: spec.name, steps };
}

async function driveField(page: Page): Promise<Popover> {
  const spec: Spec = { name: "rail folder menu field", shot: "rail-folder", popover: "[role=menu].is-at-pointer", toggle: ".rail-folder", open: openFolderMenu };
  await page.goto(`http://127.0.0.1:${server.port}/?shot=${spec.shot}`);
  await page.locator(spec.toggle).first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => (window as unknown as { __dismiss: { htmlProbe: () => void } }).__dismiss.htmlProbe());
  await errors(page);
  const before = await listeners(page);
  const folderName = () =>
    page
      .locator(".rail-folder")
      .first()
      .evaluate((el) => el.querySelector("[aria-label]")?.getAttribute("aria-label") ?? el.textContent ?? "");
  const steps: Step[] = [];
  const typed = async (text: string) => {
    await ensureOpen(page, spec);
    await page.locator(`${spec.popover} input`).fill(text);
    await settle(page);
  };
  await typed("renamed by a click outside");
  const out = await dispatch(page, spec, "pointerdown", "outside");
  await settle(page);
  steps.push({ step: "typed, then pointer outside", open: await isOpen(page, spec), ...out, errors: await errors(page), listeners: delta(await listeners(page), before), folder: await folderName() });
  await typed("renamed then Escape");
  const esc = await dispatch(page, spec, "keydown", "active", "Escape");
  await settle(page);
  steps.push({ step: "typed, then Escape", open: await isOpen(page, spec), ...esc, errors: await errors(page), listeners: delta(await listeners(page), before), folder: await folderName() });
  await typed("renamed then blur");
  const blur = await dispatch(page, spec, "blur", "window");
  await settle(page);
  steps.push({ step: "typed, then window blur", open: await isOpen(page, spec), ...blur, errors: await errors(page), listeners: delta(await listeners(page), before), folder: await folderName() });
  await typed("renamed then Tab");
  const tab = await dispatch(page, spec, "keydown", "active", "Tab");
  await settle(page);
  steps.push({ step: "typed, then Tab", open: await isOpen(page, spec), ...tab, errors: await errors(page), listeners: delta(await listeners(page), before), folder: await folderName() });
  return { popover: spec.name, steps };
}

async function openFolderMenu(page: Page): Promise<void> {
  await page.locator(".rail-folder").first().click({ button: "right" });
}

const SPECS: Spec[] = [
  {
    name: "message GIF picker",
    shot: "thread-doc-events",
    popover: ".gifs.gifs-on-msg",
    toggle: "button.msg-tool[data-gif-toggle]",
    open: (page) =>
      page
        .locator("button.msg-tool[data-gif-toggle]")
        .first()
        .evaluate((el) => (el as HTMLElement).click()),
  },
  {
    name: "composer GIF picker",
    shot: "thread-doc-events",
    popover: ".gifs.gifs-on-compose",
    toggle: ".compose-attach[data-gif-toggle]",
    open: async (page) => {
      await page.locator(".compose-attach[data-gif-toggle]").first().click();
      await page.locator("[role=menu].is-at-pointer button", { hasText: "GIF" }).first().click();
    },
  },
  {
    name: "composer + menu",
    shot: "thread-doc-events",
    popover: "[role=menu].is-at-pointer",
    toggle: ".compose-attach[data-gif-toggle]",
    open: (page) => page.locator(".compose-attach[data-gif-toggle]").first().click(),
  },
  {
    name: "updates panel",
    shot: "thread-doc-events",
    popover: ".updates-panel",
    toggle: "[data-updates-toggle]",
    open: (page) => page.locator("[data-updates-toggle]").first().click(),
  },
  {
    name: "usage card",
    shot: "thread-doc-events",
    popover: ".usage-card",
    toggle: ".rail-usage",
    open: (page) => page.locator(".rail-usage").first().click(),
  },
  { name: "rail folder menu", shot: "rail-folder", popover: "[role=menu].is-at-pointer", toggle: ".rail-folder", open: openFolderMenu },
];

const browser = await (engine === "webkit" ? webkit : chromium).launch();
const result: Popover[] = [];
try {
  for (const spec of SPECS) {
    const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
    await page.addInitScript(INSTRUMENT);
    result.push(await drive(page, spec));
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
  await page.addInitScript(INSTRUMENT);
  result.push(await driveField(page));
  await page.close();
} finally {
  await browser.close();
  await server.stop(true);
}

if (write) {
  const out = existsSync(write) ? (JSON.parse(readFileSync(write, "utf8")) as Record<string, unknown>) : {};
  out[engine] = result;
  writeFileSync(write, JSON.stringify(out, null, 2) + "\n");
  console.log(`recorded ${result.length} popovers for ${engine} into ${write}`);
  process.exit(0);
}

const base = (JSON.parse(readFileSync(BASE, "utf8")) as Record<string, Popover[]>)[engine] ?? [];
const fails: string[] = [];
for (const [i, want] of base.entries()) {
  const got = result[i];
  for (const [j, step] of want.steps.entries()) {
    const ok = JSON.stringify(got?.steps[j]) === JSON.stringify(step);
    console.log(`${ok ? "ok  " : "FAIL"} ${want.popover}: ${step.step}`);
    if (!ok) fails.push(`${want.popover}: ${step.step}\n  base ${JSON.stringify(step)}\n  head ${JSON.stringify(got?.steps[j])}`);
  }
}
if (JSON.stringify(result.map((p) => [p.popover, p.steps.length])) !== JSON.stringify(base.map((p) => [p.popover, p.steps.length]))) fails.push("the popovers or their steps differ from the base's");
if (fails.length) {
  console.error(fails.join("\n"));
  process.exit(1);
}
