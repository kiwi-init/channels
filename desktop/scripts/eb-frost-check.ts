import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalRelay } from "../../scripts/local-relay.ts";
import { TEST_ID } from "./eb-bundle.ts";
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
const frostSetting = (on: boolean) => spawnSync("defaults", on ? ["write", TEST_ID, "ChannelsFrost", "-bool", "YES"] : ["delete", TEST_ID, "ChannelsFrost"], { stdio: "ignore" });

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
const pageTheme = (d: Driver, appearance: string) => d.evaluate((a: string) => (window as unknown as { kiwi: { setAppearance(a: string): Promise<void> } }).kiwi.setAppearance(a), appearance);

try {
  frostSetting(false);
  await run(async (d) => {
    await new Promise((r) => setTimeout(r, 1_000));
    const look = await d.main("looks");
    if (look !== "") problems.push(`with the frost off the window still changed: "${String(look)}"`);
    if (await frostMark(d)) problems.push("with the frost off the page is marked data-frost");
  });
  console.log("frost off: the window and the page are as they were");

  frostSetting(true);
  await run(async (d) => {
    await looks(d, "frost clear system");
    if (!(await frostMark(d))) problems.push("with the frost on the page isn't marked data-frost");
    for (const appearance of ["dark", "light", "system"]) {
      await pageTheme(d, appearance);
      await looks(d, `frost clear ${appearance}`);
    }
    await d.evaluate(() => localStorage.setItem("mc.appearance", "dark"), null);
  });
  console.log("frost on: the sidebar material behind a clear page, following the page's dark, light and system");

  await run((d) => looks(d, "frost clear dark"));
  console.log("a restart with the page set to dark opens the window dark");
} catch (e) {
  problems.push(e instanceof Error ? e.message : String(e));
} finally {
  frostSetting(false);
  relay.kill();
  rmSync(root, { recursive: true, force: true });
}
if (problems.length) {
  for (const p of problems) console.error(`FAIL ${p}`);
  process.exit(1);
}
console.log("ok: the frost is off by default, and on, it follows the page's theme");
