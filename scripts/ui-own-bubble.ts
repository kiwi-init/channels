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

const WORD = 96;
const CAP_REM = 36;
const BALANCED = 6;

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});
const browser = await (engine === "webkit" ? webkit : chromium).launch({ executablePath: engine === "chromium" ? process.env.SMOKE_CHROMIUM || undefined : undefined });
const fails: string[] = [];
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};

interface Bubble {
  seq: string;
  left: number;
  right: number;
  width: number;
  top: number;
  bottom: number;
  lines: number;
  endLines: number;
  set: string;
  plain: boolean;
  textRight: number;
  lastRight: number;
  padRight: number;
  fill: string;
  topRight: number;
  bottomRight: number;
  rowRight: number;
  rowHeight: number;
  compact: boolean;
  parts: { name: string; right: number; top: number; bottom: number }[];
}

interface Seen {
  rem: number;
  fill: string;
  sideways: number;
  mine: Bubble[];
  theirsGap: number;
}

const see = (page: Page): Promise<Seen> =>
  page.evaluate(() => {
    const probe = document.createElement("i");
    probe.style.background = "var(--bg-3)";
    document.body.append(probe);
    const fill = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const feed = document.querySelector<HTMLElement>(".main .feed");
    const rows = [...document.querySelectorAll<HTMLElement>(".main article.msg")];
    const mine = rows.flatMap((row) => {
      const bubble = row.querySelector<HTMLElement>(".msg-text");
      const body = row.querySelector<HTMLElement>(".msg-body");
      if (!row.classList.contains("is-mine") || !bubble || !body) return [];
      const box = bubble.getBoundingClientRect();
      const style = getComputedStyle(bubble);
      const range = document.createRange();
      const walk = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT);
      const lines = new Map<number, number>();
      let end: Element | null = null;
      let endLines = new Set<number>();
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!n.nodeValue?.trim()) continue;
        const block = n.parentElement?.closest("p, li, dd, dt, blockquote, h1, h2, h3, h4, h5, h6") ?? bubble;
        if (block !== end) {
          end = block;
          endLines = new Set();
        }
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) {
          const line = Math.round(r.top / 4);
          lines.set(line, Math.max(lines.get(line) ?? 0, r.right));
          endLines.add(line);
        }
      }
      const rights = [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, right]) => right);
      const parts = [
        ["the picture", ".msg-image"],
        ["the task chip", ".chip"],
        ["the last reaction", ".reacts > :last-child"],
        ["the replies line", ".msg-thread"],
        ["the quote's text", ".msg-quote-text"],
      ].flatMap(([name, selector]) => {
        const r = row.querySelector(selector as string)?.getBoundingClientRect();
        return r ? [{ name: name as string, right: r.right, top: r.top, bottom: r.bottom }] : [];
      });
      return [
        {
          seq: row.dataset.seq ?? "",
          left: box.left,
          right: box.right,
          width: box.width,
          top: box.top,
          bottom: box.bottom,
          lines: rights.length,
          endLines: endLines.size,
          set: bubble.style.width,
          plain: bubble.querySelector(".md-plain") !== null,
          textRight: Math.max(0, ...rights),
          lastRight: rights[rights.length - 1] ?? 0,
          padRight: Number.parseFloat(style.paddingRight),
          fill: style.backgroundColor,
          topRight: Number.parseFloat(style.borderTopRightRadius),
          bottomRight: Number.parseFloat(style.borderBottomRightRadius),
          rowRight: body.getBoundingClientRect().right,
          rowHeight: row.getBoundingClientRect().height,
          compact: row.classList.contains("is-compact"),
          parts,
        },
      ];
    });
    const firstMine = rows.findIndex((r) => r.classList.contains("is-mine"));
    const before = rows[firstMine - 1]?.getBoundingClientRect();
    const first = rows[firstMine]?.querySelector(".msg-text")?.getBoundingClientRect();
    return {
      rem: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
      fill,
      sideways: feed ? feed.scrollWidth - feed.clientWidth : 0,
      mine,
      theirsGap: before && first ? first.top - before.bottom : 0,
    };
  });

const px = (n: number): string => `${Math.round(n * 10) / 10}px`;

