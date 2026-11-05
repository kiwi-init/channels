import type { Page } from "playwright-core";

export const ROWS = "article.msg";

export const SEND = "ControlOrMeta+Enter";

export const composer = (page: Page) => page.locator(".main .composer textarea").first();

export async function docOpen(page: Page): Promise<void> {
  await composer(page).waitFor({ timeout: 30000 });
  await page.locator(".main .thread-doc").first().waitFor({ state: "attached", timeout: 30000 });
}

export async function say(page: Page, text: string): Promise<void> {
  const area = composer(page);
  await area.fill(text);
  await area.press(SEND);
}

export async function writeBlock(page: Page, text: string): Promise<void> {
  await say(page, text);
  await page.locator(`.thread-doc .blk, ${ROWS}`).filter({ hasText: text, visible: true }).first().waitFor({ timeout: 15000 });
}

export async function eraseLine(page: Page): Promise<void> {
  await page.keyboard.press("Shift+Home");
  await page.keyboard.press("Backspace");
}

export const PLEDGE = "Channels is not a harness";

export async function passOnboarding(page: Page): Promise<void> {
  const next = page.getByRole("button", { name: "continue", exact: true });
  await next
    .or(page.getByRole("textbox", { name: "Your name" }))
    .first()
    .waitFor();
  if (!(await next.isVisible())) return;
  await next.click();
  await page.getByRole("textbox", { name: `Type “${PLEDGE}” to begin` }).pressSequentially(PLEDGE);
}

export async function firstRun(page: Page, name: string): Promise<void> {
  await passOnboarding(page);
  await page.getByRole("textbox", { name: "Your name" }).fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "New channel or join one" }).waitFor({ timeout: 15000 });
}

export async function newChannel(page: Page, title: string): Promise<string> {
  await page.getByRole("button", { name: "New channel or join one" }).click();
  const dialog = page.getByRole("dialog", { name: "New channel" });
  await dialog.getByRole("textbox").fill(title);
  await dialog.getByRole("button", { name: "Create channel" }).click();
  await dialog.waitFor({ state: "detached", timeout: 30000 });
  await docOpen(page);
  await page.getByRole("button", { name: "Invite people", exact: true }).first().click();
  const link = page.getByRole("dialog", { name: "Invite people" }).locator("code").filter({ hasText: "#mc2-" }).first();
  await link.waitFor({ timeout: 15000 });
  const code = (await link.innerText()).trim().replace(/^.*#/, "");
  await page.keyboard.press("Escape");
  await link.waitFor({ state: "detached" });
  return code;
}

export async function approveSpec(page: Page, timeoutMs = 60000): Promise<void> {
  const views = page.getByRole("navigation", { name: "Views" });
  const needs = views.getByRole("button", { name: /^Needs you/ });
  await needs.waitFor({ timeout: timeoutMs });
  await needs.click();
  const approve = page.locator("article.spec-need").getByRole("button", { name: "Approve", exact: true }).first();
  await approve.waitFor({ timeout: timeoutMs });
  await approve.click();
  await approve.waitFor({ state: "detached", timeout: timeoutMs });
  await views.getByRole("button", { name: /general/ }).click();
}

export async function unfold(page: Page, spec: string): Promise<void> {
  const main = page.getByRole("main");
  const fold = main.getByRole("button", { name: new RegExp(`^(Show|Hide) the \\d+ open tasks? of ${spec}$`) });
  if ((await fold.getAttribute("aria-expanded", { timeout: 15000 })) === "false") await fold.click();
  await main.getByRole("button", { name: new RegExp(`^Hide the \\d+ open tasks? of ${spec}$`), expanded: true }).waitFor({ timeout: 15000 });
}

export async function letIn(page: Page, waiting: () => boolean, timeoutMs = 120000): Promise<void> {
  const views = page.getByRole("navigation", { name: "Views" });
  const needs = views.getByRole("button", { name: /^Needs you/ });
  const match = page.getByRole("button", { name: /^It matches: let .+ in$/ }).first();
  const deadline = Date.now() + timeoutMs;
  while (waiting()) {
    if (Date.now() > deadline) throw new Error("the agents were not let in in time");
    if ((await needs.isVisible().catch(() => false)) && (await needs.getAttribute("aria-pressed").catch(() => null)) !== "true") await needs.click().catch(() => undefined);
    if (await match.isVisible().catch(() => false)) await match.click().catch(() => undefined);
    await page.waitForTimeout(100);
  }
  await views.getByRole("button", { name: /general/ }).click();
}

export async function view(page: Page, label: string, marker: string): Promise<number> {
  return page.evaluate(
    async ([name, text]) => {
      const flat = (s: string) => s.replace(/\s+/g, "");
      const b = [...document.querySelectorAll<HTMLElement>('nav[aria-label="Views"] button')].find((x) => flat(x.textContent ?? "").startsWith(flat(name)));
      if (!b) throw new Error(`no ${name} view`);
      const t0 = performance.now();
      b.click();
      const deadline = t0 + 15000;
      while (performance.now() < deadline) {
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
        if (b.getAttribute("aria-pressed") === "true" && new RegExp(text).test(document.querySelector("main")?.textContent ?? "")) break;
      }
      if (performance.now() >= deadline) throw new Error(`the ${name} view opened without ${text}`);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return Math.round(performance.now() - t0);
    },
    [label, marker] as const,
  );
}

export async function channelSettings(page: Page, opening: boolean): Promise<number> {
  return page.evaluate(async (open) => {
    const shown = () => document.querySelector('dialog.modal[open][aria-label="Channel settings"]');
    const close = () => [...(shown()?.querySelectorAll<HTMLElement>("button") ?? [])].find((b) => b.getAttribute("aria-label") === "Close");
    const button = open ? [...document.querySelectorAll<HTMLElement>("button")].find((b) => (b.getAttribute("aria-label") ?? "").endsWith(": channel settings")) : close();
    if (!button) throw new Error(open ? "no channel settings button" : "no Close in channel settings");
    const t0 = performance.now();
    button.click();
    const deadline = t0 + 15000;
    while (performance.now() < deadline) {
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      if (!!shown() === open) break;
    }
    if (performance.now() >= deadline) throw new Error(open ? "channel settings never opened" : "channel settings never closed");
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Math.round(performance.now() - t0);
  }, opening);
}
