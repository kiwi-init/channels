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
<script src="/loop.js"></script>`;

const SCRIPT = `window.throwNow = function throwNow() {
  setTimeout(function later() {
    missing();
  }, 0);
};
window.loopNow = function loopNow() {
  const box = document.getElementById("box");
  let turns = 0;
  new ResizeObserver(function grow() {
    if (turns++ < 2) box.style.height = box.offsetHeight + 20 + "px";
  }).observe(box);
};
`;

interface Probes {
  throwNow?: () => void;
  loopNow?: () => void;
}

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    return new URL(req.url).pathname === "/loop.js" ? new Response(SCRIPT, { headers: { "content-type": "text/javascript" } }) : new Response(PAGE, { headers: { "content-type": "text/html" } });
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
  await until(() => told.length > 1);
  await new Promise((next) => setTimeout(next, 500));
  const loop = told.slice(1).find((t) => t.includes("ResizeObserver")) ?? "";
  const all = `${told.slice(1).join("\n")}\n${printed.slice(before).join("\n")}`;
  expect(loop !== "", `a resize observer that loops is told (${loop.split("\n")[0]})`);
  expect(loop.includes("after: ok   it carries its stack"), "it names the check it came after too");
  expect(/div#box\.grows \d+x\d+ -> \d+x\d+, watched by observer \d+/.test(all), "it names the element that changed size after its observer ran, with both sizes");
  expect(/observer \d+ \(made at .*loop\.js:\d+/.test(all), "it names where that observer was made");
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
