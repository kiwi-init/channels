import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Locator, type Page } from "playwright-core";

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

const open = async (shot: string, width = 1440, height = 900): Promise<Page> => {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("pageerror", (e) => fails.push(`page threw: ${e.message}`));
  await page.goto(`http://127.0.0.1:${server.port}/?shot=${shot}`);
  await page.locator(".spec-comment").first().waitFor();
  const all = page.getByRole("button", { name: /^All \d+$/ });
  if (await all.count()) await all.first().click();
  return page;
};
async function hoverOrSay(page: Page, target: Locator): Promise<void> {
  await target.hover().catch(async (err: unknown) => {
    const seen = await page
      .evaluate(() => {
        const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").slice(0, 50);
        return {
          url: location.href,
          viewport: [innerWidth, innerHeight],
          comments: [...document.querySelectorAll(".spec-comment")].map(text),
          headings: [...document.querySelectorAll("h1, h2, h3")].map(text).slice(0, 8),
          boxes: document.querySelectorAll(".spec-box-new").length,
          files: document.querySelectorAll(".compose-file").length,
          dialogs: [...document.querySelectorAll("dialog[open]")].map((d) => d.className),
          focus: `${document.activeElement?.tagName}.${document.activeElement?.className}`,
          main: text(document.querySelector("main") ?? document.body),
        };
      })
      .catch((e: unknown) => `no page state: ${String(e)}`);
    const there = await target.count().catch(() => -1);
    const covered =
      there > 0
        ? await target
            .evaluate((el) => {
              const r = el.getBoundingClientRect();
              const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              return {
                rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
                under: at ? `${at.tagName}.${at.className}` : "nothing",
                covered: !!at && !el.contains(at),
              };
            })
            .catch((e: unknown) => `no target state: ${String(e)}`)
        : "the comment is not on the page";
    console.log(`the hover never landed: ${JSON.stringify({ there, covered, seen }, null, 1)}`);
    throw err;
  });
}

const plainBox = (page: Page) => page.getByRole("textbox", { name: "Comment on the spec" });
const anchoredBox = (page: Page) => page.getByRole("textbox", { name: "Comment on the selected words" });
const comments = (page: Page) => page.locator(".spec-comment").count();
const posted = (page: Page, text: string) => page.locator(".spec-comment", { hasText: text }).count();

const select = (page: Page) =>
  page.evaluate(() => {
    const p = document.querySelector(".spec-doc p");
    const sel = window.getSelection();
    if (!p || !sel) return;
    const range = document.createRange();
    range.selectNodeContents(p);
    sel.removeAllRanges();
    sel.addRange(range);
    p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });

