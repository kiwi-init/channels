import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { startLocalRelay } from "../../scripts/local-relay.ts";
import { daemonStop } from "../src/daemon-client.ts";

const exe = process.argv[2] ? resolve(process.argv[2]) : "";
const files = process.argv[3] ? resolve(process.argv[3]) : "";
if (!exe || !existsSync(exe) || !files || !existsSync(files)) {
  console.error("usage: bun desktop/scripts/dictate.ts <packaged app executable> <dictation files, from bun scripts/dictation-files.ts>");
  process.exit(2);
}

const FIXTURE = join(import.meta.dir, "fixtures", "dictate.wav");
const HEARD = ["dictation", "test"];
const MIC = { start: "Dictate", confirm: "Download and dictate", stop: "Stop dictation" };
const MODEL_MS = 8 * 60_000;

const root = mkdtempSync(join(tmpdir(), "kiwi-dictate-"));
const config = join(root, ".config");
const cache = join(root, ".cache");
const userData = join(config, "kiwi-desktop");
mkdirSync(userData, { recursive: true });
mkdirSync(cache, { recursive: true });
const relayData = join(root, "relay");
cpSync(files, join(relayData, "dictation"), { recursive: true });
let relayTimer: ReturnType<typeof setTimeout> | undefined;
const { relay, port } = await Promise.race([
  startLocalRelay(relayData, null),
  new Promise<never>((_, fail) => (relayTimer = setTimeout(() => fail(new Error("the relay didn't start in 20s")), 20_000))),
]).finally(() => clearTimeout(relayTimer));
const RELAY = `http://127.0.0.1:${port}`;
writeFileSync(join(userData, "kiwi-store.bin"), JSON.stringify({ relayUrl: RELAY, person: null, channels: [], computers: [], pending: [] }));

const sizeOf = (dir: string): number => {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? sizeOf(join(dir, e.name)) : e.isFile() ? statSync(join(dir, e.name)).size : 0), 0);
};

const largest = (dir: string): string => {
  const rows: [string, number][] = [];
  const walk = (d: string, depth: number) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const sub = join(d, e.name);
      rows.push([sub.slice(dir.length + 1), sizeOf(sub)]);
      if (depth < 3) walk(sub, depth + 1);
    }
  };
  walk(dir, 0);
  return rows
    .filter(([, n]) => n > 5_000_000)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 8)
    .map(([p, n]) => `${p} ${Math.round(n / 1e6)} MB`)
    .join("; ");
};

const env: Record<string, string> = {
  ...(process.env as Record<string, string>),
  HOME: root,
  XDG_CONFIG_HOME: config,
  XDG_CACHE_HOME: cache,
  XDG_DATA_HOME: join(root, ".local", "share"),
  KIWI_HOME: join(root, ".kiwi"),
};
delete env["ELECTRON_RUN_AS_NODE"];
delete env["NODE_OPTIONS"];

