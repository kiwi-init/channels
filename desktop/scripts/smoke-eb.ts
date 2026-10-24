import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalRelay } from "../../scripts/local-relay.ts";
import { daemonHello, daemonStop } from "../src/daemon-client.ts";
import { bridgeChecks } from "./eb-bridge-checks.ts";
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
const pids = (pattern: string): number[] => spawnSync("pgrep", ["-f", pattern], { encoding: "utf8" }).stdout.split("\n").filter(Boolean).map(Number);
const alive = (): number[] => [...pids(bundle), ...pids(root)];
const webContent = (): number[] => pids("com.apple.WebKit.WebContent");
const kiwiHome = join(root, ".kiwi");

function found(dir: string, name: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? found(p, name) : n === name ? [p] : [];
  });
}

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
const before = new Set(webContent());
const app = launch(exe, testEnv(root, join(root, "driver.sock"), RELAY));
try {
  const d = await attach(join(root, "driver.sock"));
  const page = await until("the dashboard's first screen", 60_000, () =>
    d.evaluate(() => (document.querySelector("#root")?.childElementCount ? { href: location.href, title: document.title } : null), null, 2_000),
  );
  if (page.href.startsWith("views://internal/index.html")) console.log(`page: ${page.href} (${page.title})`);
  else problems.push(`the window shows ${page.href}, not views://internal/index.html`);
  const paint = await until("the page's first paint", 15_000, () => d.evaluate(() => performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null, null, 2_000)).catch(
    (e: Error) => (problems.push(e.message), null),
  );
  if (paint !== null) console.log(`first paint: ${paint}`);
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
  await bridgeChecks(d, problems);
  for (const to of ["views://internal/icon.svg", "views://internal/index.html?x=1", "file:///etc/hosts"]) {
    await d.evaluate((url: string) => void (location.href = url), to, 2_000).catch(() => undefined);
    await later(1_000);
    await check(
      `a navigation to ${to} is refused (the rules, the native allowlist and the canary that proved them): the page stays and window.kiwi answers`,
      d,
      () =>
        Promise.race([
          (window as unknown as { kiwi: { getUpdate(): Promise<unknown> } }).kiwi.getUpdate().then(() => location.href),
          new Promise<string>((r) => setTimeout(() => r(`${location.href} (window.kiwi didn't answer)`), 3_000)),
        ]),
      (v) => v === "views://internal/index.html",
    );
  }

  const hello = await until("the kiwi daemon the app starts", 60_000, () => daemonHello(kiwiHome, 1_000)).catch((e: Error) => (problems.push(e.message), null));
  if (hello) console.log(`kiwi daemon: answering on the test KIWI_HOME (kiwi ${hello.version})`);
  const cli = join(root, "home", ".kiwi", "bin", "kiwi");
  const version = existsSync(cli) ? spawnSync(cli, ["--version"], { encoding: "utf8", env: { ...process.env, KIWI_HOME: kiwiHome } }).stdout.trim() : "";
  if (version) console.log(`kiwi CLI: installed in the test HOME's .kiwi/bin (${version})`);
  else problems.push(`the app didn't install the kiwi CLI at ${cli}`);

  const ours = webContent().filter((p) => !before.has(p));
  if (!ours.length) problems.push("found no web content process of the app's own to stop");
  else {
    const origin = await d.evaluate(() => performance.timeOrigin, null);
    for (const pid of ours) process.kill(pid, "SIGKILL");
    const back = await until("the page, back after its web content process was killed", 30_000, () =>
      d.evaluate(() => (document.querySelector("#root")?.childElementCount ? performance.timeOrigin : null), null, 2_000).then((o) => (o !== null && o !== origin ? o : null)),
    ).catch((e: Error) => (problems.push(e.message), null));
    const logs = found(join(root, "home", "Library", "Logs"), "main.log");
    const logged = logs.some((f) => readFileSync(f, "utf8").includes("the window's page stopped"));
    if (back && logged) console.log(`the app's ${ours.length} web content processes killed: the page reloaded and main.log says so (${logs[0]!.slice(root.length)})`);
    else if (back) problems.push(`the page reloaded but no main.log under the test HOME's Library/Logs says it stopped (found ${logs.length})`);
  }
  d.close();
} catch (e) {
  problems.push(e instanceof Error ? e.message : String(e));
} finally {
  await stop(app);
  await daemonStop(kiwiHome, 2_000).catch(() => false);
  relay.kill();
  await later(1_000);
  const left = alive();
  if (left.length) problems.push(`still running after the smoke test: ${left.join(", ")}`);
  for (const pid of left) process.kill(pid, "SIGKILL");
  rmSync(root, { recursive: true, force: true });
}

for (const p of problems) console.error(`smoke-eb: ${p}`);
process.exit(problems.length ? 1 : 0);
