import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, webkit } from "playwright-core";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const engine = flag("--browser") ?? "webkit";
if (engine !== "webkit" && engine !== "chromium") throw new Error(`--browser is webkit or chromium, not ${engine}`);

const out = mkdtempSync(join(tmpdir(), "kiwi-archive-"));
const built = await Bun.build({ entrypoints: [join(import.meta.dir, "ui-history-archive-page.ts")], outdir: out, target: "browser", minify: false });
if (!built.success) throw new Error(built.logs.map(String).join("\n"));
const bundle = await Bun.file(join(out, "ui-history-archive-page.js")).text();
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: (req) =>
    new URL(req.url).pathname === "/page.js"
      ? new Response(bundle, { headers: { "content-type": "text/javascript" } })
      : new Response('<!doctype html><meta charset="utf-8"><script type="module" src="/page.js"></script>', { headers: { "content-type": "text/html" } }),
});
const browser = await (engine === "webkit" ? webkit : chromium).launch();
const fails: string[] = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => fails.push(`page threw: ${e.message}`));
  await page.goto(`http://127.0.0.1:${server.port}/`);
  await page.waitForFunction(() => "archiveCheck" in window);
  const results = await page.evaluate(() => (window as unknown as { archiveCheck: () => Promise<Record<string, boolean>> }).archiveCheck());
  for (const [what, ok] of Object.entries(results)) {
    console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
    if (!ok) fails.push(what);
  }
} finally {
  await browser.close();
  server.stop(true);
  rmSync(out, { recursive: true, force: true });
}
if (fails.length) {
  console.error(`\n${fails.length} failed:\n${fails.join("\n")}`);
  process.exit(1);
}
