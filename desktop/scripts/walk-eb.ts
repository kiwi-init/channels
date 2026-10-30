import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalRelay } from "../../scripts/local-relay.ts";
import { hostedSocket } from "../../src/daemon/hosted-tmux.ts";
import { appExecutable, attach, launch, stop, testEnv, until, type Driver } from "./eb-drive.ts";
import { firstChannel, sendMessage } from "./eb-first-run.ts";

const exe = appExecutable(process.argv[2]!);
const out = process.env.WALK_OUT!;
mkdirSync(out, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "walk-"));
const linux = process.platform === "linux";
const home = join(root, "home");
const kiwiHome = join(root, ".kiwi");
const fake = join(home, "fakebin");
const said = join(out, "result.md");
const logDir = linux ? join(home, ".local", "state") : join(home, "Library", "Logs");
let n = 0;

for (const k of Object.keys(process.env)) if (k === "LANG" || k.startsWith("LC_")) delete process.env[k];
process.env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
delete process.env.GITHUB_ACTIONS;

const say = (line: string) => {
  console.log(line);
  appendFileSync(said, `${line}\n`);
};

const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function shot(tag: string): void {
  const f = join(out, `${String(++n).padStart(2, "0")}-${tag}.png`);
  if (linux) spawnSync("sh", ["-c", `xwd -root -silent | convert xwd:- '${f}'`]);
  else spawnSync("screencapture", ["-x", f]);
}

async function text(d: Driver): Promise<string> {
  return d.evaluate(() => document.body.innerText, null, 5_000).catch((e: Error) => `(no page: ${e.message})`);
}

async function step(d: Driver, name: string, run: () => Promise<string | void>): Promise<boolean> {
  const t = Date.now();
  try {
    const note = await run();
    say(`PASS ${name} (${Date.now() - t} ms)${note ? `: ${note}` : ""}`);
    await later(400);
    shot(name.replace(/\W+/g, "-").slice(0, 30));
    return true;
  } catch (e) {
    say(`FAIL ${name} (${Date.now() - t} ms): ${e instanceof Error ? e.message : String(e)}`);
    shot(`FAIL-${name.replace(/\W+/g, "-").slice(0, 30)}`);
    const page = await text(d);
    say("```\n" + page.slice(0, 1500) + "\n```");
    return false;
  }
}

const click = (d: Driver, name: string, within = "body") =>
  d.evaluate(
    ({ name, within }: { name: string; within: string }) => {
      const b = [...document.querySelectorAll<HTMLButtonElement>(`${within} button`)].find((x) => {
        const words = (x.getAttribute("aria-label") ?? x.textContent ?? "").trim();
        return (words === name || words.startsWith(name)) && x.getClientRects().length > 0 && !x.disabled;
      });
      b?.click();
      return !!b;
    },
    { name, within },
    3_000,
  );

const clickUntil = (d: Driver, name: string, ms = 20_000, within = "body") => until(`the button "${name}"`, ms, () => click(d, name, within).then((v) => (v ? true : null)).catch(() => null));
const shows = (d: Driver, words: string, ms = 30_000) => until(`"${words}" on the page`, ms, () => text(d).then((t) => (t.includes(words) ? true : null)));
const gone = (d: Driver, words: string, ms = 15_000) => until(`"${words}" gone from the page`, ms, () => text(d).then((t) => (t.includes(words) ? null : true)));

function findFile(dir: string, name: string): string | null {
  if (!existsSync(dir)) return null;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) {
      const f = findFile(p, name);
      if (f) return f;
    } else if (e.startsWith(name) && st.mode & 0o111) return p;
  }
  return null;
}

function tmux(args: string[]): string {
  const bin = findFile(join(kiwiHome, "tmux"), "tmux") ?? "tmux";
  const r = spawnSync(bin, ["-S", hostedSocket(kiwiHome), ...args], { encoding: "utf8", env: { ...process.env, LANG: "en_US.UTF-8" } });
  return `${r.stdout}${r.stderr}`;
}

