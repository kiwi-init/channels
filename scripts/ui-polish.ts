import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright-core";

const SHOTS = [
  "channel",
  "dm",
  "thread-doc",
  "long-feed",
  "tabs-8",
  "task",
  "needs",
  "needs-panel",
  "specs",
  "spec-inside",
  "spec-result",
  "agents",
  "agent",
  "github",
  "github-pr",
  "settings",
  "settings-appearance",
  "settings-devices",
  "settings-agents",
  "invite",
];
const THEMES = ["dark", "light"];
const SIZE = { width: 1440, height: 900 };

if (process.argv.includes("--help")) {
  console.log(`How far the built UI is from its own standard, as one number per screen: each demo shot is opened in dark and light,
and every visible thing that isn't standard is counted once per kind and look (forty rows with one odd size are one).

  type     text whose size isn't one of the six steps (--t-stamp … --t-display)
  weight   text whose weight isn't 400, 500 or 600
  radius   a corner that isn't 0, a --r-* step, or a full round
  covered, small, cut, outside, near, height, stray, sideways
           what the blueprint overlay's audit finds (bun scripts/ui-audit.ts --help)

  bun scripts/ui-polish.ts [--dist ui/dist] [--only channel,specs] [--theme dark|light] [--browser webkit|chromium] [--list] [--json out.json]

--list prints each finding. Without --dist it builds ui/ into a temporary folder first. It always exits 0: the count is
the hill to climb down, not a gate.`);
  process.exit(0);
}

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const listOf = (name: string, all: string[]): string[] =>
  flag(name)
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? all;
const engine = flag("--browser") ?? "webkit";
if (engine !== "webkit" && engine !== "chromium") throw new Error(`--browser is webkit or chromium, not ${engine}`);
const shots = listOf("--only", SHOTS);
const themes = listOf("--theme", THEMES);
const listing = process.argv.includes("--list");

const ROOT = resolve(import.meta.dir, "..");
const scratch = mkdtempSync(join(tmpdir(), "kiwi-ui-polish-"));
let dist = flag("--dist") ? resolve(flag("--dist") ?? "") : "";
if (!dist) {
  dist = join(scratch, "dist");
  const built = spawnSync("bunx", ["vite", "build", "--outDir", dist, "--emptyOutDir", "--logLevel", "warn"], { cwd: join(ROOT, "ui"), stdio: "inherit" });
  if (built.status !== 0) throw new Error("vite build failed");
}
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}`);

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});

interface Finding {
  kind: string;
  text: string;
}

const offStandard = (): Finding[] => {
  const probe = (style: string): string => {
    const el = document.createElement("span");
    el.style.cssText = `position:absolute;visibility:hidden;${style}`;
    document.body.append(el);
    const cs = getComputedStyle(el);
    const value = style.startsWith("font-size") ? cs.fontSize : cs.borderTopLeftRadius;
    el.remove();
    return value;
  };
  const px = (value: string): number => Math.round(Number.parseFloat(value) * 100) / 100;
  const steps = new Set(["stamp", "meta", "ui", "body", "title", "display"].map((t) => px(probe(`font-size:var(--t-${t})`))));
  const radii = new Set([0, ...["tick", "tag", "row", "ctl", "card", "win"].map((r) => px(probe(`border-radius:var(--r-${r})`)))]);
  const name = (el: Element): string => {
    const cls = [...el.classList].filter((c) => !c.startsWith("is-")).slice(0, 2);
    return cls.length ? `${el.tagName.toLowerCase()}.${cls.join(".")}` : `${el.parentElement ? name(el.parentElement) : ""} > ${el.tagName.toLowerCase()}`;
  };
  const seen = new Map<string, Finding>();
  const add = (kind: string, text: string): void => {
    if (!seen.has(`${kind} ${text}`)) seen.set(`${kind} ${text}`, { kind, text });
  };
  const view = { w: innerWidth, h: innerHeight };
  for (const el of document.querySelectorAll<HTMLElement>("body *")) {
    if (el.closest(".bp, [aria-hidden='true'], svg")) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 1 || box.height < 1 || box.bottom < 0 || box.right < 0 || box.top > view.h || box.left > view.w) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== "visible" || Number(cs.opacity) === 0) continue;
    const words = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim());
    if (words) {
      const size = px(cs.fontSize);
      if (!steps.has(size)) add("type", `${name(el)} is ${size}px`);
      const weight = Number(cs.fontWeight);
      if (![400, 500, 600].includes(weight)) add("weight", `${name(el)} is ${weight}`);
    }
    const r = px(cs.borderTopLeftRadius);
    if (r && !radii.has(r) && r < Math.min(box.width, box.height) / 2 - 0.5) add("radius", `${name(el)} rounds ${r}px`);
  }
  for (const note of document.querySelectorAll(".bp-note")) {
    const label = note.getAttribute("aria-label") ?? "";
    const m = /^bp: issue (\w+): (.*?)(?: \(x [^)]*\))?$/.exec(label);
    if (m?.[1] && m[2]) add(m[1], m[2]);
  }
  return [...seen.values()];
};

interface View {
  shot: string;
  theme: string;
  findings: Finding[];
}

const views: View[] = [];
const browser = await (engine === "webkit" ? webkit : chromium).launch();
try {
  for (const theme of themes) {
    for (const shot of shots) {
      const page = await browser.newPage({ viewport: SIZE, reducedMotion: "reduce" });
      await page.addInitScript(() => {
        try {
          localStorage.setItem("kiwi:blueprint", "1");
        } catch {
          // No storage in this browser: the overlay stays off and the wait below says so.
        }
      });
      await page.goto(`http://127.0.0.1:${server.port}/?shot=${shot}&theme=${theme}`);
      await page.waitForSelector('.bp-note[aria-label^="bp: audit"]', { state: "attached", timeout: 15000 });
      await page.waitForTimeout(1200);
      views.push({ shot, theme, findings: await page.evaluate(offStandard) });
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.stop(true);
  rmSync(scratch, { recursive: true, force: true });
}

const kinds = [...new Set(views.flatMap((v) => v.findings.map((f) => f.kind)))].sort();
const pad = (s: string | number, n: number): string => String(s).padStart(n);
const width = Math.max(...shots.map((s) => s.length));
console.log(`${"screen".padEnd(width)} ${themes.map((t) => pad(t, 6)).join(" ")}   ${kinds.map((k) => pad(k, Math.max(k.length, 4))).join(" ")}`);
for (const shot of shots) {
  const mine = views.filter((v) => v.shot === shot);
  const per = (kind: string): number => mine.reduce((n, v) => n + v.findings.filter((f) => f.kind === kind).length, 0);
  console.log(
    `${shot.padEnd(width)} ${themes.map((t) => pad(mine.find((v) => v.theme === t)?.findings.length ?? 0, 6)).join(" ")}   ${kinds.map((k) => pad(per(k) || "·", Math.max(k.length, 4))).join(" ")}`,
  );
}
const total = views.reduce((n, v) => n + v.findings.length, 0);
console.log(`\npolish count: ${total} in ${views.length} views (${engine}, ${SIZE.width}x${SIZE.height})`);
if (listing)
  for (const v of views.filter((v) => v.findings.length)) {
    console.log(`\n${v.shot} ${v.theme}`);
    for (const f of v.findings) console.log(`  ${f.kind}: ${f.text}`);
  }
const out = flag("--json");
if (out) writeFileSync(out, `${JSON.stringify(views, null, 2)}\n`);
