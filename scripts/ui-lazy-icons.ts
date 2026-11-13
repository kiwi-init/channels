import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";
import { pageErrors } from "./page-errors.ts";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = flag("--browser") ?? "webkit";
if (engine !== "webkit" && engine !== "chromium") throw new Error(`--browser is webkit or chromium, not ${engine}`);

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});
const browser = await (engine === "webkit" ? webkit : chromium).launch();
const fails: string[] = [];
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};

const LATER = ["Gif01Icon", "LinkSquare02Icon", "Link01Icon", "AtIcon", "Download01Icon", "UserCircleIcon", "ComputerPhoneSyncIcon", "ComputerIcon", "SmartPhone01Icon"];
const GONE = ["Sun03Icon", "Moon02Icon", "TaskDone01Icon"];
const icons = join(import.meta.dir, "../ui/node_modules/@hugeicons/core-free-icons/dist/esm");
const html = readFileSync(join(dist, "index.html"), "utf8");
const firstFiles = [...html.matchAll(/<script type="module"[^>]*src="\/([^"]+)"|<link rel="modulepreload"[^>]*href="\/([^"]+)"/g)].map(([, a, b]) => a ?? b ?? "");
const firstLoad = firstFiles.map((f) => readFileSync(join(dist, f), "utf8")).join("\n");
const later = readdirSync(join(dist, "assets"))
  .filter((f) => f.endsWith(".js") && !firstFiles.includes(`assets/${f}`))
  .map((f) => readFileSync(join(dist, "assets", f), "utf8"))
  .join("\n");
const path = (name: string) => /d: "([^"]+)"/.exec(readFileSync(join(icons, `${name}.js`), "utf8"))?.[1] ?? `missing path for ${name}`;
expect(firstFiles.length > 1, `read the first load from index.html: the entry plus ${firstFiles.length - 1} preloaded files`);
for (const name of LATER) {
  const d = path(name);
  expect(!firstLoad.includes(d) && later.includes(d), `${name} is in a chunk that loads later, not in the first load`);
}
for (const name of GONE) expect(!firstLoad.includes(path(name)), `${name}, which nothing used, is out of the first load`);

const drawn = (page: Page, scope: string) =>
  page.evaluate((sel) => {
    const icons = [...document.querySelectorAll(`${sel} svg.icon`)];
    return { all: icons.length, drawn: icons.filter((i) => i.childElementCount > 0 && i.getBoundingClientRect().width > 0).length };
  }, scope);
const settle = (page: Page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

async function visit(shot: string, checks: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await pageErrors(page, (e) => fails.push(`${shot}: page threw: ${e}`));
  await page.goto(`http://127.0.0.1:${server.port}/?shot=${shot}`);
  await page.locator("svg.icon").first().waitFor();
  await settle(page);
  await checks(page);
  const empty = await page.evaluate(() => [...document.querySelectorAll("svg.icon")].filter((i) => i.childElementCount === 0).length);
  expect(empty === 0, `${shot}: no icon on the page is empty (${empty} empty)`);
  await page.close();
}

await visit("settings-devices", async (page) => {
  await page.locator(".ctl-head > .ctl-mark svg.icon").first().waitFor();
  const devices = await drawn(page, ".ctl-head > .ctl-mark");
  expect(devices.all > 0 && devices.drawn === devices.all, `Settings, Computers: each computer and phone has its icon drawn (${devices.drawn} of ${devices.all})`);
  const add = await drawn(page, ".pg-acts");
  expect(add.all === 2 && add.drawn === 2, `the add-a-computer and link-a-phone buttons have theirs (${add.drawn} of ${add.all})`);
  const sections = await drawn(page, ".side-icon");
  expect(sections.all >= 5 && sections.drawn === sections.all, `every Settings section, Account and Computers included, has its icon (${sections.drawn} of ${sections.all})`);
});

await visit("github-pr", async (page) => {
  await page.locator(".btn.is-primary svg.icon").first().waitFor();
  const out = await drawn(page, ".btn.is-primary");
  expect(out.all > 0 && out.drawn === out.all, `a pull request's open-on-GitHub button has its external-link icon (${out.drawn} of ${out.all})`);
});

await visit("welcome", async (page) => {
  const join = page.locator("button", { hasText: /^Join/ }).first();
  await join.waitFor();
  const icons = await join.locator("svg.icon").evaluateAll((all) => all.map((i) => i.childElementCount));
  expect(icons.length === 1 && (icons[0] ?? 0) > 0, "Home's Join button has its link icon");
});

await visit("channel", async (page) => {
  await page.keyboard.press("Control+k");
  const dialog = page.locator("dialog[open]").first();
  await dialog.waitFor();
  await page.keyboard.type("join");
  await settle(page);
  const join = await drawn(page, "dialog[open]");
  expect(join.all > 0 && join.drawn === join.all, `the palette's Join action has its link icon (${join.drawn} of ${join.all})`);
  await page.keyboard.press("Control+a");
  await page.keyboard.type("computers");
  await settle(page);
  const computers = await drawn(page, "dialog[open]");
  expect(computers.all > 0 && computers.drawn === computers.all, `and its Computers action its computer icon (${computers.drawn} of ${computers.all})`);
});

await visit("channel", async (page) => {
  const msg = page.locator(".main article.msg").last();
  await msg.hover();
  const gif = page.locator("[data-gif-toggle] svg.icon").first();
  await gif.waitFor();
  expect((await gif.evaluate((i) => i.childElementCount)) > 0, "a message's GIF reaction button has its icon");
});

await visit("channel-settings", async (page) => {
  await page.locator("dialog[open]").first().waitFor();
  const shown = await drawn(page, "dialog[open]");
  expect(shown.drawn === shown.all, `channel settings: every icon drawn (${shown.drawn} of ${shown.all})`);
});

try {
  if (fails.length) {
    console.error(fails.join("\n"));
    process.exit(1);
  }
} finally {
  await browser.close();
  await server.stop(true);
}