const panes = () => tmux(["list-panes", "-a", "-F", "#{pane_id} #{session_name} #{window_name} #{pane_current_command}"]);
const allPaneText = () =>
  panes()
    .split("\n")
    .filter(Boolean)
    .map((l) => tmux(["capture-pane", "-p", "-t", l.split(" ")[0]!]))
    .join("\n");

mkdirSync(fake, { recursive: true });
const agentLog = join(home, "fake-agent.log");
writeFileSync(
  join(fake, "claude"),
  `#!/bin/sh
case "$1" in --version) echo "2.1.314 (Claude Code)"; exit 0;; esac
{
  echo "argv: $*"; echo "PATH=$PATH"; echo "LANG=$LANG LC_ALL=$LC_ALL KIWI_LAUNCH=$KIWI_LAUNCH"; command -v kiwi
} >> '${agentLog}' 2>&1
echo FAKE-CLAUDE-BOOTED
code=$(printf '%s' "$*" | grep -oE 'mc2-[A-Za-z0-9_-]+' | head -1)
echo "joining with $code"
{
  kiwi join "$code" --model claude-sonnet-5-5 --harness claude; echo "join exit $?"
  kiwi send "hello from the fake agent"; echo "send exit $?"
  kiwi status | head -20
  N=$(kiwi log --json -n 50 | grep -o '"seq":[0-9]*' | head -1 | cut -d: -f2)
  kiwi task add "Walk task from the agent" --ask "\${N:-1}" --body "made by the walk"; echo "task add exit $?"
  kiwi task add "Walk task, no ask" ; echo "task add 2 exit $?"
  kiwi ask-human "Which way, left or right?" --holds T1 --option "A: left" --option "B: right"; echo "ask exit $?"
  kiwi listen --once --timeout 240s; echo "listen 1 exit $?"
  kiwi listen --once --timeout 240s; echo "listen 2 exit $?"
  kiwi send "the agent heard the person"; echo "send 2 exit $?"
} 2>&1 | tee -a '${agentLog}'
echo FAKE-CLAUDE-IDLE
exec sh
`,
);
chmodSync(join(fake, "claude"), 0o755);
for (const rc of [".zshrc", ".zprofile", ".bashrc", ".bash_profile", ".profile"]) writeFileSync(join(home, rc), `export PATH="$HOME/fakebin:$PATH"\n`);
mkdirSync(join(home, "code", "myrepo", ".git"), { recursive: true });
writeFileSync(join(home, "code", "myrepo", ".git", "HEAD"), "ref: refs/heads/main\n");
spawnSync("git", ["-C", join(home, "code", "myrepo"), "init", "-q"], { env: { ...process.env, HOME: home } });

const { relay, port } = await startLocalRelay(join(root, "relay"), null, { rateLimits: false });
const RELAY = `http://127.0.0.1:${port}`;
const env = () => testEnv(root, join(root, "driver.sock"), RELAY, { SHELL: linux ? "/bin/bash" : "/bin/zsh" });
let app = launch(exe, env());
say(`# walk on ${process.platform}, commit ${process.env.GITHUB_SHA ?? "?"}, no LANG, launchd PATH\n`);
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M/wn4EIwDiqEF8FAJ1ZB/kG0eZLAAAAAElFTkSuQmCC";

