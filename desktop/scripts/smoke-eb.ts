import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalRelay } from "../../scripts/local-relay.ts";
import { appExecutable, attach, launch, stop, testEnv, until, type Driver } from "./eb-drive.ts";

if (!process.argv[2]) {
  console.error("usage: bun desktop/scripts/smoke-eb.ts <Channels.app built with CHANNELS_EB_TEST=1>");
  process.exit(2);
}
const exe = appExecutable(process.argv[2]);
const bundle = exe.includes(".app/") ? exe.slice(0, exe.indexOf(".app/") + 4) : exe;
const root = mkdtempSync(join(tmpdir(), "kiwi-smoke-eb-"));
const problems: string[] = [];
const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const alive = (): number[] => spawnSync("pgrep", ["-f", bundle], { encoding: "utf8" }).stdout.split("\n").filter(Boolean).map(Number);

async function check<T>(what: string, d: Driver, fn: () => T | Promise<T>, ok: (v: T) => boolean): Promise<void> {
  try {
    const v = await d.evaluate(fn, null);
    if (ok(v)) console.log(`${what}: ${JSON.stringify(v)}`);
    else problems.push(`${what}: ${JSON.stringify(v)}`);
  } catch (e) {
    problems.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const { relay, port } = await startLocalRelay(join(root, "relay"), null, { rateLimits: false });
const RELAY = `http://127.0.0.1:${port}`;
const app = launch(exe, testEnv(root, join(root, "driver.sock"), RELAY));
try {
  const d = await attach(join(root, "driver.sock"));
  const page = await until("the dashboard's first screen", 60_000, () =>
    d.evaluate(() => (document.querySelector("#root")?.childElementCount ? { href: location.href, title: document.title } : null), null, 2_000),
  );
  if (page.href.startsWith("views://internal/index.html")) console.log(`page: ${page.href} (${page.title})`);
  else problems.push(`the window shows ${page.href}, not views://internal/index.html`);
  await check(
    "first paint",
    d,
    () => performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
    (v) => typeof v === "number",
  );
  await check(
    "the relay it was given reaches the page through the store (window.kiwi.relayUrl) and answers through the CSP",
    d,
    () =>
      fetch(`${(window as unknown as { kiwi: { relayUrl: string } }).kiwi.relayUrl}/v1/config`).then(
        (r) => r.status,
        (e: unknown) => String(e),
      ),
    (v) => v === 200,
  );
  await check(
    "an inline script (CSP script-src 'self')",
    d,
    () => {
      const w = window as unknown as { kiwiInlineRan?: boolean };
      const s = document.createElement("script");
      s.textContent = "window.kiwiInlineRan = true";
      document.head.append(s);
      s.remove();
      return w.kiwiInlineRan ? "ran" : "refused";
    },
    (v) => v === "refused",
  );
  await check(
    "a fetch to another origin (CSP connect-src)",
    d,
    () =>
      fetch("https://example.com/").then(
        () => "reached",
        () => "refused",
      ),
    (v) => v === "refused",
  );
  await check(
    "the microphone",
    d,
    () =>
      navigator.mediaDevices?.getUserMedia
        ? navigator.mediaDevices.getUserMedia({ audio: true }).then(
            () => "granted",
            (e: unknown) => `denied (${e instanceof Error ? e.name : String(e)})`,
          )
        : "not exposed",
    (v) => v !== "granted",
  );
  d.close();
} catch (e) {
  problems.push(e instanceof Error ? e.message : String(e));
} finally {
  await stop(app);
  relay.kill();
  await later(1_000);
  const left = alive();
  if (left.length) problems.push(`still running after the smoke test: ${left.join(", ")}`);
  for (const pid of left) process.kill(pid, "SIGKILL");
  rmSync(root, { recursive: true, force: true });
}

for (const p of problems) console.error(`smoke-eb: ${p}`);
process.exit(problems.length ? 1 : 0);
