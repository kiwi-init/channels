import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, webkit } from "playwright-core";
import type {} from "../ui/src/demo/room-members-api.ts";

const engine = process.argv.includes("--chromium") ? chromium : webkit;
const before = process.argv.includes("--before");
const shotAt = process.argv.indexOf("--shots");
const shots = shotAt < 0 ? undefined : process.argv[shotAt + 1];
if (shots) mkdirSync(shots, { recursive: true });
const out = mkdtempSync(join(tmpdir(), "kiwi-room-members-"));
const built = await Bun.build({
  entrypoints: [join(import.meta.dir, "../ui/src/demo/room-members-page.tsx")],
  outdir: out,
  target: "browser",
  minify: true,
  external: ["/fonts/*"],
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false", "import.meta.env.PROD": "true" },
});
if (!built.success) throw new Error(built.logs.map(String).join("\n"));
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    const path = new URL(req.url).pathname;
    return path === "/"
      ? new Response(
          '<!doctype html><html data-theme="dark"><meta charset="utf-8"><link rel="stylesheet" href="/room-members-page.css"><div id="root"></div><script type="module" src="/room-members-page.js"></script></html>',
          { headers: { "content-type": "text/html" } },
        )
      : new Response(Bun.file(path.startsWith("/fonts/") ? join(import.meta.dir, "../ui/public", path) : join(out, path)));
  },
});
const browser = process.env.PW_WS ? await engine.connect({ wsEndpoint: process.env.PW_WS, exposeNetwork: "<loopback>" }) : await engine.launch();
const fails: string[] = [];
let passes = 0;
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (ok) passes++;
  else fails.push(what);
};
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 }, reducedMotion: "reduce" });
  page.on("pageerror", (e) => fails.push(`page threw: ${e.message}`));
  await page.goto(`http://127.0.0.1:${server.port}/`);
  const dialog = page.getByRole("dialog", { name: "Channel settings" });
  const summary = dialog.locator(".cset-room-who");
  const change = dialog.getByRole("button", { name: "Change who's in" });
  const pick = dialog.locator(".room-pick");
  const checked = () => pick.locator("label").evaluateAll((labels) => labels.filter((l) => l.querySelector("input")?.checked).map((l) => l.querySelector(".room-member-name")?.textContent));
  await change.click();
  expect(!(await summary.innerText()).includes("scout"), "summary excludes the departed stored agent");
  expect((await pick.locator("label", { hasText: "scout" }).count()) === 0, "departed agent is absent from the picker");
  expect(JSON.stringify(await checked()) === JSON.stringify(["maya", "atlas"]), "opening normalizes the phone seat and checks current members");
  await page.locator(".av-face svg").first().waitFor();
  if (shots) await page.screenshot({ path: join(shots, `${before ? "before" : "after"}.png`) });
  if (before) {
    await page.evaluate(() => window.roomCheck.update(["jow", "maya-phone", "atlas", "win"]));
    await page.waitForTimeout(50);
    expect((await checked()).includes("win"), "an incoming member becomes checked while the editor is open");
  }
  if (!before) {
    await pick.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForTimeout(100);
    expect((await pick.count()) === 0, "unchanged save succeeds and closes the editor");
    expect(JSON.stringify(await page.evaluate(() => window.roomCheck.saved.at(-1))) === JSON.stringify(["maya", "atlas"]), "actual save payload contains only the current normalized members");
    await change.click();
    await page.evaluate(() => window.roomCheck.update(["jow", "maya-phone", "atlas", "win"]));
    await page.waitForTimeout(50);
    expect((await checked()).includes("win"), "an incoming member becomes checked while the editor is open");
    await pick
      .locator("label", { hasText: /^atlas$/ })
      .getByRole("checkbox")
      .uncheck();
    await page.evaluate(() => window.roomCheck.update(["jow", "atlas", "win", "pixel"]));
    await page.waitForTimeout(50);
    expect(
      !(await checked()).includes("atlas") && !(await checked()).includes("maya") && (await checked()).includes("pixel"),
      "incoming additions and removals apply without overwriting an explicit uncheck",
    );
    await pick
      .locator("label", { hasText: /^maya$/ })
      .getByRole("checkbox")
      .check();
    await page.evaluate(() => window.roomCheck.update(["jow", "atlas", "win", "pixel"]));
    await page.waitForTimeout(50);
    expect((await checked()).includes("maya"), "an explicit addition survives another membership update");
    await page.evaluate(() => window.roomCheck.leave("maya", true));
    await page.waitForTimeout(50);
    await pick.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForTimeout(50);
    expect(!(await page.evaluate(() => window.roomCheck.saved.at(-1)))?.includes("maya"), "departure removes a selected identity from the actual save payload");
    await change.click();
    await page.evaluate(() => {
      window.roomCheck.leave("maya", false);
      window.roomCheck.update(["jow", "maya", "win"]);
    });
    await page.waitForTimeout(50);
    expect((await checked()).includes("maya"), "a rejoined member follows the current room membership");
    await page.evaluate(() => window.roomCheck.fail(true));
    await page.waitForTimeout(50);
    await pick.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForTimeout(50);
    expect((await pick.count()) === 1 && (await checked()).includes("maya"), "a failed save keeps the editor and selection available");
    await page.evaluate(() => window.roomCheck.fail(false));
    await pick.getByRole("button", { name: "Cancel", exact: true }).click();
    await change.click();
    expect((await checked()).includes("maya"), "cancel and reopen start from current room membership");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await page.waitForTimeout(350);
    if (shots) await page.screenshot({ path: join(shots, "after-light.png") });
  }
} finally {
  await browser.close();
  server.stop(true);
  rmSync(out, { recursive: true, force: true });
}
console.log(`${passes} pass, ${fails.length} fail`);
if (fails.length) process.exit(1);
