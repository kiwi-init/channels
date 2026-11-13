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
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  page.on("pageerror", (e) => fails.push(e.message));
  const panel = page.locator(".panel");
  const reviewer = panel.locator("dt", { hasText: /^Reviewer$/ }).locator("+ dd");
  const screenshot = async (suffix: string) => {
    if (!shots) return;
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(shots, `${process.argv.includes("--before") ? "before" : "after"}-${suffix}.png`) });
  };
  await page.goto(`http://127.0.0.1:${server.port}/?shot=task-departed-reviewer&theme=dark`);
  await reviewer.waitFor();
  expect((await reviewer.innerText()).includes("Sage"), "task details preserve the departed reviewer's nickname");
  expect((await reviewer.innerText()).includes("left"), "task details explicitly mark a departed reviewer");
  expect((await reviewer.getByRole("button", { name: "Change", exact: true }).count()) === 1, "an authorized viewer retains Change");
  await screenshot("details");
  await reviewer.getByRole("button", { name: "Change", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Who reviews T14?" });
  await dialog.waitFor();
  expect((await dialog.locator(".modal-head").innerText()).includes("Sage"), "picker context preserves the current departed assignment");
  expect((await dialog.locator(".modal-head").innerText()).includes("left"), "picker context explains the current reviewer left");
  expect((await dialog.locator(".task-pick-name", { hasText: /^Sage$/ }).count()) === 0, "a departed reviewer is absent from current choices");
  expect((await dialog.locator(".task-pick-name", { hasText: /^pixel$/ }).count()) === 0, "the task's implementer stays excluded from reviewer choices");
  await screenshot("picker");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  expect((await reviewer.innerText()).includes("Sage"), "opening and closing the picker does not rewrite the assignment");
  await reviewer.getByRole("button", { name: "Change", exact: true }).click();
  await dialog.getByRole("button", { name: /^win\b/ }).click();
  await dialog.waitFor({ state: "hidden" });
  expect((await reviewer.innerText()).includes("win") && !(await reviewer.innerText()).includes("left"), "an authorized explicit choice changes to a current reviewer");
  await page.goto(`http://127.0.0.1:${server.port}/?shot=task-offline-reviewer`);
  await reviewer.waitFor();
  expect((await reviewer.innerText()).includes("ridge") && !(await reviewer.innerText()).includes("left"), "an offline current reviewer is distinct from a departed one");
  await reviewer.getByRole("button", { name: "Change", exact: true }).click();
  const offline = page.getByRole("dialog", { name: "Who reviews T12?" });
  await offline.waitFor();
  expect(
    (await offline.locator(".task-pick-name", { hasText: /^ridge$/ }).count()) === 1 && !(await offline.locator(".modal-head").innerText()).includes("left"),
    "offline reviewer stays in the picker without departure context",
  );
  await page.goto(`http://127.0.0.1:${server.port}/?shot=task-departed-reviewer-done`);
  await reviewer.waitFor();
  expect((await reviewer.innerText()).includes("Sage"), "a completed task retains its reviewer name");
  expect((await reviewer.getByRole("button", { name: "Change", exact: true }).count()) === 0, "completed tasks do not gain a Change action");
  expect((await panel.locator(".task-history").innerText()).includes("Sage approved"), "completed review history retains the departed judge's attribution");
  await page.goto(`http://127.0.0.1:${server.port}/?shot=task-departed-reviewer-readonly`);
  await reviewer.waitFor();
  expect((await reviewer.innerText()).includes("Sage") && (await reviewer.innerText()).includes("left"), "a read-only viewer sees the same departed reviewer disclosure");
  expect((await reviewer.getByRole("button", { name: "Change", exact: true }).count()) === 0, "read-only viewers do not gain Change");
} finally {
  await browser.close();
  server.stop(true);
}
console.log(`${passes} pass, ${fails.length} fail`);
if (fails.length) {
  console.error(fails.join("\n"));
  process.exit(1);
}
