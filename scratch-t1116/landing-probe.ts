import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = process.env.REPO;
if (!REPO) throw new Error("REPO=<worktree> is required");
const flag = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const DIST = resolve(REPO, flag("dist") ?? "ui/dist-harness");
const RUNS = Number(flag("runs") ?? 5);
const WITH_FILE = process.argv.includes("--file");
const SMALL = process.argv.includes("--small");

const { webkit } = (await import(Bun.resolveSync("playwright-core", REPO))) as typeof import("playwright-core");
const { startLocalRelay } = (await import(`${REPO}/scripts/local-relay.ts`)) as { startLocalRelay: (dir: string, dist: string, o: { rateLimits: boolean }) => Promise<{ relay: { kill(): void }; port: number }> };
const ui = (await import(`${REPO}/scripts/perf-ui.ts`)) as {
  composer: (page: import("playwright-core").Page) => import("playwright-core").Locator;
  firstRun: (page: import("playwright-core").Page, name: string) => Promise<void>;
  newChannel: (page: import("playwright-core").Page, title: string) => Promise<string>;
  SEND: string;
};

const data = mkdtempSync(join(tmpdir(), "kiwi-landing-probe-"));
mkdirSync(join(data, "relay"));
mkdirSync(join(data, "home"));
process.env.KIWI_HOME = join(data, "home");
void spawn;
void chmodSync;
void writeFileSync;

const { relay, port } = await startLocalRelay(join(data, "relay"), DIST, { rateLimits: false });
const browser = await webkit.launch();

interface Frame {
  t: number;
  present: number;
  imgs: number;
  spots: number;
  top: number;
  height: number;
  kind: string;
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await page.goto(`http://127.0.0.1:${port}/`);
  await ui.firstRun(page, "jow");
  await ui.newChannel(page, "probe");
  for (let i = 0; i < 6; i++) {
    await ui.composer(page).click();
    await page.keyboard.type(`filler line ${i}`);
    await page.keyboard.press(ui.SEND);
    await page.waitForTimeout(700);
  }
  const rows: string[] = [];
  for (let run = 0; run < RUNS; run++) {
    const words = `probe line ${run}`;
    await ui.composer(page).click();
    await page.evaluate(async ([file, small]) => {
      const canvas = document.createElement("canvas");
      canvas.width = small ? 64 : 640;
      canvas.height = small ? 48 : 420;
      const g = canvas.getContext("2d");
      if (!g) throw new Error("no 2d context");
      g.fillStyle = "#3a7";
      g.fillRect(0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
      if (!blob) throw new Error("no png");
      const dt = new DataTransfer();
      dt.items.add(new File([blob], file, { type: "image/png" }));
      document.activeElement?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, [`probe-${run}.png`, SMALL] as const);
    await page.locator(".main .composer .compose-file").first().waitFor({ timeout: 10000 });
    if (WITH_FILE) {
      await page
        .locator(".main .composer input[type=file]")
        .setInputFiles({ name: `notes-${run}.pdf`, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n") });
      await page.locator(".main .composer .compose-file", { hasText: `notes-${run}.pdf` }).waitFor({ timeout: 10000 });
    }
    await page.keyboard.type(words);
    await page.evaluate((want) => {
      const frames: Frame[] = [];
      const t0 = performance.now();
      (window as unknown as { probe: Frame[] }).probe = frames;
      const tick = (): void => {
        const pane = document.querySelector(".main");
        let found: Element | null = null;
        if (pane) {
          const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const el = n.parentElement;
            if (!n.textContent?.includes(want) || !el || !el.getClientRects().length || el.closest(".composer")) continue;
            found = el.closest("article.msg, section.blk, [data-seq]") ?? el;
            break;
          }
        }
        if (found) {
          const box = found.getBoundingClientRect();
          const shown = [...found.querySelectorAll("img")].filter((i) => i.getClientRects().length && i.complete && i.naturalWidth > 0).length;
          frames.push({
            t: Math.round(performance.now() - t0),
            present: found.querySelectorAll("img").length,
            imgs: shown,
            spots: found.querySelectorAll(".msg-image-spot, [class*=spot]").length,
            top: Math.round(box.top),
            height: Math.round(box.height),
            kind: found.tagName.toLowerCase() + (found.className && typeof found.className === "string" ? `.${found.className.split(/\s+/)[0]}` : ""),
          });
        }
        if (performance.now() - t0 < 6000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, words);
    await page.keyboard.press(ui.SEND);
    await page.waitForTimeout(6300);
    const frames = await page.evaluate(() => (window as unknown as { probe: Frame[] }).probe);
    const states: string[] = [];
    let last = "";
    for (const f of frames) {
      const s = `${f.kind} present=${f.present} imgs=${f.imgs} spots=${f.spots} h=${f.height}`;
      if (s !== last) states.push(`${f.t}ms ${s}`);
      last = s;
    }
    const firstShown = frames.findIndex((f) => f.imgs > 0);
    const after = firstShown < 0 ? [] : frames.slice(firstShown);
    const blink = after.filter((f) => f.imgs === 0).length;
    const heights = after.map((f) => f.height);
    const swing = heights.length ? Math.max(...heights) - Math.min(...heights) : -1;
    rows.push(`run ${run}: ${frames.length} frames, first picture at ${firstShown < 0 ? "never" : `${frames[firstShown]!.t} ms`}, frames without the picture after it first showed: ${blink}, row height swing after that: ${swing} px`);
    console.log(rows.at(-1));
    console.log(`  ${states.join("\n  ")}`);
  }
  console.log(`\nsummary (${DIST.split("/").slice(-1)[0]}):\n${rows.join("\n")}`);
} finally {
  await browser.close();
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
