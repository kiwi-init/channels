import type { Page } from "playwright-core";

export const ROWS = "article.msg";

export async function firstRun(page: Page, name: string): Promise<void> {
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
  await page.getByRole("textbox", { name: "Message" }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "invite", exact: true }).click();
  const link = page.getByRole("complementary", { name: "Details" }).locator("code").filter({ hasText: "#mc2-" }).first();
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

export async function panel(page: Page, opening: boolean): Promise<number> {
  return page.evaluate(async (open) => {
    const close = () => [...document.querySelectorAll<HTMLElement>('aside[aria-label="Details"] button')].find((b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === "Close");
    const button = open ? [...document.querySelectorAll<HTMLElement>("button")].find((b) => (b.getAttribute("aria-label") ?? "").endsWith(": channel settings")) : close();
    if (!button) throw new Error(open ? "no channel settings button" : "no Close in the panel");
    const t0 = performance.now();
    button.click();
    const deadline = t0 + 15000;
    while (performance.now() < deadline) {
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      if (!!document.querySelector('aside[aria-label="Details"]') === open) break;
    }
    if (performance.now() >= deadline) throw new Error(open ? "the panel never opened" : "the panel never closed");
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Math.round(performance.now() - t0);
  }, opening);
}
