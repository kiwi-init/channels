#!/usr/bin/env bun
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";
import { composer, firstRun, letIn, newChannel } from "./perf-ui.ts";
import { harnessDist } from "./ui-harness.ts";
import { pageErrors } from "./page-errors.ts";

if (process.argv.includes("--help")) {
  console.log(`Editing a message from past the app's 400-message window: two people on a local relay, ana sends a long line,
bo sends 520 short ones, then ana presses ↑. Past the window the app holds a 600-character copy of the old line, and
saving that copy cut the message for everyone (#5717). It checks that ↑ opens the whole line, that saving it unchanged
leaves it whole, and that an edit reaches bo whole. Needs the harness build (bun scripts/ui-harness.ts).

  bun scripts/ui-edit-old.ts [--dist=ui/dist-harness]`);
  process.exit(0);
}

const FILLERS = 520;
const LONG = `START ${"lorem ipsum dolor sit amet ".repeat(40)} END-OF-LONG-MESSAGE`;
const data = mkdtempSync(join(tmpdir(), "kiwi-edit-old-"));
mkdirSync(join(data, "relay"));
const { relay, port } = await startLocalRelay(join(data, "relay"), harnessDist(process.argv.find((a) => a.startsWith("--dist="))?.slice(7)), { rateLimits: false });
const BASE = `http://127.0.0.1:${port}/`;
const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
const failures: string[] = [];
const errors: string[] = [];
const check = (said: string, why: string | null): void => {
  console.log(`${why ? "✗" : "✓"} ${said}${why ? `: ${why}` : ""}`);
  if (why) failures.push(said);
};

const open = async (name: string): Promise<Page> => {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  await pageErrors(page, (e) => errors.push(`${name}: ${e}`));
  await page.goto(BASE);
  await firstRun(page, name);
  return page;
};
const send = async (p: Page, text: string): Promise<void> => {
  const a = composer(p);
  await a.fill(text);
  await a.press("Enter");
};
const awake = async (p: Page): Promise<void> => {
  if (!(await p.locator(".rest").count())) return;
  await p.keyboard.press("Shift");
  await p.locator(".rest").waitFor({ state: "detached", timeout: 5000 });
};
const rowEditor = (p: Page) => p.locator(".main").getByRole("textbox", { name: "Edit message" });
const editOpens = async (p: Page): Promise<string> => {
  await awake(p);
  const a = composer(p);
  await a.click();
  await a.press("ArrowUp");
  await p.waitForFunction((want) => (document.querySelector<HTMLTextAreaElement>(".main .msg-edit-text")?.value ?? "").length >= want, LONG.length, { timeout: 20000 }).catch(() => {});
  return (await rowEditor(p).count()) === 1 ? rowEditor(p).inputValue() : "";
};

try {
  const ana = await open("ana");
  const code = await newChannel(ana, "edit-old");
  const bo = await open("bo");
  await bo.goto(`${BASE}#${code}`);
  await bo.getByRole("button", { name: "Ask to join" }).click({ timeout: 20000 });
  let inside = false;
  const joined = bo
    .locator(".thread-doc")
    .first()
    .waitFor({ state: "attached", timeout: 120000 })
    .then(() => void (inside = true));
  await letIn(ana, () => !inside);
  await joined;

  await send(ana, LONG);
  const longRow = bo.locator(".main article.msg", { hasText: "END-OF-LONG-MESSAGE" }).first();
  await longRow.waitFor({ timeout: 15000 });
  const seq = await longRow.getAttribute("data-seq");
  const hashCode = await bo.evaluate(() => location.hash.slice(1).split("?")[0] ?? "");
  for (let i = 0; i < FILLERS; i++) await send(bo, `filler ${i}`);
  await ana
    .locator(".main article.msg", { hasText: `filler ${FILLERS - 1}` })
    .first()
    .waitFor({ timeout: 180000 });
  await ana.waitForTimeout(2000);

  const seen = async (): Promise<string> => {
    await awake(bo);
    await bo.evaluate((h) => void (location.hash = h), `#${hashCode || code}?m=${seq}`);
    const row = bo.locator(`.feed-list > [data-seq="${seq}"]`).first();
    await row.waitFor({ timeout: 20000 }).catch(() => {});
    await bo.waitForTimeout(1000);
    return (await row.innerText().catch(() => "")) ?? "";
  };

  const first = await editOpens(ana);
  check(
    `↑ opens the whole line from ${FILLERS} messages back (${LONG.length} characters)`,
    first === LONG ? null : `it opened ${first.length} characters${first.includes("END-OF-LONG-MESSAGE") ? "" : ", without its end"}`,
  );
  await rowEditor(ana).press("Enter");
  await ana.waitForTimeout(2500);
  const kept = await seen();
  check(
    "saving it unchanged leaves the line whole for bo, not edited",
    kept.includes("END-OF-LONG-MESSAGE") && !/edited/i.test(kept)
      ? null
      : `bo sees ${kept.length} characters${kept.includes("END-OF-LONG-MESSAGE") ? "" : " without its end"}${/edited/i.test(kept) ? ", marked edited" : ""}`,
  );

  const second = await editOpens(ana);
  if (second === LONG) {
    await rowEditor(ana).fill(second.replace("START", "STARTED"));
    await rowEditor(ana).press("Enter");
    await ana.waitForTimeout(2500);
  }
  const changed = await seen();
  check(
    "an edit of it reaches bo whole",
    second === LONG && changed.includes("STARTED") && changed.includes("END-OF-LONG-MESSAGE")
      ? null
      : second !== LONG
        ? `↑ opened ${second.length} characters the second time`
        : `bo sees ${changed.length} characters${changed.includes("STARTED") ? "" : " without the edit"}${changed.includes("END-OF-LONG-MESSAGE") ? "" : " without its end"}`,
  );
  check("no page errors", errors.length ? errors.join("; ") : null);
} finally {
  await browser.close();
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`editing an old message lost text: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("an old message past the window edits whole, and saving it unchanged keeps it whole");
