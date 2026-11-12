import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright-core";
import { pageErrors } from "./page-errors.ts";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = flag("--browser") ?? "webkit";
if (engine !== "webkit" && engine !== "chromium") throw new Error(`--browser is webkit or chromium, not ${engine}`);
const shot = flag("--shot");

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
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await pageErrors(page, (e) => fails.push(`page threw: ${e}`));
  await page.goto(`http://127.0.0.1:${server.port}/?shot=channel`);
  const people = page.getByRole("region", { name: "People" });
  const rows = people.locator(".side-member");
  await rows.first().waitFor();
  const names = await rows.locator(".side-name").allInnerTexts();
  const first = rows.first();
  const mark = await first.locator(".side-state").allInnerTexts();
  expect(mark[0] === "you", `your row comes first in People, marked "you" (${names.join(", ")})`);
  expect(names.length > 1, "the other people are still listed after you");
  if (shot) await page.locator(".side").screenshot({ path: shot });
  await first.click();
  const profile = page.getByRole("dialog");
  await profile.waitFor({ timeout: 3000 }).catch(() => {});
  expect(await profile.isVisible(), "clicking your row opens your profile");
  expect(
    await profile
      .getByText(names[0] ?? "", { exact: false })
      .first()
      .isVisible(),
    `the profile is yours (${names[0]})`,
  );
} finally {
  await browser.close();
  await server.stop(true);
}
if (fails.length) {
  console.error(fails.join("\n"));
  process.exit(1);
}