const anchor = async (page: Page) => {
  await page.locator(".spec-doc p").first().waitFor();
  const pop = page.locator(".spec-pop");
  for (let tries = 0; tries < 5 && !(await pop.count()); tries++) {
    await select(page);
    await page.waitForTimeout(200);
  }
  await pop.click();
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
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`http://127.0.0.1:${server.port}/?shot=channel`);
    const area = page.getByRole("textbox", { name: "Message" });
    await area.fill("Ask @ma");
    await page.locator('[role="option"]').first().waitFor();
    await area.press("Escape");
    expect((await page.locator('[role="option"]').count()) === 0, "Escape closes the chat composer's suggestions too");
    await area.fill("Ask @wi");
    await page.waitForTimeout(100);
    expect((await page.locator('[role="option"]').count()) > 0, "and a new query at the same caret offset opens them again");
    await page.close();
  }
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
    const page = await open("spec-queued", width);
    const layout = width >= 940 ? "the wide rail" : "the narrow list";
    const sideways = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".spec-rail-scroll, .spec-talk")].some((el) => el.scrollWidth > el.clientWidth + 1));
    expect(!sideways, `a reply quoting a long comment doesn't widen the comments past ${layout}`);
    const replyToReply = page.locator(".spec-comment", { hasText: "Then the checks page is the first link." }).first();
    await replyToReply.locator(".spec-comment-quote.is-link").click();
    const target = page.locator('.spec-comment[data-seq="196"]').first();
    await page.waitForTimeout(150);
    const flashed = await target.evaluate((el) => el.classList.contains("is-flash"));
    expect(flashed && (await target.isVisible()), `a reply to a reply jumps to the reply it quotes, in ${layout}`);
    await page.close();
  }

  for (const shot of ["spec-draft"]) {
    const on = shot === "spec-draft";
    for (const which of ["plain", "anchored"] as const) {
      const page = await open(shot);
      if (which === "anchored") await anchor(page);
      const box = which === "plain" ? plainBox(page) : anchoredBox(page);
      const where = `${which} box, Enter-sends ${on ? "on" : "off"}`;
      const list = page.locator('[role="option"]');
      const before = await comments(page);

      await box.fill("Ask @ma");
      await list.first().waitFor();
      await imeEnter(page, which);
      expect((await box.inputValue()) === "Ask @ma" && (await comments(page)) === before, `${where}: an IME Enter with the list open neither picks nor sends`);
      await box.press("Enter");
      await page.waitForTimeout(100);
      expect((await box.inputValue()).startsWith("Ask @maya") && (await comments(page)) === before, `${where}: Enter picks the suggestion and doesn't send`);
      await box.fill("Ask @wi");
      await list.first().waitFor();
      await box.press("Tab");
      await page.waitForTimeout(100);
      expect((await box.inputValue()).startsWith("Ask @win") && (await comments(page)) === before, `${where}: Tab picks the suggestion and doesn't send`);
      await box.fill("Ask @ma");
      await list.first().waitFor();
      await box.press("Escape");
      const escaped = { options: await list.count(), boxes: await box.count(), value: (await box.count()) ? await box.inputValue() : null };
      expect(escaped.options === 0 && escaped.boxes === 1 && escaped.value === "Ask @ma", `${where}: Escape only closes the list (${JSON.stringify(escaped)})`);
      await box.fill("Ask ");
      await box.fill("Ask @ma");
      await page.waitForTimeout(100);
      expect((await list.count()) > 0, `${where}: deleting the query and typing it again opens the list again`);
      await box.press("Escape");
      await box.fill("Ask @wi");
      await page.waitForTimeout(100);
      expect((await list.count()) > 0, `${where}: a new query at the same caret offset opens the list again`);
      await box.fill("Ask @sc");
      await list.first().waitFor();
      expect((await names(page)).includes("scout"), `${where}: a former member is suggested`);

      if (which === "plain") {
        await box.fill(`Meta ${where} @ma`);
        await list.first().waitFor();
        await box.press("Meta+Enter");
        await page.waitForTimeout(150);
        expect((await posted(page, `Meta ${where}`)) === 1, `${where}: Meta+Enter with the list open sends`);
      }
      await box.fill(`Ctrl ${where} @ma`);
      await list.first().waitFor();
      await box.press("Control+Enter");
      await page.waitForTimeout(150);
      expect((await posted(page, `Ctrl ${where}`)) === 1, `${where}: Ctrl+Enter with the list open sends`);

      if (which === "anchored") await anchor(page);
      await box.fill(`Plain enter ${where}`);
      await box.press("Enter");
      await page.waitForTimeout(150);
      expect((await posted(page, `Plain enter ${where}`)) === (on ? 1 : 0), `${where}: a plain Enter ${on ? "sends" : "doesn't send"}`);
      await page.close();
    }
  }

  {
    const page = await open("spec-draft");
    await plainBox(page).fill("Thanks @sc");
    await page.locator('[role="option"]').first().waitFor();
    await plainBox(page).press("Enter");
    const value = await plainBox(page).inputValue();
    await plainBox(page).press("Control+Enter");
    await page.waitForTimeout(150);
    const said = page.locator(".spec-comment", { hasText: "Thanks" }).last();
    expect(value === "Thanks @scout " && (await said.innerText()).includes("scout"), "a former member completes to their handle, and the sent comment names them");
    await page.close();
  }

  {
    const page = await open("spec-queued");
    const failed = page.locator(".spec-comment.is-failed", { hasText: "A sketch of the first-hour page" });
    expect((await failed.locator(".msg-images").count()) === 1, "a comment that failed to send keeps its image");
    await failed.getByRole("button", { name: "Retry" }).click();
    await page.waitForTimeout(150);
    const sent = page.locator(".spec-comment", { hasText: "A sketch of the first-hour page" });
    expect(
      (await sent.count()) === 1 && (await page.locator(".spec-comment.is-failed").count()) === 0,
      "Retry clears the failed mark in the demo, leaving one comment in its own spec (delivery is unit-tested in unsent.test.ts)",
    );
    expect((await sent.locator(".msg-images").count()) === 1, "the retried comment still shows its image");
    await page.close();
  }

  {
    const page = await open("spec-draft");

    await plainBox(page).fill("draft for the export spec");
    await page.locator(".spec-box-new input[type=file]").last().setInputFiles({ name: "board.png", mimeType: "image/png", buffer: PNG });
    await page.locator(".compose-file").first().waitFor();
    const drafted = page.locator(".spec-comment", { hasText: "Drafted it. Two open questions inside." }).first();
    await hoverOrSay(page, drafted);
    await drafted.getByRole("button", { name: "Reply" }).click();
    await page.locator(".compose-reply").first().waitFor();
    await page.getByRole("button", { name: "All specs" }).click();
    await page.getByText("Drafts survive a restart").first().click();
    const part = page.locator(".spec-parts button").first();
    await part.waitFor();
    await part.click();
    await plainBox(page).waitFor();
    expect((await plainBox(page).inputValue()) === "", "another spec's box doesn't pick up this spec's draft");
    expect((await page.locator(".compose-file").count()) === 0, "nor its image");
    expect((await page.locator(".compose-reply").count()) === 0, "nor the reply it was writing");
    await page.close();
  }

  {
    const page = await open("spec-draft", 900, 1400);
    await plainBox(page).fill("private draft for the export spec");
    await page.locator(".spec-box-new input[type=file]").last().setInputFiles({ name: "board.png", mimeType: "image/png", buffer: PNG });
    await page.locator(".compose-file").first().waitFor();
    const drafted = page.locator(".spec-comment", { hasText: "Drafted it. Two open questions inside." }).first();
    await hoverOrSay(page, drafted);
    await drafted.getByRole("button", { name: "Reply" }).click();
    await page.locator(".spec-box-new .compose-reply").first().waitFor();
    const card = page.locator(".spec-card", { hasText: "A first hour for new agents" }).first();
    await card.scrollIntoViewIfNeeded();
    await card.locator(".spec-card-main").click();
    await page.waitForTimeout(400);
    const box = page.locator(".spec-box-new:not(.is-anchored) textarea").first();
    await box.waitFor();
    const top = await page.locator(".spec-page h1").first().innerText();
    expect(top.includes("A first hour for new agents"), `the card opened the first-hour spec in place (${top})`);
    expect((await box.inputValue()) === "", "in the tall layout, a spec card in the chat switches specs and the box drops the old spec's draft");
    expect((await page.locator(".spec-box-new .compose-file").count()) === 0, "and its image");
    expect((await page.locator(".spec-box-new .compose-reply").count()) === 0, "and the reply it was writing");
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
