import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = flag("--browser") ?? "webkit";
if (engine !== "webkit" && engine !== "chromium") throw new Error(`--browser is webkit or chromium, not ${engine}`);
const ONE_LINE = 40;
const DRAG = 120;

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

async function open(shot: string, width: number, height: number): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("pageerror", (e) => fails.push(`page threw: ${e.message}`));
  await page.goto(`http://127.0.0.1:${server.port}/?shot=${shot}`);
  await page.locator(".compose").first().waitFor();
  await page.waitForTimeout(400);
  return page;
}

const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox()) ?? null;

try {
  const chat = await open("channel", 1080, 1620);
  expect(await chat.locator(".tall").isVisible(), "a portrait window shows the channel as one tall page");
  expect((await chat.locator(".crew .crew-agent").count()) > 0, "the agents strip shows each agent across the top");
  expect(await chat.locator(".tall-work .board").isVisible(), "the board is on the page");
  expect(await chat.locator(".tall-chat .compose").isVisible(), "the conversation and its composer are on the same page");
  expect(!(await chat.locator(".side").isVisible()), "the sidebar folds away");
  expect((await chat.locator(".tabs button", { hasText: "Tasks" }).count()) === 0, "no Tasks tab to switch to");
  expect((await chat.locator(".tall-work .now-line").count()) === 0, "the board leaves out the Now card the strip already says");
  const rows = await chat.locator(".tall-work .board-row").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  expect(rows.length > 0 && rows.every((h) => h <= ONE_LINE), `every task is one line (${rows.map((h) => Math.round(h)).join(", ")}px)`);
  const work = await box(chat, ".tall-work");
  const grip = await box(chat, ".tall-grip");
  if (!work || !grip) throw new Error("the tall page has no board or grip");
  await chat.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await chat.mouse.down();
  await chat.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + DRAG, { steps: 6 });
  await chat.mouse.up();
  const dragged = await box(chat, ".tall-work");
  expect(
    !!dragged && Math.abs(dragged.height - work.height - DRAG) <= 4,
    `dragging the grip ${DRAG}px down grows the board by as much (${Math.round(work.height)} → ${Math.round(dragged?.height ?? 0)})`,
  );
  await chat.close();

  const task = await open("task", 1080, 1620);
  expect((await task.locator("aside.panel").count()) === 0, "an open task floats over nothing");
  expect(await task.locator(".tall-work .panel .panel-head").isVisible(), "the task opens where the board was");
  expect(await task.locator(".tall-chat .compose").isVisible(), "the conversation stays in view while the task is open");
  const panel = await box(task, ".tall-work");
  const talk = await box(task, ".tall-chat");
  expect(!!panel && !!talk && panel.y + panel.height <= talk.y + 1, "the task sits above the conversation, not over it");
  await task.close();

  const wide = await open("task", 1440, 900);
  expect((await wide.locator(".tall").count()) === 0, "a landscape window keeps today's layout");
  expect(await wide.locator("aside.panel").isVisible(), "there the task opens in the right panel as before");
  expect(await wide.locator(".side").isVisible(), "and the sidebar stays");
  await wide.close();
} finally {
  await browser.close();
  await server.stop(true);
}
if (fails.length) {
  console.error(fails.join("\n"));
  process.exit(1);
}
