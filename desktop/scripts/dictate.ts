import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";

const exe = process.argv[2] ? resolve(process.argv[2]) : "";
const files = process.argv[3] ? resolve(process.argv[3]) : "";
if (!exe || !existsSync(exe) || !files || !existsSync(files)) {
  console.error("usage: bun desktop/scripts/dictate.ts <packaged app executable> <dictation files, from bun scripts/dictation-files.ts>");
  process.exit(2);
}

const ROOT = resolve(import.meta.dir, "../..");
const FIXTURE = join(import.meta.dir, "fixtures", "dictate.wav");
const HEARD = ["dictation", "test"];
const MIC = { start: "Dictate", confirm: "Download and dictate", stop: "Stop dictation" };
const MODEL_MS = 8 * 60_000;
const PORT = 20000 + Math.floor(Math.random() * 20000);
const RELAY = `http://127.0.0.1:${PORT}`;

const root = mkdtempSync(join(tmpdir(), "kiwi-dictate-"));
const config = join(root, ".config");
const cache = join(root, ".cache");
const userData = join(config, "kiwi-desktop");
mkdirSync(userData, { recursive: true });
mkdirSync(cache, { recursive: true });
const relayData = join(root, "relay");
cpSync(files, join(relayData, "dictation"), { recursive: true });
writeFileSync(join(userData, "kiwi-store.bin"), JSON.stringify({ relayUrl: RELAY, person: null, channels: [], computers: [], pending: [] }));

const relay = spawn(process.execPath, [join(ROOT, "src/relay/bun.ts"), "--port", String(PORT), "--hostname", "127.0.0.1", "--data", relayData, "--no-web", "--dev-sign-in"], {
  stdio: ["ignore", "pipe", "pipe"],
});
await new Promise<void>((ok, fail) => {
  const timer = setTimeout(() => fail(new Error("the relay didn't start in 20s")), 20_000);
  const seen = (b: Buffer) => b.toString("utf8").includes("listening") && (clearTimeout(timer), ok());
  relay.stdout.on("data", seen);
  relay.stderr.on("data", seen);
  relay.on("exit", (code) => fail(new Error(`relay exited (${code})`)));
});

const sizeOf = (dir: string): number => {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? sizeOf(join(dir, e.name)) : e.isFile() ? statSync(join(dir, e.name)).size : 0), 0);
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
  { env, stdio: ["ignore", "inherit", "inherit"] },
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
try {
  at = "the app's window (over Chromium's remote debugging, which the fuses allow)";
  const { page } = await attach();
  shotOf = page;
  page.setDefaultTimeout(30_000);
  at = "first run";
  await page.getByRole("textbox").first().fill("dictate");
  await page.getByRole("button", { name: "Continue" }).click();
  at = "create a channel";
  await page.getByRole("complementary").getByRole("button", { name: "New channel", exact: true }).click();
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
  at = "the model lives in the app's data folder";
  const kept = sizeOf(userData);
  const stray = sizeOf(cache);
  if (stray > 1_000_000) throw new Error(`${Math.round(stray / 1e6)} MB landed in XDG_CACHE_HOME (${cache}), outside the app's data folder`);
  if (kept < 20_000_000) throw new Error(`the app's data folder holds only ${Math.round(kept / 1e6)} MB: the model isn't kept there`);
  if (kept > 180_000_000) throw new Error(`the app's data folder holds ${Math.round(kept / 1e6)} MB: the model is kept twice (Chromium's HTTP cache as well as the app's own)`);
  console.log(`dictation ok: heard ${JSON.stringify(said)}; ${Math.round(kept / 1e6)} MB in ${userData}, ${Math.round(stray / 1e3)} kB in XDG_CACHE_HOME`);
} catch (err) {
  const shot = join(tmpdir(), "kiwi-dictate-failure.png");
  await shotOf?.screenshot({ path: shot }).catch(() => undefined);
  console.error(`dictation failed at "${at}": ${err instanceof Error ? err.message : String(err)} (screenshot: ${shot})`);
  process.exitCode = 1;
} finally {
  app.kill();
  relay.kill();
  rmSync(root, { recursive: true, force: true });
}
