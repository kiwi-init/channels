#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright-core";

const at = process.argv.indexOf("--dist");
const dist = at > 0 ? (process.argv[at + 1] ?? "ui/dist") : "ui/dist";
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = process.argv.includes("--chromium") ? "chromium" : "webkit";
const shots = process.argv.indexOf("--shots");
const shotDir = shots > 0 ? process.argv[shots + 1] : undefined;

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});

const PANEL = ".panel";
const DETAIL = `${PANEL} .task-detail`;
const TALK = `${PANEL} .task-talk`;
const BOX = `${PANEL} .composer textarea`;
const BAR = `${PANEL} .compose-reply`;
const PICK = ".quote-pick";

type Span = { sel: string; from: string; to: string; endSel?: string; endAt?: "after" | "start" | "next" };

const select = (page: Page, span: Span) =>
  page.evaluate((s: Span) => {
    const textNodes = (root: Element): Text[] => {
      const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const out: Text[] = [];
      for (let n = walk.nextNode(); n; n = walk.nextNode()) out.push(n as Text);
      return out;
    };
    const find = (sel: string, needle: string, end: boolean): { node: Text; offset: number } | null => {
      const roots = [...document.querySelectorAll(sel)];
      for (const root of roots)
        for (const node of textNodes(root)) {
          const i = node.data.indexOf(needle);
          if (i >= 0) return { node, offset: end ? i + needle.length : i };
        }
      return null;
    };
    const nextText = (el: Element): { node: Text; offset: number } | null => {
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode())
        if (!el.contains(n) && el.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING && (n as Text).data.trim()) return { node: n as Text, offset: 0 };
      return null;
    };
    const a = find(s.sel, s.from, false);
    const after = s.endAt === "next" ? document.querySelector(s.endSel ?? s.sel) : null;
    const b = after ? nextText(after) : find(s.endSel ?? s.sel, s.to, s.endAt !== "start");
    if (!a || !b) return false;
    a.node.parentElement?.scrollIntoView({ block: "center" });
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.dispatchEvent(new PointerEvent("pointerup", { button: 0, bubbles: true }));
    return true;
  }, span);

const openChannel = (page: Page, name: string) =>
  page.evaluate((want: string) => {
    const hit = [...document.querySelectorAll<HTMLElement>("button, a, [role=tab]")].find(
      (el) => !el.closest(".panel") && !el.closest(".msg-body") && ((el.getAttribute("aria-label") ?? "").trim() === want || [...el.childNodes].some((n) => (n.textContent ?? "").trim() === want)),
    );
    hit?.click();
    return !!hit;
  }, name);

const shown = (page: Page, sel: string) => page.evaluate((s: string) => !!document.querySelector(s), sel);