const DEBUG_PORT = 40000 + Math.floor(Math.random() * 20000);
const app: ChildProcess = spawn(
  exe,
  [...(process.platform === "linux" ? ["--no-sandbox"] : []), `--remote-debugging-port=${DEBUG_PORT}`, "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${FIXTURE}`],
  { env, stdio: ["ignore", "inherit", "inherit"], detached: true },
);

async function attach(): Promise<{ browser: Browser; page: Page }> {
  const end = Date.now() + 60_000;
  for (;;) {
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
      for (let i = 0; i < 60; i++) {
        const page = browser
          .contexts()
          .flatMap((c) => c.pages())
          .find((p) => p.url().startsWith("kiwi-app://"));
        if (page) return { browser, page };
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error("the app's window never opened");
    } catch (err) {
      if (Date.now() > end) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

let at = "start";
let shotOf: Page | null = null;
let cdp: Browser | null = null;
try {
  at = "the app's window (over Chromium's remote debugging, which the fuses allow)";
  const { browser, page } = await attach();
  cdp = browser;
  shotOf = page;
  page.setDefaultTimeout(30_000);
  at = "first run";
  await page.getByRole("textbox").first().fill("dictate");
  await page.getByRole("button", { name: "Continue" }).click();
  at = "create a channel";
  await page.getByRole("banner", { name: "Channels" }).or(page.getByRole("complementary")).getByRole("button", { name: "New channel", exact: true }).filter({ visible: true }).first().click();
  await page.getByRole("dialog").getByRole("textbox").fill("dictate");
  await page.getByRole("button", { name: "Create channel" }).click();
  await page.getByRole("complementary", { name: "Channel" }).getByRole("region", { name: "Conversations" }).getByRole("button").first().click();
  const box = page.getByRole("textbox", { name: "Message" });
  await box.waitFor();
  at = "start dictating (the mic's permission comes from the app's own handler)";
  await page.getByRole("button", { name: MIC.start, exact: true }).click();
  at = "the one-time notice before the model downloads";
  await page.getByRole("button", { name: MIC.confirm, exact: true }).click();
  at = "the model downloads and dictation listens";
  await page.getByRole("button", { name: MIC.stop, exact: true }).waitFor({ timeout: MODEL_MS });
  await page.waitForTimeout(5_000);
  at = "stop, and the words land in the box";
  await page.getByRole("button", { name: MIC.stop, exact: true }).click();
  const end = Date.now() + 120_000;
  let said = "";
  while (Date.now() < end) {
    said = (await box.inputValue()).toLowerCase();
    if (HEARD.every((w) => said.includes(w))) break;
    await page.waitForTimeout(500);
  }
  if (!HEARD.every((w) => said.includes(w))) throw new Error(`the box says ${JSON.stringify(said)}, without ${HEARD.join(" and ")}`);
  at = "the model lives in the app's data folder, once";
  const model = sizeOf(join(userData, "Service Worker", "CacheStorage"));
  const http = sizeOf(join(userData, "Cache"));
  const stray = sizeOf(cache);
  if (stray > 20_000_000) throw new Error(`${Math.round(stray / 1e6)} MB landed in XDG_CACHE_HOME (${cache}: ${readdirSync(cache).join(", ")}), outside the app's data folder`);
  if (model < 90_000_000 || model > 130_000_000) throw new Error(`the app's Cache Storage holds ${Math.round(model / 1e6)} MB, not one copy of the ~107 MB model (${largest(userData)})`);
  if (http > 20_000_000) throw new Error(`Chromium's HTTP cache holds ${Math.round(http / 1e6)} MB: the model is kept twice (${largest(userData)})`);
  console.log(
    `dictation ok: heard ${JSON.stringify(said)}; the model ${Math.round(model / 1e6)} MB in ${join(userData, "Service Worker", "CacheStorage")}, HTTP cache ${Math.round(http / 1e6)} MB, ${Math.round(stray / 1e3)} kB in XDG_CACHE_HOME`,
  );
} catch (err) {
  const shot = join(tmpdir(), "kiwi-dictate-failure.png");
  await shotOf?.screenshot({ path: shot }).catch(() => undefined);
  console.error(`dictation failed at "${at}": ${err instanceof Error ? err.message : String(err)} (screenshot: ${shot})`);
  process.exitCode = 1;
} finally {
  const cleanup = Date.now();
  try {
    if (app.pid !== undefined) process.kill(-app.pid, "SIGKILL");
  } catch {
    // The group is already gone, or never formed: kill the main process alone.
    app.kill("SIGKILL");
  }
  await cdp?.close().catch(() => undefined);
  await daemonStop(env.KIWI_HOME!, 2_000).catch(() => undefined);
  relay.kill("SIGKILL");
  console.log(`dictate: cleaned up in ${Date.now() - cleanup} ms`);
  rmSync(root, { recursive: true, force: true });
}
process.exit(process.exitCode ?? 0);