async function checks(page: Page, at: string): Promise<void> {
  const seen = await see(page);
  const wrapped = seen.mine.filter((b) => b.lines > 1);
  expect(seen.mine.length === 7 && wrapped.length >= 3, `${at}: the scene has seven messages of yours, three or more of them wrapped (${seen.mine.length}, ${wrapped.length})`);
  const loose = wrapped.map((b) => ({ ...b, gap: b.right - b.padRight - b.textRight })).filter((b) => b.gap > 2.5 || b.gap < -0.5);
  expect(
    loose.length === 0,
    `${at}: a wrapped bubble is as wide as its longest line${loose.map((b) => `, #${b.seq} is ${px(b.gap)} off (${b.set ? `fitted to ${b.set}` : "not fitted"}${b.plain ? ", still plain text" : ""})`).join("")}`,
  );
  const ends = wrapped.filter((b) => b.endLines <= BALANCED);
  const corners = ends.map((b) => ({ seq: b.seq, corner: b.right - b.padRight - b.lastRight })).filter((b) => b.corner > WORD);
  expect(
    ends.length > 0 && corners.length === 0,
    `${at}: its last line ends within a word (${WORD}px) of the bubble's edge, when its last paragraph has up to ${BALANCED} lines, the most every engine balances (${ends.length} such)${corners.map((b) => `, #${b.seq} leaves ${px(b.corner)}`).join("")}`,
  );
  const wide = seen.mine.filter((b) => b.width > CAP_REM * seen.rem + 0.5);
  expect(wide.length === 0, `${at}: no bubble is wider than ${CAP_REM}rem${wide.map((b) => `, #${b.seq} is ${px(b.width)}`).join("")}`);
  const off = seen.mine.flatMap((b) =>
    [{ name: "the bubble", right: b.right }, ...b.parts].filter((p) => Math.abs(p.right - b.rowRight) > 1).map((p) => `, ${p.name} of #${b.seq} is ${px(b.rowRight - p.right)} short`),
  );
  const named = new Set(seen.mine.flatMap((b) => b.parts.map((p) => p.name)));
  expect(off.length === 0 && named.size === 5, `${at}: the bubble, the picture, the task chip, the reactions, the replies line and the quote all end on one right edge${off.join("")}`);
  expect(
    seen.mine.every((b) => b.fill === seen.fill),
    `${at}: the bubble's fill is bg-3, with no tint (${seen.mine[0]?.fill} against ${seen.fill})`,
  );
  const runs = seen.mine.flatMap((b, i) => {
    const prev = seen.mine[i - 1];
    if (!b.compact || !prev) return [];
    const above = Math.max(prev.bottom, ...prev.parts.map((p) => p.bottom));
    return [{ seq: b.seq, gap: b.top - above, inner: Math.max(b.topRight, prev.bottomRight) }];
  });
  expect(
    runs.length === 2 && runs.every((r) => r.gap >= 1.5 && r.gap <= 4.5 && r.inner <= 6),
    `${at}: a run of your messages is one group: 2 to 4px apart, with tight inner corners (${runs.map((r) => `${px(r.gap)}, ${r.inner}px`).join("; ")})`,
  );
  expect(seen.theirsGap >= 16, `${at}: your message keeps its distance from someone else's above it (${px(seen.theirsGap)})`);
  expect(seen.sideways <= 0, `${at}: the conversation does not scroll sideways (${seen.sideways}px)`);
  const grew = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".main article.msg.is-mine")].flatMap((row) => {
      const bubble = row.querySelector<HTMLElement>(".msg-text");
      if (!bubble?.style.width) return [];
      const fitted = row.getBoundingClientRect().height;
      const width = bubble.style.width;
      bubble.style.width = "";
      const loose = row.getBoundingClientRect().height;
      bubble.style.width = width;
      return fitted === loose ? [] : [`#${row.dataset.seq} ${fitted} against ${loose}`];
    }),
  );
  expect(grew.length === 0, `${at}: fitting a bubble to its text never changes the message's height${grew.map((g) => `, ${g}`).join("")}`);
}

