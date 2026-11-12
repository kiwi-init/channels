import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";
import { pageErrors } from "./page-errors.ts";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = flag("--browser") ?? "chromium";
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

const QUIET = "Quiet time, in minutes";
const LANDING = "Tasks land on";

const tab = (page: Page, name: string) => page.getByRole("dialog", { name: "Channel settings" }).getByRole("button", { name, exact: true }).click();

async function readBack(page: Page): Promise<{ quiet: string; landing: string }> {
  await tab(page, "General");
  await tab(page, "Tasks");
  const quiet = (await page.locator(".set-inline-value").first().textContent())?.trim() ?? "";
  const landing = await page.getByRole("combobox", { name: LANDING }).inputValue();
  return { quiet, landing };
}

async function change(page: Page, minutes: string, landing: string, where: string): Promise<void> {
  await tab(page, "Tasks");
  await page.getByRole("button", { name: "Change", exact: true }).click();
  await page.getByRole("textbox", { name: QUIET }).fill(minutes);
  await page.getByRole("textbox", { name: QUIET }).press("Enter");
  await page.getByRole("combobox", { name: LANDING }).selectOption(landing);
  const back = await readBack(page);
  expect(back.quiet === minutes, `${where}: quiet time saved as ${minutes} reads back as ${back.quiet}`);
  expect(back.landing === landing, `${where}: tasks land on "${landing || "Approval"}" reads back as "${back.landing || "Approval"}"`);
}

async function channel(shot: string, connected: boolean): Promise<void> {
  const where = connected ? "with a repo" : "without a repo";
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await pageErrors(page, (e) => fails.push(`page threw: ${e}`));
  await page.goto(`http://127.0.0.1:${server.port}/?shot=${shot}`);
  await page.getByRole("dialog", { name: "Channel settings" }).waitFor();
  await tab(page, "GitHub");
  const repos = await page.locator(".cset-repo-name").allTextContents();
  expect(repos.length > 0 === connected, `${where}: the channel has ${repos.length} connected repos`);
  expect((await page.getByText(QUIET, { exact: true }).count()) === 0, `${where}: the GitHub tab no longer shows quiet time`);
  expect((await page.getByRole("combobox", { name: LANDING }).count()) === 0, `${where}: the GitHub tab no longer shows tasks land on`);
  await change(page, "45", "merge", where);
  await change(page, "60", "release:tag", where);
  await change(page, "20", "", where);
  await page.close();
}

try {
  await channel("channel-settings", true);
  await channel("channel-settings-no-repo", false);
} finally {
  await browser.close();
  await server.stop(true);
}
if (fails.length) {
  console.error(fails.join("\n"));
  process.exit(1);
}
