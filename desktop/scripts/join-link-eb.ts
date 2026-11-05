import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalRelay } from "../../scripts/local-relay.ts";
import { daemonStop } from "../src/daemon-client.ts";
import { appExecutable, appRoot, attach, killAll, stop, testEnv, until, type Driver } from "./eb-drive.ts";

if (!process.argv[2]) {
  console.error("usage: bun desktop/scripts/join-link-eb.ts <Channels.app, or on Linux its app folder, built with CHANNELS_EB_TEST=1>");
  process.exit(2);
}
const exe = appExecutable(process.argv[2]);
const bundle = appRoot(exe);
const appRun = join(bundle, "bin", "launcher");
const start = existsSync(appRun) ? appRun : exe;
const root = mkdtempSync(join(tmpdir(), "kiwi-join-link-eb-"));
const problems: string[] = [];
const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const pids = (pattern: string): number[] => spawnSync("pgrep", ["-f", pattern], { encoding: "utf8" }).stdout.split("\n").filter(Boolean).map(Number);
const alive = (): number[] => [...pids(bundle), ...pids(root)];
const exited = (p: ChildProcess) => (p.exitCode !== null || p.signalCode !== null ? Promise.resolve() : new Promise<void>((done) => p.once("exit", () => done())));

const COLD = "kiwi://join/mc2-cold-start";
const WARM = "kiwi://join/mc2-while-open";

const { relay, port } = await startLocalRelay(join(root, "relay"), null, { rateLimits: false });
const env = testEnv(root, join(root, "driver.sock"), `http://127.0.0.1:${port}`);
const open = (link: string): ChildProcess => spawn(start, [link], { env, stdio: "ignore", detached: true });
const waiting = (d: Driver) => d.evaluate(() => (window as unknown as { kiwi: { getDeepLink(): Promise<string | null> } }).kiwi.getDeepLink(), null, 2_000);

console.log(`opening links the way the desktop entry's Exec … %U does: ${start} <link>`);
const app = open(COLD);
try {
  const d = await attach(join(root, "driver.sock"));
  await until("the page", 60_000, () => d.evaluate(() => (document.querySelector("#root")?.childElementCount ? true : null), null, 2_000));
  const cold = await waiting(d);
  if (cold === COLD) console.log(`a link that starts the app reaches the page: ${cold}`);
  else problems.push(`started with ${COLD}, the page was given ${JSON.stringify(cold)}`);
  const second = open(WARM);
  await Promise.race([exited(second), later(15_000)]);
  if (second.exitCode === 0) console.log("a second start with a link hands it over and quits");
  else problems.push(`the second start with ${WARM} ended with ${second.exitCode ?? second.signalCode ?? "nothing, after 15 s"}`);
  const warm = await until("the link handed to the open app", 10_000, () => waiting(d)).catch(() => null);
  if (warm === WARM) console.log(`a link opened while the app runs reaches the page: ${warm}`);
  else problems.push(`opened ${WARM} while the app ran, the page was given ${JSON.stringify(warm)}`);
  const visible = await d.main("window");
  if ((visible as { visible?: unknown } | null)?.visible === true) console.log("and the window shows");
  else problems.push(`after the link the window is ${JSON.stringify(visible)}`);
  d.close();
} catch (e) {
  problems.push(e instanceof Error ? e.message : String(e));
} finally {
  await stop(app);
  await daemonStop(join(root, ".kiwi"), 2_000).catch(() => false);
  relay.kill();
  await later(1_000);
  const left = alive();
  if (left.length) problems.push(`still running after the check: ${left.join(", ")}`);
  killAll(left);
  rmSync(root, { recursive: true, force: true });
}

for (const p of problems) console.error(`join-link-eb: ${p}`);
process.exit(problems.length ? 1 : 0);
