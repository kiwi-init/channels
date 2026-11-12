#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = flag("--browser") ?? "chromium";
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

interface Line {
  text: string;
  gone: string;
  toned: boolean;
  act: string;
  fits: boolean;
}

const lineUnder = (page: Page, said: string): Promise<Line | null> =>
  page.evaluate((said) => {
    const row = [...document.querySelectorAll(".main article.msg")].find((a) => a.querySelector(".msg-text")?.textContent?.includes(said));
    const line = row?.querySelector(".msg-receipt");
    if (!row || !line) return null;
    const gone = line.querySelector("span");
    const probe = document.createElement("span");
    probe.style.color = "var(--decide)";
    line.append(probe);
    const decide = getComputedStyle(probe).color;
    probe.remove();
    const feed = document.querySelector(".main .feed");
    const box = line.getBoundingClientRect();
    const room = feed?.getBoundingClientRect();
    return {
      text: (line.textContent ?? "").trim(),
      gone: (gone?.textContent ?? "").trim(),
      toned: !!gone && getComputedStyle(gone).color === decide,
      act: (line.querySelector("button")?.textContent ?? "").trim(),
      fits: !!room && box.left >= room.left - 0.5 && box.right <= room.right + 0.5,
    };
  }, said);

const sideways = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const feed = document.querySelector(".main .feed");
    return feed ? feed.scrollWidth - feed.clientWidth : 0;
  });

try {
  for (const theme of ["dark", "light"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("pageerror", (e) => fails.push(`page threw in ${theme}: ${e.message}`));
    await page.goto(`http://127.0.0.1:${server.port}/?shot=signs&theme=${theme}`);
    await page.locator(".main article.msg .msg-receipt").first().waitFor();
    await page.waitForTimeout(600);

    const asleep = await lineUnder(page, "any news on the tabs?");
    expect(asleep?.text === "pixel can't be woken" && asleep.gone === asleep.text, `${theme}: an agent nothing can wake is named under the message (${asleep?.text ?? "no line"})`);
    expect(!!asleep?.toned, `${theme}: and its name is in the colour of what waits on a person`);
    expect(asleep?.act === "", `${theme}: with no button beside it (${asleep?.act ?? ""})`);

    const silent = await lineUnder(page, "and the release notes?");
    expect(silent?.text === "nova isn't listening" && !!silent.toned, `${theme}: an agent nothing answers for is named the same way (${silent?.text ?? "no line"})`);

    const busy = await lineUnder(page, "is the bubble in my app?");
    expect(busy?.text === "win is busy on T10 · 3 messages ahead of yoursAsk atlas", `${theme}: a busy agent shows its task and how many messages are ahead of yours (${busy?.text ?? "no line"})`);
    expect(busy?.gone === "" && busy.act === "Ask atlas", `${theme}: in the quiet ink, with a button that names the lead (${busy?.act ?? "no button"})`);

    const on = await lineUnder(page, "can you look at the scroll bug?");
    expect(on?.text === "atlas is on it · thinking 1m" && on.act === "" && on.gone === "", `${theme}: an agent that has the message reads as before (${on?.text ?? "no line"})`);

    for (const width of [1280, 700, 420]) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(300);
      const lines = await Promise.all(["any news on the tabs?", "and the release notes?", "is the bubble in my app?"].map((said) => lineUnder(page, said)));
      const over = await sideways(page);
      expect(lines.every((l) => l?.fits) && over <= 1, `${theme}, ${width} wide: each line stays inside the conversation and nothing scrolls sideways (${over}px)`);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(300);

    const before = await page.locator(".main article.msg").count();
    await page.locator(".main .msg-receipt button", { hasText: "Ask atlas" }).click();
    await page.waitForTimeout(600);
    const sent = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".main article.msg")];
      const last = rows.at(-1);
      return {
        rows: rows.length,
        text: (last?.querySelector(".msg-text")?.textContent ?? "").trim(),
        quote: (last?.querySelector(".msg-quote")?.textContent ?? "").trim(),
        mine: !!last?.classList.contains("is-mine"),
      };
    });
    expect(sent.rows === before + 1 && sent.mine, `${theme}: the button sends one message of yours to the room (${before} rows, then ${sent.rows})`);
    expect(/^@?atlas\b/.test(sent.text) && sent.text.includes("win is busy and has not read this yet"), `${theme}: it names the lead and says who is busy (${sent.text})`);
    expect(sent.quote.includes("is the bubble in my app?"), `${theme}: as a reply to the message that waits (${sent.quote || "no quote"})`);
    await page.close();
  }
} finally {
  await browser.close();
  void server.stop(true);
}

if (fails.length) {
  console.error(`\n${fails.length} failed:\n${fails.map((f) => `- ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("\nthe line under a message names who can't be woken, who isn't listening and who is busy, and the lead is one click away");
