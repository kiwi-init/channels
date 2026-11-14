import { chromium, webkit } from "playwright-core";
import { pageErrors } from "./page-errors.ts";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const engine = flag("--browser") ?? "webkit";
if (engine !== "webkit" && engine !== "chromium") throw new Error(`--browser is webkit or chromium, not ${engine}`);

const PAGE = `<!doctype html><meta charset="utf-8"><title>page errors</title>
<div id="box" class="grows" style="width:120px;height:40px"></div>
<div id="pad" style="width:120px;height:40px;padding-bottom:6px"></div>
<div id="rows"><div id="first" style="height:20px"></div></div>
<div id="feed"><div id="line" style="padding:4px"><p id="plain" style="margin:0;line-height:24px">plain</p></div></div>
<script src="/loop.js"></script>`;

const SCRIPT = `window.throwNow = function throwNow() {
  setTimeout(function later() {
    missing();
  }, 0);
};
window.loopNow = function loopNow() {
  const box = document.getElementById("box");
  const pad = document.getElementById("pad");
  let turns = 0;
  const watch = new ResizeObserver(function grow() {
    if (turns++ >= 2) return;
    box.style.height = box.offsetHeight + 20 + "px";
    pad.style.paddingBottom = "2px";
  });
  watch.observe(box);
  watch.observe(pad);
};
window.watchLate = function watchLate() {
  const rows = document.getElementById("rows");
  let mounted = false;
  const watch = new ResizeObserver(function seen() {
    if (mounted) return;
    mounted = true;
    queueMicrotask(function mount() {
      const row = document.createElement("div");
      row.id = "second";
      row.style.height = "20px";
      rows.append(row);
      watch.observe(row);
    });
  });
  watch.observe(document.getElementById("first"));
};
window.swapWhileLoading = function swapWhileLoading() {
  const feed = document.getElementById("feed");
  const line = document.getElementById("line");
  new ResizeObserver(function fed() {
    void feed.offsetHeight;
  }).observe(feed);
  new ResizeObserver(function lined() {
    void line.offsetHeight;
  }).observe(line);
  setTimeout(function load() {
    const sheet = document.createElement("link");
    sheet.rel = "stylesheet";
    sheet.href = "/slow.css";
    document.head.append(sheet);
    setTimeout(function swap() {
      document.getElementById("plain").remove();
      const shown = document.createElement("p");
      shown.style.cssText = "margin:0;line-height:24px";
      shown.textContent = "shown";
      line.append(shown);
    }, 60);
  }, 200);
};
`;

interface Probes {
  throwNow?: () => void;
  loopNow?: () => void;
  watchLate?: () => void;
  swapWhileLoading?: () => void;
}

const SLOW_SHEET_MS = 1200;

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/slow.css") {
      await Bun.sleep(SLOW_SHEET_MS);
      return new Response("#never { color: red }", { headers: { "content-type": "text/css" } });
    }
    return path === "/loop.js" ? new Response(SCRIPT, { headers: { "content-type": "text/javascript" } }) : new Response(PAGE, { headers: { "content-type": "text/html" } });
  },
});
const browser = await (engine === "webkit" ? webkit : chromium).launch({ executablePath: engine === "chromium" ? process.env.SMOKE_CHROMIUM || undefined : undefined });

const printed: string[] = [];
const print = console.log.bind(console);
console.log = (...parts: unknown[]) => {
  printed.push(parts.map(String).join(" "));
  print(...parts);
};
const fails: string[] = [];
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};
const until = async (done: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !done(); i++) await new Promise((next) => setTimeout(next, 50));
};

