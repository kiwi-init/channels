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
  const panel = page.locator("aside.panel");
  const modal = page.locator("dialog.modal[open]");

  await page.goto(`http://127.0.0.1:${server.port}/?shot=general`);
  await page.getByRole("button", { name: /: channel menu$/ }).click();
  await page.getByRole("menuitem", { name: "Channel settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Channel settings" });
  await settings.waitFor();
  expect((await panel.count()) === 0, "channel settings open in a modal, not the side panel");
  await settings.getByRole("button", { name: "Rooms", exact: true }).click();
  expect((await settings.getByText("launch-plan", { exact: true }).count()) === 1, "its Rooms section lists the rooms");
  expect((await settings.getByText("you, maya, atlas").count()) === 1, "a members-only room shows who's in on one line");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  expect((await modal.count()) === 0, "Esc closes it");

  await page.goto(`http://127.0.0.1:${server.port}/?shot=person`);
  const profile = page.getByRole("dialog", { name: "Profile of maya" });
  await profile.waitFor();
  expect((await panel.count()) === 0, "a profile opens in a modal, not the side panel");
  const box = await profile.boundingBox();
  if (!box) throw new Error("the profile modal has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(8, 400, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  expect((await modal.count()) === 1, "a press inside it that ends outside, like a text selection, keeps it open");
  await page.mouse.click(8, 400);
  await page.waitForTimeout(200);
  expect((await modal.count()) === 0, "a click outside closes it");

  await page.goto(`http://127.0.0.1:${server.port}/?shot=general`);
  await page.getByRole("button", { name: "Invite people", exact: true }).first().click();
  await page.getByRole("dialog", { name: "Invite people" }).waitFor();
  await page.keyboard.press("ControlOrMeta+BracketLeft");
  await page.waitForTimeout(200);
  expect((await modal.count()) === 0, "Back closes it");
  expect(page.url().includes("shot=general") && (await page.getByRole("textbox", { name: "Thread" }).count()) === 1, "and stays where it was");

  await page.goto(`http://127.0.0.1:${server.port}/?shot=agent-yours-trusted`);
  const pip = page.getByRole("dialog", { name: "Profile of Pip" });
  await pip.waitFor();
  expect((await pip.locator(".person-handle code").textContent()) === "pip", "an agent with a nickname shows its handle in its profile (#1745)");
  expect((await pip.getByRole("button", { name: "Copy handle", exact: true }).count()) === 1, "with a button that copies it");
  await page.goto(`http://127.0.0.1:${server.port}/?shot=agent`);
  await page.getByRole("dialog", { name: "Profile of atlas" }).waitFor();
  expect((await page.locator(".person-handle").count()) === 0, "an agent without one shows no Handle row, since the header is its handle");

  await page.goto(`http://127.0.0.1:${server.port}/?shot=add-agent`);
  const add = page.getByRole("dialog", { name: "Add an agent" });
  await add.waitFor();
  const focused = await page.evaluate(() => !!document.activeElement?.closest("dialog.modal"));
  expect(focused, "focus starts inside the modal");
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest("dialog.modal")), "and Tab keeps it there");
  await page.mouse.click(8, 400);
  await page.waitForTimeout(200);
  expect((await modal.count()) === 1, "a click outside Add an agent keeps it open (#1764)");
  await add.getByRole("button", { name: "Close", exact: true }).click();
  await page.waitForTimeout(200);
  expect((await modal.count()) === 0, "its X closes it");
  await page.goto(`http://127.0.0.1:${server.port}/?shot=add-agent`);
  await add.waitFor();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  expect((await modal.count()) === 0, "and so does Esc");

  for (const personality of [null, "Lead"]) {
    await page.goto(`http://127.0.0.1:${server.port}/?shot=add-agent`);
    await add.waitFor();
    const command = add.locator(".invite-box code");
    await command.locator(".invite-part").first().waitFor();
    if (personality) {
      await add.getByRole("combobox", { name: "Personality" }).selectOption({ label: personality });
      await command.getByText(/^--persona /).waitFor();
    }
    const height = () => add.evaluate((el) => (el as HTMLElement).offsetHeight);
    const settled = new Set([await height()]);
    await page.evaluate(() => {
      const open = document.querySelector<HTMLElement>("dialog.modal[open]");
      if (!open) throw new Error("no open modal");
      const seen = document.documentElement.dataset;
      seen.blank = "0";
      seen.heights = "";
      new MutationObserver(() => {
        if (open.querySelector(".invite-box code")?.textContent === "…") seen.blank = String(Number(seen.blank) + 1);
        seen.heights += `${open.offsetHeight} `;
      }).observe(open, { childList: true, subtree: true, characterData: true });
    });
    await add.getByRole("textbox", { name: "Name" }).press("ControlOrMeta+a");
    const typed = "scout-7";
    for (let i = 1; i <= typed.length; i++) {
      await page.keyboard.type(typed.charAt(i - 1));
      await command.getByText(`--nick ${typed.slice(0, i)}`, { exact: true }).waitFor();
      settled.add(await height());
    }
    const seen = await page.evaluate(() => ({
      blank: Number(document.documentElement.dataset.blank),
      heights: (document.documentElement.dataset.heights ?? "").trim().split(" ").filter(Boolean).map(Number),
    }));
    const odd = [...new Set(seen.heights.filter((h) => !settled.has(h)))];
    const how = personality ? `with the ${personality} personality` : "with no personality";
    expect(seen.heights.length > 0, `typing a name in Add an agent ${how} makes a new command for each letter`);
    expect(seen.blank === 0, `and the Command box never goes blank between letters (T21)${seen.blank ? `: blank ${seen.blank} times` : ""}`);
    expect(odd.length === 0, `and the modal is only ever the size of a command it showed${odd.length ? `: ${odd.join(", ")}px seen, settled sizes ${[...settled].join(", ")}px` : ""}`);
  }

  for (const [shot, name, field] of [
    ["new-room", "New room", "Room name"],
    ["new-channel", "New channel", "Name"],
    ["join", "Join with a code", "Invite link or code"],
  ] as const) {
    await page.goto(`http://127.0.0.1:${server.port}/?shot=${shot}`);
    await page.getByRole("dialog", { name }).waitFor();
    await page.waitForTimeout(100);
    const label = await page.evaluate(() => {
      const el = document.activeElement;
      return el instanceof HTMLInputElement ? (el.getAttribute("aria-label") ?? el.labels?.[0]?.textContent ?? "") : "";
    });
    expect(label.trim() === field, `${name} opens with its field focused`);
    if (shot !== "new-channel") expect((await page.getByRole("dialog", { name }).getByRole("button", { name: "Cancel", exact: true }).count()) === 1, `${name} has a Cancel`);
    await page.keyboard.type("x");
    await page.mouse.click(8, 400);
    await page.waitForTimeout(200);
    expect((await modal.count()) === 1, `a click outside ${name} keeps what was typed`);
    await page.goto(`http://127.0.0.1:${server.port}/?shot=${shot}`);
    await page.getByRole("dialog", { name }).waitFor();
    await page.mouse.click(8, 400);
    await page.waitForTimeout(200);
    expect((await modal.count()) === 0, `a click outside ${name} closes it while nothing is typed`);
  }

  await page.goto(`http://127.0.0.1:${server.port}/?shot=specs`);
  await page.getByRole("button", { name: "New spec" }).click();
  const spec = page.getByRole("dialog", { name: "New spec" });
  await spec.waitFor();
  await page.keyboard.type("Posts from the keyboard");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  expect((await modal.count()) === 1, "Enter in New spec is a new line");
  await page.keyboard.press("ControlOrMeta+Enter");
  await modal.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  expect((await modal.count()) === 0, "Cmd/Ctrl+Enter posts it");
} finally {
  await browser.close();
  await server.stop(true);
}
if (fails.length) {
  console.error(fails.join("\n"));
  process.exit(1);
}