async function sweep(page: Page): Promise<{ steps: number; wrong: string[] }> {
  const widths: number[] = [];
  for (let w = 1000; w >= 420; w -= 29) widths.push(w);
  for (let w = 449; w <= 1000; w += 37) widths.push(w);
  const wrong: string[] = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    const found = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".main article.msg.is-mine")].flatMap((row) => {
        const bubble = row.querySelector<HTMLElement>(".msg-text");
        const body = row.querySelector<HTMLElement>(".msg-body");
        if (!bubble || !body) return [];
        const box = bubble.getBoundingClientRect();
        const range = document.createRange();
        const walk = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT);
        const tops = new Set<number>();
        let right = 0;
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          if (!n.nodeValue?.trim()) continue;
          range.selectNodeContents(n);
          for (const r of range.getClientRects()) {
            tops.add(Math.round(r.top / 4));
            right = Math.max(right, r.right);
          }
        }
        const said: string[] = [];
        const gap = box.right - Number.parseFloat(getComputedStyle(bubble).paddingRight) - right;
        if (tops.size > 1 && (gap > 2.5 || gap < -0.5)) said.push(`#${row.dataset.seq} is ${Math.round(gap * 10) / 10}px off its longest line`);
        if (box.left < body.getBoundingClientRect().left - 0.5 || box.left < row.getBoundingClientRect().left) said.push(`#${row.dataset.seq} is wider than its room`);
        const set = bubble.style.width;
        if (set) {
          const fitted = row.getBoundingClientRect().height;
          bubble.style.width = "";
          const loose = row.getBoundingClientRect().height;
          bubble.style.width = set;
          if (fitted !== loose) said.push(`#${row.dataset.seq} is ${fitted}px tall fitted and ${loose}px unfitted`);
        }
        return said;
      }),
    );
    wrong.push(...found.map((f) => `at ${width}px ${f}`));
  }
  return { steps: widths.length, wrong };
}

interface Painted {
  frames: number;
  loose: number;
  run: number;
  longest: number;
  first: string;
  worst: string;
}

function watchPaints(): void {
  const painted: Painted = { frames: 0, loose: 0, run: 0, longest: 0, first: "", worst: "" };
  (window as Window & { bubblePaints?: Painted }).bubblePaints = painted;
  const slack = (bubble: HTMLElement): number => {
    if (bubble.style.width || bubble.querySelector("pre, table, img, svg, hr")) return 0;
    const range = document.createRange();
    const walk = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT);
    const tops = new Set<number>();
    let right = 0;
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.nodeValue?.trim()) continue;
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        tops.add(Math.round(r.top / 4));
        right = Math.max(right, r.right);
      }
    }
    return tops.size > 1 ? bubble.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(bubble).paddingRight) - right : 0;
  };
  const after = new MessageChannel();
  after.port1.onmessage = () => {
    const mine = [...document.querySelectorAll<HTMLElement>(".main article.msg.is-mine .msg-text")];
    if (mine.length === 0) return;
    painted.frames += 1;
    const wide = mine.map((bubble) => ({ bubble, by: slack(bubble) })).find((b) => b.by > 2.5);
    if (!wide) {
      painted.run = 0;
      return;
    }
    painted.loose += 1;
    painted.run += 1;
    if (painted.run === 1)
      painted.first = `#${wide.bubble.closest("article")?.dataset.seq} ${Math.round(wide.by)}px too wide in a ${window.innerWidth}px window, ${wide.bubble.querySelector(".md-plain") ? "still plain text" : "rendered"}`;
    if (painted.run > painted.longest) {
      painted.longest = painted.run;
      painted.worst = painted.first;
    }
  };
  const tick = () => {
    after.port2.postMessage(0);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const settle = async (page: Page): Promise<void> => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".main article.msg.is-mine .msg-text")].every((bubble) => !bubble.querySelector(".md-plain") && bubble.querySelector(".md")?.textContent?.trim()),
  );
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
};

interface Probe {
  loaded: Promise<boolean>;
  writes: number;
  watch: MutationObserver | null;
}