try {
  let d = await attach(join(root, "driver.sock"));
  await step(d, "first run: name, new channel, first message", async () => {
    await firstChannel(d, 1);
    await later(1_000);
  });
  await step(d, "the agent list of a new channel: read it", async () => (await text(d)).replace(/\n+/g, " | ").slice(0, 700));
  await step(d, "send and read a second message", async () => {
    await until("message", 30_000, () => d.evaluate(sendMessage, "Second message, with **bold** and a `code` span.", 2_000).then((v) => (v ? true : null)));
  });
  await step(d, "attach an image and send it", async () => {
    await until("the image in the composer", 15_000, () =>
      d
        .evaluate(
          (b64: string) => {
            const input = document.querySelector<HTMLInputElement>('input[type="file"]');
            if (!input) return false;
            const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            const dt = new DataTransfer();
            dt.items.add(new File([bytes], "walk.png", { type: "image/png" }));
            input.files = dt.files;
            input.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          },
          PNG,
        )
        .then((v) => (v ? true : null)),
    );
    await until("an attachment", 10_000, () => d.evaluate(() => document.querySelectorAll(".compose-files li").length > 0 || null, null));
    await clickUntil(d, "Send");
    return String(
      await until("the sent image, loaded", 30_000, () =>
        d.evaluate(() => {
          const imgs = [...document.querySelectorAll<HTMLImageElement>(".main img")].filter((i) => !i.closest(".compose-files") && i.naturalWidth > 0 && (i.src.startsWith("blob:") || i.src.startsWith("data:")));
          return imgs.length ? imgs.length : null;
        }, null),
      ),
    );
  });
  await step(d, "Your terminal opens without an error", async () => {
    await clickUntil(d, "Your terminal");
    await until("the terminal live", 30_000, () => d.evaluate(() => (document.querySelector("section.term canvas") ? true : null), null));
    await later(3_000);
    const inTerm = await d.evaluate(() => document.querySelector("section.term")?.textContent ?? "", null);
    if (/tmux|error|fail|can't|couldn't/i.test(inTerm.replace("Your terminal", ""))) throw new Error(`the drawer says: ${inTerm}`);
    return `drawer: ${inTerm.slice(0, 120)}; panes: ${panes().replace(/\n/g, " ; ")}`;
  });
  await step(d, "Your terminal takes typing and shows the output", async () => {
    const word = "walk$((40+2))ok";
    await d.evaluate(
      (w: string) => {
        const box = document.querySelector("section.term");
        const target = (document.activeElement && box?.contains(document.activeElement) ? document.activeElement : box?.querySelector("canvas, textarea, [tabindex]")) as HTMLElement;
        target.focus();
        for (const ch of `echo ${w}\r`)
          (document.activeElement ?? target).dispatchEvent(new KeyboardEvent("keydown", { key: ch === "\r" ? "Enter" : ch, code: ch === "\r" ? "Enter" : "", bubbles: true, cancelable: true }));
      },
      word,
    );
    await until("walk42ok in a pane", 8_000, async () => (allPaneText().includes("walk42ok") ? true : null)).catch(async () => {
      if (linux) spawnSync("xdotool", ["type", "--delay", "30", `echo ${word}\n`]);
      else spawnSync("osascript", ["-e", `tell application "System Events" to keystroke "echo ${word}\n"`]);
      await until("walk42ok in a pane, after real keystrokes", 10_000, async () => (allPaneText().includes("walk42ok") ? true : null));
    });
    return allPaneText().trim().slice(-200);
  });
  await step(d, "non-ASCII and colours in Your terminal", async () => {
    const pane = panes().split("\n")[0]?.split(" ")[0] ?? "";
    tmux(["send-keys", "-t", pane, "-l", "printf 'héllo ✓ 日本語\\n'; locale | head -2\n"]);
    await later(1_500);
    const t = tmux(["capture-pane", "-p", "-t", pane]);
    if (!t.includes("héllo ✓ 日本語")) throw new Error(`pane shows: ${t.slice(-300)}`);
    return t.trim().slice(-160);
  });
  await step(d, "close Your terminal", async () => {
    await clickUntil(d, "Your terminal");
  });
  await step(d, "Add agent: the form finds the computer, Claude Code and a folder", async () => {
    await clickUntil(d, "Add agent");
    await shows(d, "Start one here", 10_000);
    await later(4_000);
    const t = await text(d);
    if (t.includes("No computer of yours is linked")) throw new Error("no computer linked");
    return (await d.evaluate(() => document.querySelector(".add-form")?.textContent ?? "(no form)", null)).slice(0, 400);
  });
  let started = false;
  await step(d, "Add agent: start it on this computer", async () => {
    await until("a folder in the form", 20_000, () =>
      d.evaluate(() => {
        const f = document.querySelector<HTMLFormElement>(".add-form");
        const b = f?.querySelector<HTMLButtonElement>('button[type="submit"]');
        return b && !b.disabled ? b.textContent : null;
      }, null),
    );
    await d.evaluate(() => document.querySelector<HTMLButtonElement>('.add-form button[type="submit"]')?.click(), null);
    await until("the fake harness started", 60_000, async () => (existsSync(agentLog) ? true : null));
    started = true;
    return readFileSync(agentLog, "utf8").slice(0, 600);
  });
  if (started) {
    await step(d, "the started agent gets let in and speaks in the channel", async () => {
      await shows(d, "hello from the fake agent", 90_000);
    });
    await step(d, "what the agent ran (its log)", async () => readFileSync(agentLog, "utf8").slice(0, 2500));
    await step(d, "the Progress panel finishes", async () => {
      await shows(d, "Started", 30_000);
    });
    await step(d, "open the agent: click it and open its terminal", async () => {
      const name = "nova";
      await d.evaluate(
        (who: string) => {
          const b = [...document.querySelectorAll<HTMLElement>("button, [role=button], a")].find((x) => (x.textContent ?? "").trim().toLowerCase().startsWith(who) && x.getClientRects().length > 0);
          b?.click();
        },
        name,
      );
      await later(1_500);
      await clickUntil(d, "Open terminal", 5_000).catch(() => clickUntil(d, "Terminal", 5_000));
      await until("the agent's terminal", 20_000, () => d.evaluate(() => (document.querySelector('section.term canvas') ? (document.querySelector("section.term")?.getAttribute("aria-label") ?? "") : null), null));
      await later(2_500);
      const inTerm = await d.evaluate(() => document.querySelector("section.term")?.textContent ?? "", null);
      if (/error|fail|can't|couldn't/i.test(inTerm)) throw new Error(`the drawer says: ${inTerm}`);
      if (!allPaneText().includes("FAKE-CLAUDE-BOOTED")) throw new Error(`no agent output in the hosted tmux: ${allPaneText().slice(-400)}`);
      return inTerm.slice(0, 120);
    });
    await step(d, "close the agent's terminal", async () => {
      await d.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("section.term button")].find((b) => /close/i.test(b.getAttribute("aria-label") ?? ""))?.click(), null);
    });
    await step(d, "the Tasks tab lists the agent's task", async () => {
      await clickUntil(d, "Tasks");
      await shows(d, "Walk task from the agent", 30_000);
    });
    await step(d, "open a task", async () => {
      await d.evaluate(() => [...document.querySelectorAll<HTMLElement>("button, [role=button], a, article, li")].filter((x) => (x.textContent ?? "").includes("Walk task from the agent")).pop()?.click(), null);
      await until("the task panel", 8_000, () => d.evaluate(() => (document.querySelector("aside.panel")?.textContent?.includes("Walk task") ? true : null), null));
    });
    await step(d, "Needs you shows the agent's question and its options", async () => {
      await clickUntil(d, "Needs you", 60_000);
      await shows(d, "Which way, left or right?", 20_000);
      await shows(d, "left", 5_000);
    });
    await step(d, "answer it with one click; the agent hears it", async () => {
      await clickUntil(d, "A: left", 10_000).catch(() => clickUntil(d, "left", 5_000));
      await until("the agent got the answer", 30_000, async () => (/listen 1 exit 0/.test(readFileSync(agentLog, "utf8")) ? true : null));
      return readFileSync(agentLog, "utf8").split("\n").slice(-6).join(" / ");
    });
    await step(d, "a person's message reaches the agent, and its reply shows", async () => {
      await clickUntil(d, "#general", 3_000).catch(() => {});
      await d.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('nav.tabs button')][0]?.click(), null);
      await until("message", 30_000, () => d.evaluate(sendMessage, "@nova are you there?", 2_000).then((v) => (v ? true : null)));
      await shows(d, "the agent heard the person", 60_000);
    });
  }
  await step(d, "Settings: computers lists this one, and the link-a-phone screen opens", async () => {
    const opened = await d.evaluate(() => {
      const b = [...document.querySelectorAll<HTMLElement>("button")].find((x) => /settings/i.test(x.getAttribute("aria-label") ?? x.title ?? ""));
      b?.click();
      return !!b;
    }, null);
    if (!opened) throw new Error("no settings button");
    await later(1_000);
    await clickUntil(d, "Computers", 5_000).catch(() => clickUntil(d, "Devices", 5_000));
    await clickUntil(d, "Link a phone", 10_000);
    await later(2_000);
    return (await text(d)).replace(/\n+/g, " | ").slice(0, 700);
  });
  await step(d, "add a second computer: kiwi login, 6 digits", async () => {
    await clickUntil(d, "Add a computer", 5_000).catch(() => {});
    const second = join(root, "second");
    mkdirSync(second, { recursive: true });
    const cli = join(home, ".kiwi", "bin", "kiwi");
    const who = await d.evaluate(() => (window as unknown as { kiwi: { getToken(): Promise<{ token?: string } | string | null> } }).kiwi.getToken(), null, 5_000);
    const name = /dev:([\w-]+)/.exec(JSON.stringify(who))?.[1] ?? "Jonatas";
    const login = spawn(cli, ["login", "--user", name], { env: { ...process.env, HOME: second, KIWI_HOME: join(second, ".kiwi"), KIWI_RELAY: RELAY }, stdio: ["ignore", "pipe", "pipe"] });
    let said2 = "";
    login.stdout!.on("data", (b: Buffer) => (said2 += b.toString()));
    login.stderr!.on("data", (b: Buffer) => (said2 += b.toString()));
    const digits = await until("the digits", 30_000, async () => /(\d{3}) (\d{3})/.exec(said2)?.slice(1).join("") ?? null).catch(() => {
      throw new Error(`kiwi login said: ${said2}`);
    });
    await later(3_000);
    shot("login-ask");
    const typed = await d.evaluate(
      (ds: string) => {
        const el = [...document.querySelectorAll<HTMLInputElement>("input")].find((i) => /digit|code/i.test(`${i.getAttribute("aria-label")} ${i.placeholder} ${i.inputMode} ${i.autocomplete}`));
        if (!el) return false;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, ds);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      },
      digits,
    );
    if (!typed) throw new Error(`no digits field on the page; the login said: ${said2}`);
    await later(500);
    await clickUntil(d, "Add", 5_000).catch(() => clickUntil(d, "Approve", 5_000));
    const done = await Promise.race([new Promise<number>((r) => login.once("exit", (c) => r(c ?? -1))), later(30_000).then(() => -2)]);
    if (done !== 0) {
      login.kill();
      throw new Error(`kiwi login ended ${done}: ${said2}`);
    }
    return said2.replace(/\n/g, " / ").slice(-200);
  });
  await step(d, "quit and open again: channel, messages and terminal come back", async () => {
    d.close();
    await stop(app);
    await later(2_000);
    app = launch(exe, env());
    d = await attach(join(root, "driver.sock"));
    await shows(d, "Second message", 60_000);
  });
  await step(d, "after reopening, the agent is still reachable and its terminal opens", async () => {
    await clickUntil(d, "Your terminal", 20_000);
    await until("the terminal live", 30_000, () => d.evaluate(() => (document.querySelector("section.term canvas") ? true : null), null));
    await later(2_000);
    return (await d.evaluate(() => document.querySelector("section.term")?.textContent ?? "", null)).slice(0, 120);
  });
  d.close();
} catch (e) {
  say(`CRASH ${e instanceof Error ? e.stack : String(e)}`);
} finally {
  for (const f of [agentLog]) if (existsSync(f)) writeFileSync(join(out, "fake-agent.log"), readFileSync(f));
  const main = findFile(logDir, "main.log");
  void main;
  spawnSync("sh", ["-c", `find '${logDir}' -name 'main.log' -exec cp {} '${out}/' \; ; cp '${kiwiHome}'/*.log '${out}/' 2>/dev/null; true`]);
  await stop(app);
  relay.kill();
}
process.exit(0);
