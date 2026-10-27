import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { startLocalRelay } from "../../scripts/local-relay.ts";
import { daemonHello, daemonStop } from "../src/daemon-client.ts";
import { bridgeChecks } from "./eb-bridge-checks.ts";
import { appExecutable, appRoot, attach, launch, stop, testEnv, until, type Driver } from "./eb-drive.ts";
import { firstChannel, sendMessage } from "./eb-first-run.ts";

if (!process.argv[2]) {
  console.error("usage: bun desktop/scripts/smoke-eb.ts <Channels.app, or on Linux its app folder, built with CHANNELS_EB_TEST=1>");
  process.exit(2);
}
const exe = appExecutable(process.argv[2]);
const bundle = appRoot(exe);
const root = mkdtempSync(join(tmpdir(), "kiwi-smoke-eb-"));
const problems: string[] = [];
const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const pids = (pattern: string): number[] => spawnSync("pgrep", ["-f", pattern], { encoding: "utf8" }).stdout.split("\n").filter(Boolean).map(Number);
const alive = (): number[] => [...pids(bundle), ...pids(root)];
const linux = process.platform === "linux";
const webContent = (): number[] =>
  spawnSync("pgrep", ["-U", String(userInfo().uid), "-f", linux ? "WebKitWebProcess" : "com.apple.WebKit.WebContent"], { encoding: "utf8" })
    .stdout.split("\n")
    .filter(Boolean)
    .map(Number);
