import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright-core";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = process.argv.includes("--webkit") ? webkit : chromium;

const ROOT = 112;
const SIDE_REPLY = 113;
const LATER_REPLY = 114;
const NESTED_REPLY = 129;
const AFTER_NESTED = 130;

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});
const browser = await engine.launch();
const fails: string[] = [];
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  page.on("pageerror", (e) => fails.push(`page threw: ${e.message}`));
  await page.goto(`http://127.0.0.1:${server.port}/?shot=channel`);
  const feed = page.locator(".feed").first();
  await feed.locator(`[data-seq="${ROOT}"]`).waitFor();
  await page.waitForTimeout(500);

  const root = feed.locator(`[data-seq="${ROOT}"]`);
  const panel = page.locator(".panel");
  const inPanel = async (): Promise<number[]> => panel.locator("[data-seq]").evaluateAll((els) => els.map((el) => Number(el.getAttribute("data-seq"))));
  expect(/^\d+ repl/.test((await root.locator(".msg-thread-n").textContent()) ?? ""), 'a message with replies shows an "N replies" line');
  await root.locator(".msg-thread").click();
  await panel.locator(`[data-seq="${SIDE_REPLY}"]`).waitFor();
  const shown = await inPanel();
  expect(shown[0] === ROOT && shown.includes(SIDE_REPLY) && shown.includes(LATER_REPLY), `"N replies" opens the thread: the message, then its replies (${shown.join(", ")})`);
  await panel.getByRole("button", { name: "Close" }).click();
  await panel.waitFor({ state: "detached" });
  await root.locator(".msg-body").hover();
  expect((await root.getByRole("button", { name: "Reply in thread" }).count()) === 1, 'a hovered message has a "Reply in thread" button');
  await feed.locator(`[data-seq="${LATER_REPLY}"] .msg-body`).hover();
  await feed.locator(`[data-seq="${LATER_REPLY}"]`).getByRole("button", { name: "Reply in thread" }).click();
  await panel.locator(`[data-seq="${ROOT}"]`).waitFor();
  expect((await inPanel())[0] === ROOT, "on a reply, Reply in thread opens the thread of the message it answers");
  expect((await panel.getByRole("button", { name: "Reply in thread" }).count()) === 0 && (await panel.locator(".msg-thread").count()) === 0, "inside the thread, no row offers a thread of its own");
  await panel.getByRole("button", { name: "Close" }).click();
  await panel.waitFor({ state: "detached" });
  await root.locator(".msg-body").hover();
  expect((await root.getByRole("button", { name: "Reply", exact: true }).count()) === 1, "a hovered message has a Reply button that quotes it");

  const reply = feed.locator(`[data-seq="${SIDE_REPLY}"]`);
  expect((await reply.count()) === 1, "a reply the CLI marks thread-only still shows in #general");
  expect((await reply.locator(".msg-quote").count()) === 0, "right under the message it answers, a reply needs no quote");
  const quoted = async (seq: number): Promise<string> => (await feed.locator(`[data-seq="${seq}"] .msg-quote-text`).allTextContents()).join(" ");
  const rootText = (await feed.locator(`[data-seq="${ROOT}"] .msg-text`).first().textContent()) ?? "";
  expect(
    rootText.length > 0 && (await quoted(LATER_REPLY)).length > 0 && rootText.includes((await quoted(LATER_REPLY)).replace(/…$/, "").slice(0, 20)),
    "a reply further down quotes the message it answers",
  );
  expect((await feed.locator(`[data-seq="${NESTED_REPLY}"]`).count()) === 1, "a reply to a reply shows inline too");
  expect((await quoted(AFTER_NESTED)).length > 0, "a reply after a reply to a reply quotes its own message");

  await root.click({ button: "right", position: { x: 200, y: 12 } });
  const menu = page.getByRole("menu");
  await menu.waitFor();
  expect((await menu.getByRole("menuitem", { name: "Reply in thread" }).count()) === 1, 'the message menu has "Reply in thread"');
  expect((await menu.getByRole("menuitem", { name: "Reply", exact: true }).count()) === 1, "the message menu has Reply");
  await page.keyboard.press("Escape");

  expect((await page.locator('.side section[aria-label="Threads"]').count()) === 0, "the sidebar has no Threads list");
  await page.close();
} finally {
  await browser.close();
  server.stop(true);
}
if (fails.length) {
  console.error(`\n${fails.length} failed`);
  process.exit(1);
}
