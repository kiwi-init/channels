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

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

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

const open = async (shot: string, width = 1440): Promise<Page> => {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on("pageerror", (e) => fails.push(`page threw: ${e.message}`));
  await page.goto(`http://127.0.0.1:${server.port}/?shot=${shot}`);
  await page.locator(".spec-comment").first().waitFor();
  const all = page.getByRole("button", { name: /^All \d+$/ });
  if (await all.count()) await all.first().click();
  return page;
};
const plainBox = (page: Page) => page.getByRole("textbox", { name: "Comment on the spec" });
const anchoredBox = (page: Page) => page.getByRole("textbox", { name: "Comment on the selected words" });
const comments = (page: Page) => page.locator(".spec-comment").count();
const posted = (page: Page, text: string) => page.locator(".spec-comment", { hasText: text }).count();

const anchor = async (page: Page) => {
  await page.evaluate(() => {
    const p = document.querySelector(".spec-doc p");
    const sel = window.getSelection();
    if (!p || !sel) return;
    const range = document.createRange();
    range.selectNodeContents(p);
    sel.removeAllRanges();
    sel.addRange(range);
    p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.locator(".spec-pop").click();
  await anchoredBox(page).waitFor();
};

const names = (page: Page) => page.locator('[role="listbox"][aria-label="People"] .mention-name').allInnerTexts();

const imeEnter = (page: Page, box: "plain" | "anchored") =>
  page.evaluate(
    (label) => {
      const area = document.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`);
      area?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 229, isComposing: true, bubbles: true, cancelable: true }));
    },
    box === "plain" ? "Comment on the spec" : "Comment on the selected words",
  );

try {
  const composerNames = await (async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`http://127.0.0.1:${server.port}/?shot=channel`);
    const area = page.getByRole("textbox", { name: "Message" });
    await area.fill("Ask @");
    await page.locator('[role="option"]').first().waitFor();
    const all = await names(page);
    await area.press("Escape");
    expect((await page.locator('[role="option"]').count()) === 0, "Escape closes the chat composer's suggestions too");
    await page.close();
    return all;
  })();
  {
    const page = await open("spec-draft");
    const plain = page.locator(".spec-comment", { hasText: "Drafted it. Two open questions inside." }).first();
    const reply = plain.getByRole("button", { name: "Reply" });
    await reply.focus();
    const focused = await reply.evaluate((el) => document.activeElement === el);
    const shown = await plain.locator(".msg-tools").evaluate((el) => getComputedStyle(el).opacity);
    expect(focused && shown === "1", "a plain comment's actions take keyboard focus without a hover, and show while focused");
    await page.keyboard.press("Tab");
    const next = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    expect(next === "Copy text", "Tab moves on through the comment's actions");
    await page.close();
  }

  for (const width of [1440, 900]) {
    const page = await open("spec-draft", width);
    const layout = width >= 940 ? "the wide rail" : "the narrow list";
    const sideways = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".spec-rail-scroll, .spec-talk")].some((el) => el.scrollWidth > el.clientWidth + 1));
    expect(!sideways, `a reply quoting a long comment doesn't widen the comments past ${layout}`);
    const replyToReply = page.locator(".spec-comment", { hasText: "Then the writer is yours." }).first();
    await replyToReply.locator(".spec-comment-quote.is-link").click();
    const target = page.locator('.spec-comment[data-seq="154"]').first();
    await page.waitForTimeout(150);
    const flashed = await target.evaluate((el) => el.classList.contains("is-flash"));
    expect(flashed && (await target.isVisible()), `a reply to a reply jumps to the reply it quotes, in ${layout}`);
    await page.close();
  }

  {
    const page = await open("spec-draft");
    const before = await comments(page);
    await plainBox(page).fill("Ask @");
    await page.locator('[role="option"]').first().waitFor();
    const inSpec = await names(page);
    expect(inSpec.join() === composerNames.join(), `@ in a spec comment box lists the people the chat composer lists (${inSpec.join(", ")})`);
    await plainBox(page).fill("Ask @ma");
    await page.locator('[role="option"]').first().waitFor();
    await plainBox(page).press("Enter");
    const value = await plainBox(page).inputValue();
    expect(value.includes("@maya") && (await comments(page)) === before, "with Enter-sends on, Enter accepts a suggestion and doesn't send");
    await plainBox(page).fill("Ask @ma");
    await page.locator('[role="option"]').first().waitFor();
    await plainBox(page).press("Escape");
    expect((await page.locator('[role="option"]').count()) === 0 && (await plainBox(page).inputValue()) === "Ask @ma", "Escape only closes the list");
    await imeEnter(page, "plain");
    expect((await comments(page)) === before, "an Enter confirming an IME composition doesn't send from the plain box");

    await anchor(page);
    await anchoredBox(page).fill("Needs @ma");
    await page.locator('[role="option"]').first().waitFor();
    await anchoredBox(page).press("Escape");
    expect((await anchoredBox(page).count()) === 1 && (await page.locator('[role="option"]').count()) === 0, "in the anchored box, Escape closes the list first and keeps the box");
    await anchoredBox(page).press("Tab");
    await imeEnter(page, "anchored");
    expect((await comments(page)) === before, "an Enter confirming an IME composition doesn't send from the anchored box");
    await anchoredBox(page).fill("Needs a date");
    await anchoredBox(page).press("Enter");
    await page.waitForTimeout(150);
    expect((await posted(page, "Needs a date")) === 1, "Enter sends the anchored box with Enter-sends on");
    await page.close();
  }

  {
    const page = await open("spec-ctrl-enter");
    const before = await comments(page);
    await plainBox(page).fill("Ask @ma");
    await page.locator('[role="option"]').first().waitFor();
    await plainBox(page).press("Enter");
    expect((await plainBox(page).inputValue()).includes("@maya") && (await comments(page)) === before, "with Enter-sends off, Enter accepts a suggestion and doesn't send");
    await plainBox(page).press("Enter");
    expect((await comments(page)) === before, "with Enter-sends off, a plain Enter doesn't send");
    await plainBox(page).press("Control+Enter");
    await page.waitForTimeout(150);
    expect((await comments(page)) === before + 1, "with Enter-sends off, Ctrl+Enter sends");
    await anchor(page);
    await anchoredBox(page).fill("Settle the date first");
    await anchoredBox(page).press("Enter");
    expect((await posted(page, "Settle the date first")) === 0, "with Enter-sends off, a plain Enter doesn't send the anchored box");
    await anchoredBox(page).press("Control+Enter");
    await page.waitForTimeout(150);
    expect((await posted(page, "Settle the date first")) === 1, "with Enter-sends off, Ctrl+Enter sends the anchored box");
    await page.close();
  }

  {
    const page = await open("spec-draft");
    const failed = page.locator(".spec-comment.is-failed", { hasText: "The dialog I have in mind" });
    expect((await failed.locator(".msg-images").count()) === 1, "a comment that failed to send keeps its image");
    await failed.getByRole("button", { name: "Retry" }).click();
    await page.waitForTimeout(150);
    const sent = page.locator(".spec-comment", { hasText: "The dialog I have in mind" });
    expect((await sent.count()) === 1 && (await page.locator(".spec-comment.is-failed").count()) === 0, "Retry sends it once, in its own spec");
    expect((await sent.locator(".msg-images").count()) === 1, "the retried comment still carries its image");

    await plainBox(page).fill("draft for the export spec");
    await page.locator(".spec-box-new input[type=file]").last().setInputFiles({ name: "board.png", mimeType: "image/png", buffer: PNG });
    await page.locator(".compose-file").first().waitFor();
    const drafted = page.locator(".spec-comment", { hasText: "Drafted it. Two open questions inside." }).first();
    await drafted.hover();
    await drafted.getByRole("button", { name: "Reply" }).click();
    await page.locator(".compose-reply").first().waitFor();
    await page.getByRole("button", { name: "All specs" }).click();
    await page.getByText("Drafts survive a restart").first().click();
    const part = page.locator(".spec-parts button").first();
    await part.waitFor();
    await part.click();
    await plainBox(page).waitFor();
    expect((await page.getByText("The dialog I have in mind").count()) === 0, "the retried comment doesn't show on another spec");
    expect((await plainBox(page).inputValue()) === "", "another spec's box doesn't pick up this spec's draft");
    expect((await page.locator(".compose-file").count()) === 0, "nor its image");
    expect((await page.locator(".compose-reply").count()) === 0, "nor the reply it was writing");
    await page.close();
  }
} finally {
  await browser.close();
  await server.stop(true);
}
if (fails.length) {
  console.error(fails.join("\n"));
  process.exit(1);
}
