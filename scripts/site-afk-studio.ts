import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, webkit } from "playwright-core";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const out = flag("--shots");
if (out) mkdirSync(out, { recursive: true });
const webkitOnly = process.argv.includes("--webkit");
const engine = webkitOnly ? webkit : chromium;
const tag = webkitOnly ? "webkit" : "chromium";
const root = join(import.meta.dir, "..");
const port = 4500 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;

const built = Bun.spawnSync(["bun", "scripts/docs-site.ts"], { cwd: root, stdout: "inherit", stderr: "inherit" });
if (built.exitCode !== 0) throw new Error("scripts/docs-site.ts failed");
const server = Bun.spawn(["bun", "scripts/docs-site.ts", "--serve", String(port)], { cwd: root, stdout: "pipe", stderr: "inherit" });
for (let i = 0; ; i++) {
  if (
    await fetch(`${base}/afk/`).then(
      (r) => r.ok,
      () => false,
    )
  )
    break;
  if (i > 100) throw new Error("the docs server never came up");
  await Bun.sleep(100);
}

const failures: string[] = [];
const check = (what: string, ok: boolean) => {
  if (!ok) failures.push(what);
  console.log(`${ok ? "✓" : "✗"} ${tag}: ${what}`);
};

const csp = async (path: string) => (await fetch(base + path)).headers.get("content-security-policy") ?? "";
for (const path of ["/afk/scene", "/afk/scene.html", "/afk/scenes/rain", "/afk/frame", "/afk/frame.html"]) {
  const policy = await csp(path);
  check(`${path} has its own CSP with no network`, policy.startsWith("default-src 'none'") && !policy.includes("connect-src") && policy.includes("frame-ancestors 'self'"));
}
check("/afk/ keeps the site's CSP", (await csp("/afk/")).includes("frame-ancestors 'none'"));

const PROBE = `<!doctype html><style>body{background:#123}</style><script>
const seen = { fetch: "?", img: "?", ws: "?", parent: "?", top: "?", state: null };
const report = () => parent.postMessage({ kiwi: "afk", type: "probe", seen }, "*");
addEventListener("message", (e) => { if (e.data && e.data.kiwi === "afk" && e.data.type === "state") { seen.state = e.data; report(); } });
fetch("https://example.com/x").then(() => (seen.fetch = "open"), () => (seen.fetch = "blocked"));
const i = new Image(); i.onload = () => (seen.img = "open"); i.onerror = () => (seen.img = "blocked"); i.src = "https://example.com/a.png";
try { const w = new WebSocket("wss://example.com/ws"); w.onopen = () => (seen.ws = "open"); w.onerror = () => (seen.ws = "blocked"); } catch { seen.ws = "blocked"; }
try { seen.parent = String(parent.document.title); } catch { seen.parent = "blocked"; }
try { seen.top = String(top.location.href); } catch { seen.top = "blocked"; }
requestAnimationFrame(() => parent.postMessage({ kiwi: "afk", type: "ready" }, "*"));
setInterval(report, 500);
</script>`;