try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const told: string[] = [];
  await pageErrors(page, (e) => told.push(e));
  await page.goto(`http://127.0.0.1:${server.port}/`);
  expect(told.length === 0, "the page opens without an error");

  await page.evaluate(() => (window as Window & Probes).throwNow?.());
  await until(() => told.length > 0);
  const thrown = told[0] ?? "";
  expect(thrown.includes("missing"), `a thrown error is told with its message (${thrown.split("\n")[0]})`);
  expect(thrown.includes("after: ok   the page opens without an error"), "it names the check it came after");
  expect(/stack:\n\s+.*loop\.js:\d+/.test(thrown) && !thrown.includes("127.0.0.1"), "it carries its stack, with the file and line and without the server's address");

  const before = printed.length;
  await page.evaluate(() => (window as Window & Probes).loopNow?.());
  await until(() => told.length > 1 || engine !== "webkit");
  await new Promise((next) => setTimeout(next, 500));
  const loop = told.slice(1).find((t) => t.includes("ResizeObserver")) ?? "";
  const all = `${told.slice(1).join("\n")}\n${printed.slice(before).join("\n")}`;
  if (engine === "webkit" || loop) {
    expect(loop !== "", `a resize observer that loops is told (${loop.split("\n")[0]})`);
    expect(loop.includes("after: ok   it carries its stack"), "it names the check it came after too");
    expect(/div#box\.grows \d+x\d+ -> \d+x\d+, watched by observer \d+/.test(all), "it names the element that changed size after its observer ran, with both sizes");
    expect(/observer \d+ \(made at .*loop\.js:\d+/.test(all), "it names where that observer was made");
    expect(!/div#pad \d+x\d+ -> /.test(all), "an element whose padding changed, and whose watched box did not, is not named as changed");
  } else console.log(`note ${engine} does not raise a resize observer loop as a page error, so there is nothing to tell here: WebKit runs these`);

  const toldBefore = told.length;
  const printedBefore = printed.length;
  await page.evaluate(() => (window as Window & Probes).watchLate?.());
  await until(() => told.length > toldBefore || engine !== "webkit");
  await new Promise((next) => setTimeout(next, 500));
  const late = told.slice(toldBefore).find((t) => t.includes("ResizeObserver")) ?? "";
  const lateAll = `${told.slice(toldBefore).join("\n")}\n${printed.slice(printedBefore).join("\n")}`;
  if (engine === "webkit" || late) {
    expect(late !== "", `an element put under watch right after its observer ran, in the same frame, is told as a loop (${late.split("\n")[0]})`);
    expect(/div#second \d+x20, put under watch \d+ ms before by observer \d+/.test(lateAll), "it names that element, its size and how long before it was put under watch");
    expect(!/div#first \d+x\d+ -> /.test(lateAll), "and no element that kept its size");
  }

  const toldLoading = told.length;
  const printedLoading = printed.length;
  await page.evaluate(() => (window as Window & Probes).swapWhileLoading?.());
  await until(() => told.length > toldLoading || engine !== "webkit");
  await new Promise((next) => setTimeout(next, SLOW_SHEET_MS + 500));
  const held = told.slice(toldLoading).find((t) => t.includes("ResizeObserver")) ?? "";
  const heldAll = `${told.slice(toldLoading).join("\n")}\n${printed.slice(printedLoading).join("\n")}`;
  if (engine === "webkit" || held) {
    expect(held !== "", `a line whose text is swapped while a stylesheet loads in <head> is laid out late, and told as a loop (${held.split("\n")[0]})`);
    expect(/1 stylesheet was still loading in <head>[^\n]*\n\s+slow\.css/.test(heldAll), "it names the stylesheet that was still loading in <head>");
    expect(/div#feed \d+x8 -> \d+x32, watched by observer \d+/.test(heldAll), "and the list that was told the line was empty");
  } else console.log(`note ${engine} lays out new elements while a stylesheet loads in <head>, so there is no loop to tell here: WebKit runs these`);
  await page.close();
} finally {
  await browser.close();
  await server.stop(true);
}
if (fails.length) {
  console.error(`\n${fails.length} failed:\n${fails.map((f) => `  ${f}`).join("\n")}`);
  process.exit(1);
}
console.log(`\npage errors explain themselves in ${engine}`);