async function fontRefit(page: Page, width: number): Promise<string> {
  let open: () => void = () => {};
  const held = new Promise<void>((go) => {
    open = go;
  });
  await page.route("**/fonts/Inter.woff2?probe", async (route) => {
    await held;
    await route.continue();
  });
  await page.evaluate(() => {
    const face = new FontFace("Own Bubble Probe", "url(/fonts/Inter.woff2?probe)");
    document.fonts.add(face);
    const probe: Probe = {
      loaded: face.load().then(
        () => true,
        () => false,
      ),
      writes: 0,
      watch: null,
    };
    (window as Window & { bubbleProbe?: Probe }).bubbleProbe = probe;
  });
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(300);
  const status = await page.evaluate(() => {
    const probe = (window as Window & { bubbleProbe?: Probe }).bubbleProbe;
    const bubble = [...document.querySelectorAll<HTMLElement>(".main article.msg.is-mine .msg-text")].find((b) => b.style.width);
    if (!probe || !bubble) return "no fitted bubble to watch";
    probe.watch = new MutationObserver((seen) => {
      probe.writes += seen.length;
    });
    probe.watch.observe(bubble, { attributes: true, attributeFilter: ["style"] });
    return document.fonts.status;
  });
  open();
  const told = await page.evaluate(async () => {
    const probe = (window as Window & { bubbleProbe?: Probe }).bubbleProbe;
    if (!probe?.watch) return "nothing was watched";
    const loaded = await probe.loaded;
    await new Promise<void>((next) => requestAnimationFrame(() => requestAnimationFrame(() => next())));
    const writes = probe.writes + probe.watch.takeRecords().length;
    probe.watch.disconnect();
    return !loaded ? "the font did not load" : writes > 0 ? "" : "the font loaded and no bubble was fitted again";
  });
  await page.unroute("**/fonts/Inter.woff2?probe");
  return told && `${told}, fonts were ${status} at the fit before it`;
}

try {
  for (const theme of ["dark", "light"]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on("pageerror", (e) => fails.push(`page threw in ${theme}: ${e.message}`));
    await page.addInitScript(watchPaints);
    await page.goto(`http://127.0.0.1:${server.port}/?shot=own-bubbles&theme=${theme}`);
    await page.locator(".main article.msg.is-mine .msg-thread").waitFor();
    const early = await see(page);
    const fonts = await page.evaluate(() => document.fonts.status);
    console.log(
      `     ${theme}, as the conversation shows: ${early.mine.filter((b) => b.set).length} of ${early.mine.filter((b) => b.lines > 1).length} wrapped bubbles fitted, ${early.mine.filter((b) => b.plain).length} still plain text, fonts ${fonts}`,
    );
    await settle(page);
    await page.waitForTimeout(400);
    await checks(page, `${theme}, 1440 wide`);
    const refit = await fontRefit(page, 1100);
    expect(refit === "", `${theme}: bubbles fitted while a font was loading are fitted again when it arrives${refit && ` (${refit})`}`);
    for (const width of [1100, 700, 420]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(300);
      await checks(page, `${theme}, ${width} wide`);
    }
    const swept = await sweep(page);
    expect(
      swept.wrong.length === 0,
      `${theme}: narrowed and widened in ${swept.steps} small steps, every wrapped bubble stays as wide as its longest line, inside its room and no taller than unfitted${swept.wrong
        .slice(0, 6)
        .map((w) => `, ${w}`)
        .join("")}`,
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);
    await checks(page, `${theme}, back at 1440`);
    const painted = await page.evaluate(() => (window as Window & { bubblePaints?: Painted }).bubblePaints ?? null);
    const frames = `${painted?.frames ?? 0} frames read after paint, ${painted?.loose ?? 0} with a wrapped bubble wider than its longest line, ${painted?.longest ?? 0} in a row at most${painted?.worst ? ` (${painted.worst})` : ""}`;
    expect(painted !== null && painted.frames > 30 && painted.longest <= 1, `${theme}: from first load through every resize, no wrapped bubble of yours stays too wide on screen: ${frames}`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.stop(true);
}
if (fails.length) {
  console.error(`\n${fails.length} failed:\n${fails.map((f) => `  ${f}`).join("\n")}`);
  process.exit(1);
}
console.log(`\nyour own bubbles hold in ${engine}`);
