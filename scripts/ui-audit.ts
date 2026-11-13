import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright-core";
import { pageErrors } from "./page-errors.ts";

const SHOTS = [
  "channel",
  "dm",
  "thread-doc",
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
  "home",
];
const SIZES = ["1710x1074", "1280x800"];

if (process.argv.includes("--help")) {
  console.log(`What the blueprint overlay's audit finds in the built UI: each demo shot is opened with the overlay on (⌥⌘B in the
app), and its "bp: issue" notes are read back from the page, the same notes a tool reads from the accessibility tree of the
desktop window. An issue is a control under another one, a target under 24px, text cut short, something outside the window, an
edge 1 or 2px off its neighbours, a boxed control off the 8px grid, a lone edge near a common one, or anything that can scroll
sideways. Exits 1 when any shot has one.

  bun scripts/ui-audit.ts [--dist ui/dist] [--only channel,specs] [--size 1710x1074,1000x760] [--browser webkit|chromium] [--theme dark|light] [--json out.json]

Without --dist it builds ui/ into a temporary folder first. Shots: ${SHOTS.join(", ")}.
Sizes: ${SIZES.join(", ")} unless --size names others.`);
  process.exit(0);
}

const ROOT = resolve(import.meta.dir, "..");
const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const list = (name: string, all: string[]): string[] =>
  flag(name)
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? all;
const engine = flag("--browser") ?? "webkit";
if (engine !== "webkit" && engine !== "chromium") throw new Error(`--browser is webkit or chromium, not ${engine}`);
const theme = flag("--theme") ?? "dark";
const shots = list("--only", SHOTS);
const sizes = list("--size", SIZES).map((size) => {
  const [width, height] = size.split("x").map(Number);
  if (!width || !height) throw new Error(`--size is WIDTHxHEIGHT, not ${size}`);
  return { width, height };
});

const scratch = mkdtempSync(join(tmpdir(), "kiwi-ui-audit-"));
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

interface Found {
  shot: string;
  size: string;
  issues: string[];
  errors: string[];
}

const found: Found[] = [];
const browser = await (engine === "webkit" ? webkit : chromium).launch();
try {
  for (const { width, height } of sizes) {
    for (const shot of shots) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors: string[] = [];
      await pageErrors(page, (e) => errors.push(e));
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
      const issues = await page.evaluate(() => [...document.querySelectorAll(".bp-note")].map((note) => note.getAttribute("aria-label") ?? "").filter((label) => label.startsWith("bp: issue")));
      found.push({ shot, size: `${width}x${height}`, issues, errors });
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.stop(true);
  rmSync(scratch, { recursive: true, force: true });
}

const bad = found.filter((f) => f.issues.length || f.errors.length);
for (const f of bad) {
  console.log(`\n${f.shot} at ${f.size}`);
  for (const issue of f.issues) console.log(`  ${issue.replace("bp: issue ", "")}`);
  for (const error of f.errors) console.log(`  page error: ${error}`);
}
const out = flag("--json");
if (out) writeFileSync(out, `${JSON.stringify(found, null, 2)}\n`);
const count = bad.reduce((n, f) => n + f.issues.length + f.errors.length, 0);
console.log(
  `\n${count ? `${count} issue${count === 1 ? "" : "s"} in ${bad.length} of ${found.length} views` : `no issues in ${found.length} views (${shots.length} shots at ${sizes.length} size${sizes.length === 1 ? "" : "s"})`}`,
);
process.exit(count ? 1 : 0);
