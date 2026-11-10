import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { startLocalRelay } from "../../scripts/local-relay.ts";
import { daemonHello, daemonStop } from "../src/daemon-client.ts";
import { bridgeChecks } from "./eb-bridge-checks.ts";
import { appExecutable, appRoot, attach, killAll, launch, stop, testEnv, until, type Driver } from "./eb-drive.ts";
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

const SPELLED = "hello world ";
const MISSPELLED = "helo wrold thsi ";

async function spellingMarks(d: Driver): Promise<{ empty: number; right: number; wrong: number } | string> {
  const xdo = (...args: string[]) => spawnSync("xdotool", ["search", "--sync", "--onlyvisible", "--limit", "1", "--name", "^Channels$", ...args], { encoding: "utf8", timeout: 20_000 });
  const geometry = Object.fromEntries(
    (xdo("getwindowgeometry", "--shell").stdout ?? "")
      .split("\n")
      .map((l) => l.split("="))
      .filter((kv) => kv.length === 2),
  );
  const area = ["X", "Y", "WIDTH", "HEIGHT"].map((k) => String(Number(geometry[k] ?? NaN)));
  if (area.some((v) => v === "NaN")) return `no window geometry from xdotool: ${JSON.stringify(geometry)}`;
  const red = () => Number(spawnSync("python3", [join(import.meta.dirname, "red-pixels.py"), ...area], { encoding: "utf8", timeout: 30_000 }).stdout.trim());
  const ready = await d.evaluate(() => {
    const t = document.querySelector<HTMLTextAreaElement>(".main .composer textarea");
    if (!t) return "no composer";
    t.style.caretColor = "transparent";
    t.focus();
    return t.value === "" ? "ready" : `the composer already holds ${JSON.stringify(t.value)}`;
  }, null);
  if (ready !== "ready") return ready;
  const empty = red();
  xdo("windowfocus", "--sync", "type", "--delay", "40", SPELLED);
  await later(1_500);
  const right = red();
  xdo("windowfocus", "--sync", "type", "--delay", "40", MISSPELLED);
  await later(1_500);
  const wrong = red();
  xdo("windowfocus", "--sync", "key", "--clearmodifiers", "ctrl+a", "BackSpace");
  await d.evaluate(() => {
    const t = document.querySelector<HTMLTextAreaElement>(".main .composer textarea");
    if (t) t.style.caretColor = "";
    return true;
  }, null);
  if ([empty, right, wrong].some((n) => !Number.isFinite(n) || n < 0)) return `the screen couldn't be read: ${empty}, ${right}, ${wrong}`;
  return { empty, right, wrong };
}
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
    const written = `[the message link](${messageLink})`;
    const linkOpened = await until("a markdown link sent from the composer", 30_000, () =>
      d.evaluate(sendMessage, { text: written, shows: "the message link" }, 2_000).then((sent) => (sent ? true : null)),
    )
      .then(() =>
        d.evaluate((url) => {
          const a = [...document.querySelectorAll<HTMLAnchorElement>(".main article.msg a")].find((el) => el.getAttribute("href") === url);
          a?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
          return a?.textContent === "the message link";
        }, messageLink),
      )
      .then((clicked) => until("the system opener receiving the clicked link", 10_000, async () => (clicked && existsSync(opened) && readFileSync(opened, "utf8").includes(messageLink) ? true : null)))
      .catch((e: Error) => (problems.push(`a Ctrl-clicked link in a sent message reaches the system browser: ${e.message}`), null));
    if (linkOpened) console.log("a Ctrl-clicked markdown link in a sent message reached the fake xdg-open with its exact URL");
  }
  await check(
    "the composer checks spelling and fields that opt out stay unchecked",
    d,
    () => ({
      doc: document.querySelector<HTMLTextAreaElement>(".main .composer textarea")?.spellcheck ?? null,
      optedOut: [...document.querySelectorAll<HTMLElement>('[spellcheck="false"]')].every((el) => !el.spellcheck),
    }),
    (v) => v.doc === true && v.optedOut,
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
    killAll(ours);
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
    const inSettings = () => d.evaluate(() => !!document.querySelector(".rail-gear.is-on"), null) as Promise<boolean>;
    key("ctrl+comma");
    const opened = await until("Ctrl+, opening Settings", 5_000, () => inSettings().then((on) => (on ? true : null))).catch(() => null);
    await d.evaluate(() => document.querySelector<HTMLElement>(".rail-gear.is-on")?.click(), null);
    const left = await until("leaving Settings", 5_000, () => inSettings().then((on) => (on ? null : true))).catch(() => null);
    const bare = () => d.evaluate(() => !!document.querySelector(".chan.is-bare"), null) as Promise<boolean>;
    const side = await bare();
    key("ctrl+backslash");
    const flipped = await until("Ctrl+\\ toggling the sidebar", 5_000, () => bare().then((now) => (now !== side ? true : null))).catch(() => null);
    await later(600);
    const held = (await bare()) !== side;
    key("ctrl+backslash");
    const restored = await until("Ctrl+\\ toggling the sidebar back", 5_000, () => bare().then((now) => (now === side ? true : null))).catch(() => null);
    if (flipped && held && restored) console.log("Ctrl+\\ toggles the sidebar once per press");
    else
      problems.push(
        `Ctrl+\\ ${flipped ? "toggled" : "didn't toggle"} the sidebar, it ${held ? "stayed" : "flipped back by itself"}, and a second press ${restored ? "put it back" : "didn't put it back"}`,
      );
    if (opened && left) console.log("Ctrl+, (libkiwi-shell's shortcut 8) opens Settings in the page");
    else problems.push(`Ctrl+, ${opened ? "opened Settings" : "didn't open Settings"}${opened && !left ? ", and the gear didn't leave it" : ""}`);
    const marks = await spellingMarks(d);
    if (typeof marks === "string") problems.push(`spell check underlining a misspelled word: ${marks}`);
    else if (marks.wrong - marks.right >= 20)
      console.log(`spell check underlines: typing "${MISSPELLED.trim()}" drew ${marks.wrong - marks.right} red marker pixels, and "${SPELLED.trim()}" drew ${marks.right - marks.empty}`);
    else problems.push(`spell check drew no marks under "${MISSPELLED.trim()}": red pixels ${marks.empty} empty, ${marks.right} after "${SPELLED.trim()}", ${marks.wrong} after it`);
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
    const settingsKey = osa(`tell application "System Events" to get value of attribute "AXMenuItemCmdChar" of menu item "Settings…" of menu 1 of menu bar item 2 of menu bar 1 of (${proc})`);
    const menus = osa(`tell application "System Events" to get name of every menu bar item of menu bar 1 of (${proc})`);
    if (settingsKey === "," && /Go/.test(menus) && /Help/.test(menus)) console.log(`the app menu: Settings… on ⌘, and the menu bar reads ${menus}`);
    else problems.push(`the app menu's Settings… has key ${JSON.stringify(settingsKey)}, and the menu bar reads ${JSON.stringify(menus)}`);
    const page = <T>(fn: () => T) => d.evaluate(fn, null) as Promise<T>;
    command(",");
    const inSettings = await until("⌘, opening Settings", 5_000, () => page(() => !!document.querySelector(".rail-gear.is-on")).then((on) => (on ? true : null))).catch(() => null);
    await page(() => document.querySelector<HTMLElement>(".rail-gear.is-on")?.click());
    await until("leaving Settings", 5_000, () => page(() => !document.querySelector(".rail-gear.is-on")).then((off) => (off ? true : null))).catch(() => null);
    command("k");
    const jumped = await until("⌘K opening the palette", 5_000, () => page(() => !!document.querySelector("dialog.palette[open]")).then((on) => (on ? true : null))).catch(() => null);
    await later(600);
    const stayed = await page(() => !!document.querySelector("dialog.palette[open]"));
    command("k");
    const shut = await until("⌘K closing the palette", 5_000, () => page(() => !document.querySelector("dialog.palette[open]")).then((off) => (off ? true : null))).catch(() => null);
    const escape = () => osa(`tell application "System Events" to key code 53`);
    const inChannel = () => page(() => !!document.querySelector(".chan"));
    const settle = async <T>(read: () => Promise<T>): Promise<T> => {
      await later(700);
      return read();
    };
    const once: string[] = [];
    const bareNow = () => page(() => !!document.querySelector(".chan.is-bare"));
    const side = await bareNow();
    command("\\\\");
    if ((await settle(bareNow)) === side) once.push("⌘\\ left the sidebar as it was (no toggle, or two)");
    command("\\\\");
    if ((await settle(bareNow)) !== side) once.push("a second ⌘\\ didn't put the sidebar back");
    const room = () => page(() => (document.querySelector(".side-row.is-on")?.textContent ?? "").replace(/\s+/g, " ").trim());
    const named = (el: Element, name: string) => [el.getAttribute("aria-label"), el.getAttribute("title"), el.textContent].some((t) => (t ?? "").trim() === name);
    const goTo = async (name: string) => {
      await d.evaluate((n: string) => [...document.querySelectorAll<HTMLElement>(".side-row")].find((r) => (r.textContent ?? "").includes(n))?.click(), name);
      await until(`the ${name} room`, 5_000, () => room().then((r) => (r.includes(name) ? true : null))).catch(() => null);
    };
    await d.evaluate((src: string) => {
      const is = new Function(`return ${src}`)() as (el: Element, name: string) => boolean;
      [...document.querySelectorAll<HTMLElement>("button")].find((b) => is(b, "New room"))?.click();
    }, named.toString());
    await until("the New room dialog", 5_000, () => page(() => !!document.querySelector("dialog[open] input")).then((on) => (on ? true : null))).catch(() => null);
    await page(() => {
      const field = document.querySelector<HTMLInputElement>("dialog[open] input");
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (!field || !set) return;
      set.call(field, "plans");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page(() => [...document.querySelectorAll<HTMLElement>("dialog[open] button")].find((b) => (b.textContent ?? "").trim() === "Create room")?.click());
    await until("the plans room in the sidebar", 10_000, () =>
      page(() => [...document.querySelectorAll(".side-row")].some((r) => (r.textContent ?? "").includes("plans"))).then((on) => (on ? true : null)),
    ).catch(() => null);
    await goTo("general");
    await goTo("plans");
    await goTo("general");
    const before = await room();
    command("[");
    const back = await settle(room);
    if (!back.includes("plans"))
      once.push(`⌘[ from general, after general → plans → general, landed on ${JSON.stringify(back)}, not plans (it was on ${JSON.stringify(before)}: no step back, or two)`);
    command("]");
    const forward = await settle(room);
    if (!forward.includes("general")) once.push(`⌘] then landed on ${JSON.stringify(forward)}, not general (no step forward, or two)`);
    command("n");
    const asked = await until("⌘N opening New channel", 5_000, () => page(() => !!document.querySelector("dialog[open]:not(.palette)")).then((on) => (on ? true : null))).catch(() => null);
    escape();
    await until("New channel closing", 5_000, () => page(() => !document.querySelector("dialog[open]")).then((off) => (off ? true : null))).catch(() => null);
    if (!asked) once.push("⌘N didn't open New channel");
    command("f");
    const finding = await until("⌘F opening search", 5_000, () => page(() => !!document.querySelector(".top-tools.is-searching")).then((on) => (on ? true : null))).catch(() => null);
    escape();
    if (!finding) once.push("⌘F didn't open search");
    await page(() => document.querySelector<HTMLElement>(".rail .tile.is-home")?.click());
    await until("Home", 5_000, () => inChannel().then((on) => (on ? null : true))).catch(() => null);
    command("1");
    const first = await until("⌘1 opening the first channel", 5_000, () => inChannel().then((on) => (on ? true : null))).catch(() => null);
    if (!first) once.push("⌘1 from Home didn't open the first channel");
    if (once.length) problems.push(...once);
    else console.log("through the menu bar: ⌘\\ toggles the sidebar once per press, ⌘[ and ⌘] move one place each, ⌘N opens New channel, ⌘F opens search, ⌘1 opens the first channel");
    if (inSettings && jumped && stayed && shut) console.log("⌘, opens Settings; ⌘K, a menu key and a page key at once, opens the palette once and closes it once");
    else
      problems.push(
        `⌘, ${inSettings ? "opened" : "didn't open"} Settings; ⌘K ${jumped ? "opened" : "didn't open"} the palette, it ${stayed ? "stayed" : "closed again by itself"}, and a second ⌘K ${shut ? "closed" : "didn't close"} it`,
      );
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
  killAll(left);
  rmSync(root, { recursive: true, force: true });
}

for (const p of problems) console.error(`smoke-eb: ${p}`);
process.exit(problems.length ? 1 : 0);
