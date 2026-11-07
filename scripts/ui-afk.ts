import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright-core";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const out = flag("--shots");
if (out) mkdirSync(out, { recursive: true });
const engine = process.argv.includes("--webkit") ? webkit : chromium;
const site = join(import.meta.dir, "../site");
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(path.startsWith("/reactions/") ? resolve(site, "." + path) : join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});
const failures: string[] = [];
const check = (what: string, ok: boolean) => {
  if (!ok) failures.push(what);
  console.log(`${ok ? "✓" : "✗"} ${what}`);
};
const browser = await engine.launch();
try {
  for (const [label, width, height] of [
    ["wide", 1440, 900],
    ["narrow", 720, 760],
  ] as const) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const theme of ["dark", "light"]) {
      await page.goto(`http://127.0.0.1:${server.port}/?shot=afk&theme=${theme}`);
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(3600);
      if (out) await page.screenshot({ path: join(out, `afk-${label}-${theme}.png`) });
      await page.locator(".afk-spot-label").first().hover();
      await page.waitForTimeout(400);
      if (out) await page.screenshot({ path: join(out, `afk-${label}-${theme}-hover.png`) });
    }
    if (label === "wide") {
      await page.goto(`http://127.0.0.1:${server.port}/?shot=afk`);
      await page.waitForTimeout(2600);
      check("the overlay is a dialog over the app", (await page.getByRole("dialog", { name: "AFK" }).count()) === 1);
      const box = await page.locator(".afk").boundingBox();
      check(`it covers the whole window (${JSON.stringify(box)})`, !!box && box.x === 0 && box.y === 0 && box.width === width && box.height === height);
      const typed = await page.evaluate(() => {
        let reached = false;
        const mark = () => (reached = true);
        document.addEventListener("keydown", mark);
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }));
        document.removeEventListener("keydown", mark);
        return reached;
      });
      check("a key that wakes it never reaches the app", !typed);
      await page.waitForTimeout(900);
      check("a key fades it out", (await page.locator(".afk").count()) === 0);
      await page.goto(`http://127.0.0.1:${server.port}/?shot=afk`);
      await page.waitForTimeout(2600);
      const pins = await page.locator(".afk-spot").count();
      check(`each channel is a pin on the scene (${pins})`, pins > 1);
      const pulse = (sel: string) =>
        page
          .locator(sel)
          .first()
          .evaluate((el) => getComputedStyle(el, "::after").animationName);
      const loud = await pulse(".afk-spot.is-needs .afk-spot-pin");
      const quiet = await pulse(".afk-spot:not(.is-needs) .afk-spot-pin");
      check(`a pin that needs you pulses (${loud}) and a quiet one doesn't (${quiet})`, loud === "afk-pulse" && quiet === "none");
      const current = () => page.evaluate(() => document.querySelector('nav[aria-label="Channels"] button.tile[aria-current="page"]')?.getAttribute("aria-label")?.split(",")[0] ?? "");
      const target = page.locator(".afk-spot:not(.is-needs) .afk-spot-label").first();
      const name = (await target.locator("b").textContent()) ?? "";
      await target.click();
      await page.waitForTimeout(900);
      check(`a click on a quiet channel (${name}) opens it and the sky goes`, (await current()) === name && (await page.locator(".afk").count()) === 0);
      await page.goto(`http://127.0.0.1:${server.port}/?shot=afk`);
      await page.waitForTimeout(2600);
      await page.locator(".afk-spot.is-needs .afk-spot-label").first().click();
      await page.waitForTimeout(900);
      const pressed = await page.locator('button.is-needs[aria-pressed="true"]').count();
      check(`a click on a channel that needs you opens its Needs (${await current()}) and the sky goes`, pressed === 1 && (await page.locator(".afk").count()) === 0);
      await page.goto(`http://127.0.0.1:${server.port}/?shot=afk`);
      await page.waitForTimeout(2600);
      await page.mouse.move(10, 10);
      await page.mouse.move(400, 300);
      await page.waitForTimeout(300);
      check("moving the mouse keeps it, so a channel can be picked", (await page.locator(".afk").count()) === 1);
      await page.mouse.click(20, height - 20);
      await page.waitForTimeout(900);
      check("a click on the sky fades it out", (await page.locator(".afk").count()) === 0);
      await page.keyboard.press("ControlOrMeta+t");
      await page.waitForTimeout(600);
      check("⌘T / Ctrl+T opens it at once", (await page.getByRole("dialog", { name: "AFK" }).count()) === 1);
      await page.keyboard.press("ControlOrMeta+t");
      await page.waitForTimeout(900);
      check("⌘T / Ctrl+T again closes it", (await page.locator(".afk").count()) === 0);
      const still = await browser.newPage({ viewport: { width, height } });
      await still.addInitScript(() => {
        const seen = new Set<string>();
        Object.assign(window, { afkNames: seen });
        const look = (): void => {
          const names = [...document.querySelectorAll(".afk-spot-label b")].map((n) => n.textContent ?? "");
          if (names.length) seen.add(JSON.stringify(names));
          requestAnimationFrame(look);
        };
        requestAnimationFrame(look);
      });
      await still.goto(`http://127.0.0.1:${server.port}/?shot=afk-still`);
      await still.waitForTimeout(2600);
      const motion = await still.evaluate(() => document.documentElement.dataset.motion ?? "");
      const seen = await still.evaluate(() => [...((window as unknown as { afkNames: Set<string> }).afkNames ?? [])]);
      check(`with the app's Reduce motion on (${motion}), the channel names show whole from the first frame (${seen.join(" then ")})`, motion === "reduced" && seen.length === 1);
      const scene = await still.evaluate(() => document.querySelector(".afk-back canvas")?.getAttribute("data-meadow") ?? "none");
      check(`and the meadow behind it doesn't move (${scene})`, scene !== "moving");
      await still.goto(`http://127.0.0.1:${server.port}/?shot=onboarding-still`);
      await still.waitForTimeout(2600);
      const intro = await still.evaluate(() => document.querySelector("canvas[data-meadow]")?.getAttribute("data-meadow") ?? "none");
      check(`the onboarding's meadow holds still for it too (${intro})`, intro !== "moving" && intro !== "none");
      await still.close();
    }
    check(`no page errors (${label})`, errors.length === 0);
    await page.close();
  }
} finally {
  await browser.close();
  await server.stop(true);
}
if (failures.length) process.exitCode = 1;