const logDir = linux ? join(".local", "state") : join("Library", "Logs");
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
const opened = join(root, "opened-links.txt");
const openers = join(root, "openers");
mkdirSync(openers, { recursive: true });
for (const name of ["xdg-open", "gio"]) {
  const opener = join(openers, name);
  writeFileSync(opener, `#!/bin/sh\nprintf '%s\\n' "$@" >> '${opened}'\n`);
  chmodSync(opener, 0o755);
}
const app = launch(exe, testEnv(root, join(root, "driver.sock"), RELAY, { PATH: `${openers}:${process.env.PATH}` }));
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
  const spellCheck = await d.main("spellCheck");
  if (spellCheck === true) console.log("spell checking: enabled on the window's native web view");
  else problems.push(`spell checking on the window's native web view: ${JSON.stringify(spellCheck)}`);
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
  await firstChannel(d, 1).then(
    () => console.log("first run: a person, a channel and a message sent and in the conversation, on the local relay"),
    (e: Error) => problems.push(`first run: ${e.message}`),
  );
  if (linux) {
    const messageLink = "https://example.com/kiwi-message-link";
    const linkOpened = await until("a markdown link in a sent message", 30_000, () => d.evaluate(sendMessage, messageLink, 2_000).then((sent) => (sent ? true : null)))
      .then(() =>
        d.evaluate((url) => {
          const a = [...document.querySelectorAll<HTMLAnchorElement>("a")].find((el) => el.href === url);
          a?.click();
          return !!a;
        }, messageLink),
      )
      .then((clicked) =>
        until("the system opener receiving the clicked message link", 10_000, async () => (clicked && existsSync(opened) && readFileSync(opened, "utf8").includes(messageLink) ? true : null)),
      )
      .catch((e: Error) => (problems.push(`message link opens the system browser: ${e.message}`), null));
    if (linkOpened) console.log("a clicked markdown link reached the fake xdg-open with its exact URL");
  }
  await check(
    "the composer checks spelling and fields that opt out stay unchecked",
    d,
    () => ({
      composer: document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.spellcheck ?? null,
      optedOut: [...document.querySelectorAll<HTMLElement>('[spellcheck="false"]')].every((el) => !el.spellcheck),
    }),
    (v) => v.composer === true && v.optedOut,
  );

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
    const logs = found(join(root, "home", logDir), "main.log");
    const logged = logs.some((f) => readFileSync(f, "utf8").includes("the window's page stopped"));
    if (back && logged) console.log(`the app's ${ours.length} web content processes killed: the page reloaded and main.log says so (${logs[0]!.slice(root.length)})`);
    else if (back) problems.push(`the page reloaded but no main.log under the test HOME's ${logDir} says it stopped (found ${logs.length})`);
  }
  if (linux && !process.env.WAYLAND_DISPLAY) {
    const scale = () => d.evaluate(() => document.documentElement.style.getPropertyValue("--text-scale"), null) as Promise<string>;
    const key = (combo: string) => spawnSync("xdotool", ["search", "--sync", "--onlyvisible", "--limit", "1", "--name", "^Channels$", "windowfocus", "--sync", "key", "--clearmodifiers", combo]);
    const was = await scale();
    key("ctrl+equal");
    const bigger = await until("Ctrl+= reaching the page", 5_000, () => scale().then((v) => (v && v !== was ? v : null))).catch(() => null);
    key("ctrl+0");
    const reset = await until("Ctrl+0 reaching the page", 5_000, () => scale().then((v) => (v === "" ? "reset" : null))).catch(() => null);
    if (bigger && reset) console.log(`Ctrl+= then Ctrl+0 (libkiwi-shell's shortcuts; Electrobun has no app menu on Linux): the page's text scale went to ${bigger}, then back`);
    else problems.push(`Ctrl+= then Ctrl+0 gave the page's --text-scale ${JSON.stringify(bigger)}, then ${JSON.stringify(reset)} (it was ${JSON.stringify(was)})`);
  }
  if (linux) {
    await d.main("closeWindow");
    await later(2_000);
    const shown = (await d.main("window")) as { visible?: unknown; minimized?: unknown };
    if (shown.visible === true && alive().length)
      console.log(`closed with no tray host on the session bus: the window stays, minimized (${String(shown.minimized)} here), not hidden with no way back`);
    else
      problems.push(`closed with no tray host on the session bus, the window ${shown.visible === false ? "was hidden, with nothing on screen to bring it back" : `answered ${JSON.stringify(shown)}`}`);
  }
  const mac = process.platform === "darwin";
  const id = mac ? spawnSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", join(bundle, "Contents", "Info.plist")], { encoding: "utf8" }).stdout.trim() : "";
  const proc = `first process whose bundle identifier is "${id}"`;
  const osa = (script: string): string => spawnSync("osascript", ["-e", script], { encoding: "utf8", timeout: 30_000 }).stdout.trim();
  const command = (key: string): void => {
    osa(`tell application "System Events" to set frontmost of (${proc}) to true`);
    osa(`tell application "System Events" to keystroke "${key}" using {command down}`);
  };
  const visible = (want: boolean) => () => d.main("window").then((w) => ((w as { visible?: unknown }).visible === want ? true : null));
  if (mac) {
    const label = () => spawnSync("lsappinfo", ["info", "-only", "StatusLabel", id], { encoding: "utf8" }).stdout;
    const setBadge = (n: number) => d.evaluate((count: number) => (window as unknown as { kiwi: { setBadge(c: number): Promise<void> } }).kiwi.setBadge(count), n);
    const four = await until("the Dock badge", 5_000, async () => {
      await setBadge(4);
      return /"label"="4"/.test(label()) ? true : null;
    }).catch(() => null);
    const cleared = await until("the Dock badge to clear", 5_000, async () => {
      await setBadge(0);
      return /"label"="[^"]+"/.test(label()) ? null : true;
    }).catch(() => null);
    if (four && cleared) console.log("the page's count 4 shows on the Dock icon (lsappinfo's StatusLabel), and 0 clears it");
    else problems.push(`the Dock badge after a count of 4 then 0: ${JSON.stringify(label().trim())} (shown: ${String(!!four)}, cleared: ${String(!!cleared)})`);
    const quitKey = osa(`tell application "System Events" to get value of attribute "AXMenuItemCmdChar" of menu item "Quit Channels" of menu 1 of menu bar item 2 of menu bar 1 of (${proc})`);
    if (quitKey === "Q") console.log("the app menu: Quit Channels on ⌘Q");
    else problems.push(`the app menu's Quit Channels has key ${JSON.stringify(quitKey)}, not ⌘Q`);
    command("w");
    const closed = await until("⌘W closing the window", 10_000, visible(false)).catch(() => null);
    spawnSync("open", [bundle]);
    const back = await until("the window, back on opening the app again", 15_000, visible(true)).catch(() => null);
    if (closed && back) console.log("⌘W closes the window to the menu bar, and opening the app again brings it back");
    else problems.push(`⌘W ${closed ? "closed the window" : "left the window open"}, and opening the app again ${back ? "brought it back" : "didn't bring it back"}`);
  }
  d.close();
  if (mac) {
    command("q");
    const quit = await until("⌘Q quitting the app", 20_000, () => Promise.resolve(app.exitCode !== null || app.signalCode !== null ? true : null)).catch(() => null);
    if (quit) console.log(`⌘Q quits the app (exit ${app.exitCode ?? app.signalCode})`);
    else problems.push("⌘Q left the app running");
  }
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