const browser = await engine.launch();
try {
  for (const theme of ["dark", "light"] as const) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, colorScheme: theme });
    const offsite: string[] = [];
    const errors: string[] = [];
    page.on("requestfinished", (r) => {
      if (new URL(r.url()).hostname !== "127.0.0.1") offsite.push(r.url());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    const status = () => page.locator("#status").textContent();
    const waitStatus = (re: RegExp, timeout = 20_000) =>
      page
        .waitForFunction((s) => new RegExp(s).test(document.getElementById("status")?.textContent ?? ""), re.source, { timeout })
        .then(
          () => true,
          () => false,
        );

    await page.goto(`${base}/afk/`);
    check(`${theme}: the default scene says ready`, await waitStatus(/scene Channels ships.*Ready in/));
    check(`${theme}: the default scene shows`, (await page.locator("#stage").getAttribute("data-state")) === "ready");
    await page.waitForTimeout(1200);
    if (out) await page.screenshot({ path: join(out, `afk-studio-${tag}-${theme}.png`) });
    if (theme === "light") {
      await page.close();
      continue;
    }

    await page.evaluate(() => {
      (window as unknown as { probes: unknown[] }).probes = [];
      addEventListener("message", (e) => {
        if (e.data?.type === "probe") (window as unknown as { probes: unknown[] }).probes.push(e.data.seen);
      });
    });
    await page.fill("#paste", "```html\n" + PROBE + "\n```");
    check("a pasted scene says ready", await waitStatus(/Your scene\. Ready in/));
    check("the fence around it comes off", ((await page.locator("#notes").textContent()) ?? "").includes("fence"));
    check("Download gives the pasted file", ((await page.locator("#download").getAttribute("href")) ?? "").startsWith("blob:"));
    await page.locator("#needs").check();
    await page.locator("#time").fill("1320");
    await page.waitForTimeout(1500);
    type Seen = { fetch: string; img: string; ws: string; parent: string; top: string; state: { at: number; needs: number; still: boolean } | null };
    const last = (await page.evaluate(() => (window as unknown as { probes: unknown[] }).probes.at(-1))) as Seen | undefined;
    check("the scene can't fetch", last?.fetch === "blocked");
    check("the scene can't load a remote image", last?.img === "blocked");
    check("the scene can't open a WebSocket", last?.ws === "blocked");
    check("the scene can't read the page around it", last?.parent === "blocked" && last?.top === "blocked");
    check("the scene hears Needs you", last?.state?.needs === 1);
    check("the scene hears the time", last ? new Date(last.state?.at ?? 0).getHours() === 22 : false);

    await page.fill("#paste", '<!doctype html><script type="module">parent.postMessage({ kiwi: "afk", type: "ready" }, "*")</script>');
    await page.waitForTimeout(600);
    const notes = (await page.locator("#notes").textContent()) ?? "";
    check("a module script is called out", notes.includes('type="module"') && notes.includes("no inline script"));

    await page.fill("#paste", "<!doctype html><script>document.body.style.background = 'red'</script>");
    check("a scene that never says ready falls back to the plain sky", await waitStatus(/plain sky/, 12_000));
    check("the plain sky shows", (await page.locator("#stage").getAttribute("data-state")) === "plain" && (await page.locator("#sky").isVisible()));
    if (out) await page.screenshot({ path: join(out, `afk-studio-${tag}-plain.png`) });

    await page.fill("#paste", "");
    check("clearing the box brings the default back", await waitStatus(/scene Channels ships.*Ready in/));
    check("Download gives the default again", (await page.locator("#download").getAttribute("href")) === "/afk/scene");

    await page.fill("#describe", "a lighthouse in fog");
    check("the prompt carries the description", ((await page.locator("#prompt").textContent()) ?? "").includes("The scene I'd like: a lighthouse in fog"));
    check("the meadow, built from the app's code, gets the blank-page prompt", ((await page.locator("#base").textContent()) ?? "").includes("blank page"));

    await page.click('.pick[data-name="Rain on glass"]');
    check("a gallery scene plays when picked", await waitStatus(/^Rain on glass\. Ready in/));
    check("the picked scene is the checked one", (await page.locator('.pick[aria-checked="true"]').getAttribute("data-name")) === "Rain on glass");
    check("Download gives the picked scene", ((await page.locator("#download").getAttribute("href")) ?? "").startsWith("blob:"));
    const remix = (await page.locator("#prompt").textContent()) ?? "";
    check(
      "the prompt now starts from the picked scene",
      remix.includes("What I'd like: a lighthouse in fog") && remix.includes('Start from the finished scene at the end of this message, "Rain on glass"') && remix.includes("(Rain on glass,"),
    );
    check("and says so under the button", ((await page.locator("#base").textContent()) ?? "").includes("starts from Rain on glass"));
    await page.click('.pick[data-name="Meadow"]');
    check("picking the meadow again plays it", await waitStatus(/scene Channels ships.*Ready in/));
    if (out) await page.screenshot({ path: join(out, `afk-studio-${tag}-page.png`), fullPage: true });

    check("nothing left the site", offsite.length === 0);
    check("no page errors", errors.length === 0);
    if (errors.length) console.log(errors.join("\n"));
    console.log(`  last status: ${await status()}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}

if (failures.length) {
  console.error(`${failures.length} failed`);
  process.exit(1);
}
