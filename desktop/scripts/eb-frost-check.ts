import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalRelay } from "../../scripts/local-relay.ts";
import { appExecutable, attach, launch, stop, testEnv, until, type Driver } from "./eb-drive.ts";

if (!process.argv[2] || process.platform !== "darwin") {
  console.error("usage (on a Mac): bun desktop/scripts/eb-frost-check.ts <Channels.app built with CHANNELS_EB_TEST=1>");
  process.exit(2);
}
const exe = appExecutable(process.argv[2]);
const root = mkdtempSync(join(tmpdir(), "kiwi-frost-check-"));
const { relay, port } = await startLocalRelay(join(root, "relay"), null, { rateLimits: false });
const env = testEnv(root, join(root, "driver.sock"), `http://127.0.0.1:${port}`);
const problems: string[] = [];

async function run<T>(what: (d: Driver) => Promise<T>): Promise<T> {
  const app = launch(exe, env);
  try {
    const d = await attach(join(root, "driver.sock"));
    try {
      await until("the window on screen", 60_000, async () => ((await d.main("window")) as { visible?: unknown }).visible === true || null);
      await until("the page", 60_000, () => d.evaluate(() => (document.querySelector("#root")?.childElementCount ? true : null), null, 2_000));
      return await what(d);
    } finally {
      d.close();
    }
  } finally {
    await stop(app);
  }
}

const looks = async (d: Driver, want: string): Promise<void> => {
  try {
    await until(`the window's look ${want}`, 10_000, async () => ((await d.main("looks")) === want ? true : null));
  } catch {
    problems.push(`the window's look is "${String(await d.main("looks"))}", not "${want}"`);
  }
};
const frostMark = (d: Driver) => d.evaluate(() => "frost" in document.documentElement.dataset, null);
const shellPaint = (d: Driver) => d.evaluate(() => getComputedStyle(document.body).backgroundColor, null);
const marked = async (d: Driver, want: boolean, why: string): Promise<void> => {
  try {
    await until(why, 10_000, async () => ((await frostMark(d)) === want ? true : null));
  } catch {
    problems.push(want ? "the page isn't marked data-frost" : "the page is still marked data-frost");
  }
};
const pageTheme = (d: Driver, appearance: string) => d.evaluate((a: string) => (window as unknown as { kiwi: { setAppearance(a: string): Promise<void> } }).kiwi.setAppearance(a), appearance);

try {
  const asked = async (d: Driver) => ((await d.main("frostAllowed")) === true ? "frost" : "solid");
  await run(async (d) => {
    const system = await asked(d);
    console.log(`this Mac's accessibility display options ask for: ${system}`);
    await looks(d, `${system} clear system`);
    await marked(d, system === "frost", "the page marked as the system asks");
    await d.main("frostForTest");
    await looks(d, "frost clear system");
    await marked(d, true, "the page marked data-frost");
    for (const appearance of ["dark", "light", "system"]) {
      await pageTheme(d, appearance);
      await looks(d, `frost clear ${appearance}`);
    }
    await pageTheme(d, "dark");
    await d.main("solidForTest");
    await looks(d, "solid clear dark");
    await marked(d, false, "the page unmarked under Reduce Transparency");
    const solid = await shellPaint(d);
    if (solid !== "rgb(0, 0, 0)") problems.push(`under Reduce Transparency the shell paints ${solid}, not the solid rail rgb(0, 0, 0)`);
    await d.main("frostForTest");
    await looks(d, "frost clear dark");
    await marked(d, true, "the page marked data-frost again");
    await d.evaluate(() => localStorage.setItem("mc.appearance", "dark"), null);
  });
  console.log("the sidebar material behind a clear page, following the page's dark, light and system; solid under Reduce Transparency or Increase Contrast, and back");

  await run(async (d) => looks(d, `${await asked(d)} clear dark`));
  console.log("a restart with the page set to dark opens the window dark");
} catch (e) {
  problems.push(e instanceof Error ? e.message : String(e));
} finally {
  relay.kill();
  rmSync(root, { recursive: true, force: true });
}
if (problems.length) {
  for (const p of problems) console.error(`FAIL ${p}`);
  process.exit(1);
}
console.log("ok: the frost is behind the page and follows the page's theme");