async function pickAppears(page: Page): Promise<boolean> {
  try {
    await page.waitForSelector(PICK, { timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}

async function pickStaysAway(page: Page): Promise<boolean> {
  await page.waitForTimeout(400);
  return !(await shown(page, PICK));
}

const barText = (page: Page) => page.evaluate((s: string) => document.querySelector(s)?.textContent ?? null, BAR);

const lastMessage = (page: Page) =>
  page.evaluate((talk: string) => {
    const rows = [...document.querySelectorAll<HTMLElement>(`${talk} [data-seq]`)];
    const row = rows.at(-1);
    if (!row) return null;
    return {
      seq: Number(row.dataset.seq),
      quote: row.querySelector("blockquote")?.textContent ?? null,
      cited: row.querySelector(".msg-quote")?.textContent ?? null,
      text: row.querySelector(".msg-body")?.textContent ?? "",
    };
  }, TALK);

async function open(page: Page, shot: string): Promise<void> {
  await page.goto(`http://127.0.0.1:${server.port}/?shot=${shot}`);
  await page.waitForSelector(`${DETAIL} .md, ${DETAIL} .md-plain`, { timeout: 60_000 });
  await page.waitForTimeout(400);
}

const settle = (page: Page) =>
  page.evaluate(() => {
    for (const a of document.getAnimations()) if (a.effect?.getComputedTiming().iterations !== Infinity) a.finish();
  });

async function shoot(page: Page, name: string): Promise<void> {
  if (!shotDir) return;
  await settle(page);
  await page.screenshot({ path: join(shotDir, `${name}-${engine}.png`) });
}

async function run(browser: Browser): Promise<string | null> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await open(page, "task-quote");
    await page.fill(BOX, "draft kept");
    await shoot(page, "task-quote-open");

    if (!(await select(page, { sel: DETAIL, from: "One save pattern", to: "one place per setting" }))) return "couldn't select description text";
    if (!(await pickAppears(page))) {
      await shoot(page, "task-quote-pick");
      return "selecting the task description offers no Quote";
    }
    const copied = await page.evaluate(() => document.getSelection()?.toString() ?? "");
    if (copied !== "One save pattern, one place per setting") return `the selection changed while Quote showed (copy would get "${copied}")`;
    await page.waitForTimeout(300);
    await settle(page);
    const onTop = await page.evaluate((pick: string) => {
      const b = document.querySelector<HTMLElement>(pick);
      if (!b) return "gone";
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit && b.contains(hit) ? (getComputedStyle(b).opacity === "1" ? "ok" : `opacity ${getComputedStyle(b).opacity}`) : `covered by ${hit?.className}`;
    }, PICK);
    if (onTop !== "ok") return `the Quote button isn't visible on top (${onTop})`;
    await shoot(page, "task-quote-pick");
    await page.click(PICK);
    const bar = await barText(page);
    if (!bar?.includes("Quoting T12's description")) return `the composer doesn't say it quotes T12's description (got "${bar}")`;
    if (!bar.includes("One save pattern, one place per setting")) return `the composer doesn't show the excerpt (got "${bar}")`;
    if ((await page.inputValue(BOX)) !== "draft kept") return "quoting replaced the existing draft";
    if (!(await page.evaluate((s: string) => document.activeElement === document.querySelector(s), BOX))) return "quoting doesn't focus the composer";
    if (await shown(page, PICK)) return "the Quote button stays after quoting";
    await shoot(page, "task-quote-composer");
    const before = await lastMessage(page);
    await page.press(BOX, "Enter");
    await page.waitForFunction((s: string) => !document.querySelector(s), BAR, { timeout: 5_000 });
    const posted = await lastMessage(page);
    if (!posted || posted.seq === before?.seq) return "sending the quote posted nothing in the task's conversation";
    if (posted.quote?.trim() !== "One save pattern, one place per setting") return `the posted reply doesn't carry the excerpt (blockquote "${posted.quote}")`;
    if (!posted.text.includes("draft kept")) return "the posted reply lost the draft";
    if (posted.cited !== null) return "a description quote was attributed to a message";

    await select(page, { sel: DETAIL, from: "Icon twice", to: "give no reason." });
    if (!(await pickAppears(page))) return "a multiline description selection offers no Quote";
    await page.click(PICK);
    const multi = await barText(page);
    if (!multi?.includes("Icon twice") || !multi.includes("give no reason.")) return `a multiline excerpt is cut (got "${multi}")`;
    await page.click(`${BAR} .compose-reply-x`);
    if (await shown(page, BAR)) return "cancelling the quote leaves it in the composer";

    await select(page, { sel: DETAIL, from: "Where.", to: "From the desktop audit." });
    if (!(await pickAppears(page))) return "selecting the whole description offers no Quote";
    await page.click(PICK);
    await page.fill(BOX, "all of it");
    await page.press(BOX, "Enter");
    await page.waitForFunction((s: string) => !document.querySelector(s), BAR, { timeout: 5_000 });
    const whole = await lastMessage(page);
    const cut = whole?.quote?.trim() ?? "";
    if (!cut.endsWith("…")) return `a description excerpt over 600 characters isn't truncated (ends "${cut.slice(-20)}")`;
    if (/\n{3,}/.test(cut) || cut.length > 640) return `a long excerpt isn't normalized like other quotes (${cut.length} characters)`;

    await select(page, { sel: TALK, from: "Agreed on the Icon row", to: "same PR." });
    if (!(await pickAppears(page))) return "selecting a task message offers no Quote";
    await page.click(PICK);
    const msgBar = await barText(page);
    if (!msgBar?.includes("Quoting") || msgBar.includes("description")) return `a message quote isn't attributed to its author (got "${msgBar}")`;
    await page.fill(BOX, "on it");
    await page.press(BOX, "Enter");
    await page.waitForFunction((s: string) => !document.querySelector(s), BAR, { timeout: 5_000 });
    const reply = await lastMessage(page);
    if (!reply?.cited?.includes("Agreed on the Icon row") || !reply.cited.includes("same PR."))
      return `a multiline message quote doesn't keep its message reference and both paragraphs (cited "${reply?.cited}")`;

    await select(page, { sel: DETAIL, from: "plain words", to: "Keep Rename", endSel: TALK });
    if (!(await pickStaysAway(page))) return "a selection from the description into a message offers Quote";
    await select(page, { sel: TALK, from: "Keep Rename", to: "Agreed on the Icon" });
    if (!(await pickStaysAway(page))) return "a selection over two messages offers Quote";
    if (!(await select(page, { sel: DETAIL, from: "One save pattern", to: "Agreed on the Icon row", endSel: TALK, endAt: "start" })))
      return "couldn't select from the description to the start of a message";
    if (!(await pickStaysAway(page))) return "a selection from the description ending at the very start of a message offers Quote";
    if (!(await select(page, { sel: TALK, from: "Keep Rename", to: "Agreed on the Icon row", endAt: "start" }))) return "couldn't select from one message to the start of the next";
    if (!(await pickStaysAway(page))) return "a selection from one message ending at the very start of the next offers Quote";
    if (!(await select(page, { sel: DETAIL, from: "From the desktop audit.", to: "", endAt: "next" }))) return "couldn't select the description's last paragraph to the next line";
    if (!(await pickAppears(page))) return "a selection of the description's last paragraph ending at the start of the next line (a triple click) offers no Quote";
    await page.keyboard.press("Escape");
    await page.evaluate(() => document.getSelection()?.removeAllRanges());

    await select(page, { sel: DETAIL, from: "Toggles disabled", to: "give no reason." });
    if (!(await pickAppears(page))) return "selecting description text again offers no Quote";
    await page.keyboard.press("Escape");
    if (!(await pickStaysAway(page))) return "Escape doesn't dismiss the Quote button";
    if (!(await shown(page, DETAIL))) return "Escape on a selection closes the task panel";
    await page.evaluate(() => document.getSelection()?.removeAllRanges());

    await select(page, { sel: DETAIL, from: "Toggles disabled", to: "give no reason." });
    if (!(await pickAppears(page))) return "selecting description text a third time offers no Quote";
    await page.click(PICK);
    await page.locator(TALK).getByText("T10", { exact: true }).first().click();
    await page.waitForFunction(() => !document.querySelector(".panel .task-detail[data-quote-task='12']"), undefined, { timeout: 5_000 });
    if (await shown(page, BAR)) return "switching to another task keeps the pending quote";
    const reopened = await page.evaluate(() => {
      const hit = [...document.querySelectorAll<HTMLElement>("button, a, [role=button]")].find(
        (el) => !el.closest(".panel") && (el.textContent ?? "").includes("Channel settings: four save patterns"),
      );
      hit?.click();
      return !!hit;
    });
    if (!reopened) return "couldn't find T12 in the specs list to go back to it";
    await page.waitForSelector(".panel .task-detail[data-quote-task='12']", { timeout: 5_000 });
    if (await shown(page, BAR)) return "coming back to the task brings the old quote back";

    await select(page, { sel: DETAIL, from: "Toggles disabled", to: "give no reason." });
    if (!(await pickAppears(page))) return "selecting description text before a channel switch offers no Quote";
    await page.click(PICK);
    if (!(await shown(page, BAR))) return "the quote before a channel switch didn't reach the composer";
    if (!(await openChannel(page, "landing"))) return "couldn't find the landing channel to switch to";
    await page.waitForFunction(() => !document.querySelector(".panel .task-detail[data-quote-task='12']"), undefined, { timeout: 5_000 });
    if (!(await openChannel(page, "kiwi"))) return "couldn't find the kiwi channel to switch back to";
    if (!(await page.locator(".panel .task-detail[data-quote-task='12']").count())) {
      const back = await page.evaluate(() => {
        const hit = [...document.querySelectorAll<HTMLElement>("button, a, [role=button]")].find(
          (el) => !el.closest(".panel") && (el.textContent ?? "").includes("Channel settings: four save patterns"),
        );
        hit?.click();
        return !!hit;
      });
      if (!back) return "couldn't find T12 again after switching channels";
    }
    await page.waitForSelector(".panel .task-detail[data-quote-task='12']", { timeout: 5_000 });
    if (await shown(page, BAR)) return "switching to another channel and back keeps the pending quote";

    await open(page, "task-quote-read-only");
    await select(page, { sel: DETAIL, from: "One save pattern", to: "one place per setting" });
    if (!(await pickStaysAway(page))) return "a read-only member is offered Quote";
    const readOnly = await page.evaluate(() => document.getSelection()?.toString() ?? "");
    if (readOnly !== "One save pattern, one place per setting") return "read-only selection doesn't work for copying";
    return null;
  } finally {
    await page.close();
  }
}

const problems: string[] = [];
const browser = await (engine === "chromium" ? chromium : webkit).launch();
try {
  const why = await run(browser);
  if (why) problems.push(`${engine}: ${why}`);
} finally {
  await browser.close();
  server.stop(true);
}
if (problems.length) {
  for (const p of problems) console.error(`ui-task-quote: ${p}`);
  process.exit(1);
}
console.log(`ui-task-quote: ${engine} ok`);
