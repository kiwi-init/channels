import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright-core";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = flag("--browser") ?? "webkit";
if (engine !== "webkit" && engine !== "chromium") throw new Error(`unknown browser ${engine}`);
const shots = flag("--shots");
if (shots) mkdirSync(shots, { recursive: true });
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});
const browserType = engine === "webkit" ? webkit : chromium;
const browser = process.env.PW_WS ? await browserType.connect({ wsEndpoint: process.env.PW_WS, exposeNetwork: "<loopback>" }) : await browserType.launch();
const fails: string[] = [];
let passes = 0;
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (ok) passes++;
  else fails.push(what);
};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, reducedMotion: "reduce" });
  page.on("pageerror", (e) => fails.push(e.message));
  const cases = [
    { shot: "dm-departed-human", label: "Mira", human: true, left: true },
    { shot: "dm-departed-agent", label: "scout", human: false, left: true },
    { shot: "dm-unknown", label: "Unlisted", human: false, left: false },
    { shot: "dm-current-human", label: "maya", human: true, left: false },
    { shot: "dm-current-agent", label: "atlas", human: false, left: false },
  ];
  for (const c of cases) {
    await page.goto(`http://127.0.0.1:${server.port}/?shot=${c.shot}`);
    const intro = page.locator(".feed-start-title");
    await intro.waitFor();
    const row = page.locator('.side .side-row[aria-current="page"]');
    const expected = c.human ? `These are sent to you and ${c.label} alone.` : `Everyone in the channel can read your messages with ${c.label}.`;
    expect((await intro.innerText()).includes(expected), `${c.shot}: intro describes the human or agent conversation`);
    expect((await row.innerText()).includes(c.label), `${c.shot}: the historical or current DM remains accessible by nickname`);
    expect((await row.locator(".side-state", { hasText: /^left$/ }).count()) === Number(c.left), `${c.shot}: left state matches departure, including humans`);
    expect(((await row.getAttribute("title")) === "Left the channel") === c.left, `${c.shot}: departure tooltip matches the left state`);
    if (shots && c.shot === "dm-departed-human") {
      await page.getByText("Now", { exact: true }).first().waitFor();
      await page.waitForTimeout(350);
      await page.screenshot({ path: join(shots, `${process.argv.includes("--before") ? "before" : "after"}.png`) });
    }
  }
} finally {
  await browser.close();
  server.stop(true);
}
console.log(`${passes} pass, ${fails.length} fail`);
if (fails.length) {
  console.error(fails.join("\n"));
  process.exit(1);
}
