import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { OWN_TMUX_DIR } from "@kiwi/core/terminals.ts";
import { loopArgv, readLoopStart, startLoop } from "../src/loop/start.ts";
import type { Ran } from "../src/terminals/shared/run.ts";
import { HOSTED_CONF, HOSTED_SESSION, HostedTmux, findTmux, hostedSocket, inFolder, ownTmux, privateDir, tmuxHosts, type HostedState } from "../src/daemon/hosted-tmux.ts";

describe("the hosted tmux's settings", () => {
  test("the config keeps the server up with no sessions, keeps dead panes, and never resizes on its own", () => {
    for (const line of [
      "exit-empty off",
      "escape-time 0",
      "focus-events on",
      "default-terminal screen-256color",
      "remain-on-exit on",
      "after-new-session 'set -w window-size manual'",
      "after-new-window 'set -w window-size manual'",
    ])
      expect(HOSTED_CONF).toContain(line);
  });

  test("each home gets its own short socket under /tmp/kiwi-UID", () => {
    const a = hostedSocket("/var/folders/xy/T/kiwi-test-home-with-a-very-long-name-that-would-not-fit-a-unix-socket/.kiwi", 501);
    expect(a).toMatch(/^\/tmp\/kiwi-501\/[0-9a-f]{12}$/);
    expect(hostedSocket("/Users/jow/.kiwi", 501)).not.toBe(a);
    expect(hostedSocket("/Users/jow/.kiwi", 501)).toBe(hostedSocket("/Users/jow/.kiwi", 501));
  });

  test("tmux 3.2 or newer can host agents (pause-after came in 3.2)", () => {
    expect(tmuxHosts("tmux 3.8")).toBe(true);
    expect(tmuxHosts("tmux 3.2")).toBe(true);
    expect(tmuxHosts("tmux 3.3a")).toBe(true);
    expect(tmuxHosts("tmux next-3.6")).toBe(true);
    expect(tmuxHosts("tmux master")).toBe(true);
    expect(tmuxHosts("tmux 3.1c")).toBe(false);
    expect(tmuxHosts("tmux 2.9")).toBe(false);
    expect(tmuxHosts("")).toBe(false);
  });

  test("the socket's folder is made private, or tightened when it isn't", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "kiwi-hosted-")), "sock");
    privateDir(dir);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    Bun.spawnSync(["chmod", "755", dir]);
    privateDir(dir);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(() => privateDir(dir, (process.getuid?.() ?? 0) + 1)).toThrow("isn't this user's own folder");
    rmSync(join(dir, ".."), { recursive: true, force: true });
  });
});

describe("the tmux the app ships", () => {
  const home = mkdtempSync(join(tmpdir(), "kiwi-own-tmux-"));
  const own = join(home, OWN_TMUX_DIR);
  const fake = (name: string, says: string): string => {
    mkdirSync(own, { recursive: true });
    const bin = join(own, name);
    writeFileSync(bin, `#!/bin/sh\necho "${says}"\n`, { mode: 0o755 });
    return bin;
  };
  afterAll(() => rmSync(home, { recursive: true, force: true }));

  test.if(process.platform !== "win32")("a home with no copy has none, and copies are tried newest first, other files never", () => {
    expect(ownTmux(home)).toEqual([]);
    fake("tmux-3.7c", "tmux 3.7c");
    fake("tmux-3.10", "tmux 3.10");
    fake("tmux-3.8", "tmux 3.8");
    fake("tmux-3.7", "tmux 3.7");
    fake("tmux-3.8.new-1-x", "tmux 3.8");
    fake("tmux", "tmux 3.8");
    expect(ownTmux(home).map((bin) => basename(bin))).toEqual(["tmux-3.10", "tmux-3.8", "tmux-3.7c", "tmux-3.7"]);
  });

  test.if(process.platform !== "win32")("the daemon takes the app's copy before the person's, KIWI_TMUX before both, and skips one too old to host", async () => {
    const newest = join(own, "tmux-3.10");
    expect(await findTmux(home, { PATH: "/usr/bin:/bin" })).toEqual({ bin: newest, version: "tmux 3.10" });
    const mine = fake("custom-tmux", "tmux 3.6");
    expect(await findTmux(home, { KIWI_TMUX: mine })).toEqual({ bin: mine, version: "tmux 3.6" });
    rmSync(own, { recursive: true, force: true });
    fake("tmux-3.1", "tmux 3.1");
    expect((await findTmux(home, {}))?.bin).not.toBe(join(own, "tmux-3.1"));
  });
});

describe("a loop start's request", () => {
  test("names a channel, a seat and its folder, a loop harness and plain choices", () => {
    const start = { channel: "work", as: "ada", folder: "/w" };
    expect(readLoopStart(start)).toEqual({ ...start, harness: "claude" });
    expect(readLoopStart({ ...start, harness: "codex", model: "gpt-5.5", effort: "high" })).toEqual({ ...start, harness: "codex", model: "gpt-5.5", effort: "high" });
    for (const bad of [
      { ...start, as: "a b" },
      { ...start, as: "" },
      { ...start, harness: "cursor" },
      { ...start, model: "a b" },
      { ...start, effort: "" },
      { as: "ada", folder: "/w" },
      { channel: "work", as: "ada" },
    ])
      expect(readLoopStart(bad)).toBeNull();
  });

  test("runs kiwi loop for that seat, each choice one word kiwi can't read as another flag", () => {
    expect(loopArgv(["/bin/kiwi"], { channel: "work", as: "-x", folder: "/w", harness: "claude", model: "opus" })).toEqual([
      "/bin/kiwi",
      "loop",
      "--channel=work",
      "--as=-x",
      "--harness=claude",
      "--model=opus",
    ]);
  });
});

const tmux = process.platform === "win32" ? null : await findTmux(join(tmpdir(), "kiwi-no-own-tmux"), { KIWI_TMUX: process.env.KIWI_TMUX });

describe("a hosted tmux server", () => {
  if (!tmux && process.env.GITHUB_ACTIONS) test("CI has tmux 3.2 or newer for these tests", () => expect(tmux).not.toBeNull());
  const home = mkdtempSync(join(tmpdir(), "kiwi-hosted-home-"));
  const first = new HostedTmux(home);
  afterAll(async () => {
    await first.kill();
    rmSync(home, { recursive: true, force: true });
  });

  const read = async (st: HostedState, args: string[]): Promise<string> => (await first.tmux(st, args)).stdout.trim();
  const clientFlags = async (st: HostedState): Promise<string> => {
    for (let i = 0; i < 50; i++) {
      const flags = await read(st, ["list-clients", "-F", "#{client_flags}"]);
      if (flags.includes("pause-after")) return flags;
      await Bun.sleep(100);
    }
    return read(st, ["list-clients", "-F", "#{client_flags}"]);
  };

  test.if(!!tmux)("starts with its own config, a holding session and one control client with pause-after", async () => {
    expect(first.state()).toBeNull();
    expect(await first.resume()).toBeNull();
    const st = await first.ensure();
    expect(st.bin).toBe(tmux!.bin);
    expect(st.socket).toBe(hostedSocket(home));
    expect(statSync(join(st.socket, "..")).mode & 0o777).toBe(0o700);
    expect(await read(st, ["show-options", "-sv", "exit-empty"])).toBe("off");
    expect(await read(st, ["show-options", "-wv", "-t", `=${HOSTED_SESSION}:hold`, "window-size"])).toBe("manual");
    expect((await first.tmux(st, ["new-window", "-d", "-t", `=${HOSTED_SESSION}`, "-n", "agent", "cat"])).status).toBe(0);
    expect(await read(st, ["show-options", "-wv", "-t", `=${HOSTED_SESSION}:agent`, "window-size"])).toBe("manual");
    expect(await read(st, ["show-options", "-gv", "remain-on-exit"])).toBe("on");
    expect(await read(st, ["list-sessions", "-F", "#{session_name}"])).toBe(HOSTED_SESSION);
    const flags = await clientFlags(st);
    expect(flags).toContain("control-mode");
    expect(flags).toContain("pause-after=5");
  });

  test.if(!!tmux)("agents and your terminal opened at the same moment on a server not started yet all open, on one control client", async () => {
    const home = mkdtempSync(join(tmpdir(), "kiwi-hosted-burst-"));
    const hosted = new HostedTmux(home);
    try {
      const opened = await Promise.all([
        ...["a", "b", "c"].map((name) => hosted.open({ argv: ["/bin/sh", "-c", "exec sleep 60"], folder: home, name, env: {} })),
        hosted.mine(home, null, "/bin/sh").then((m) => (m.ok ? { ok: true as const } : { ok: false as const, why: "failed", detail: m.detail })),
      ]);
      expect(opened.map((o) => (o.ok ? "ok" : o.detail))).toEqual(["ok", "ok", "ok", "ok"]);
      const st = hosted.state()!;
      expect(
        (await hosted.tmux(st, ["list-clients", "-F", "#{client_flags}"])).stdout
          .trim()
          .split("\n")
          .filter((f) => f.includes("control-mode")),
      ).toHaveLength(1);
    } finally {
      await hosted.kill();
      rmSync(home, { recursive: true, force: true });
    }
  });

  test.if(!!tmux)("a restarted daemon reattaches to the same server with the tmux it started with", async () => {
    const st = first.state()!;
    const pid = await read(st, ["display-message", "-p", "#{pid}"]);
    await first.detach();
    expect(first.attached()).toBe(false);
    expect(await first.alive(st)).toBe(true);

    let looked = false;
    const second = new HostedTmux(home, async () => {
      looked = true;
      return { bin: "/nowhere/tmux", version: "tmux 9.9" };
    });
    expect(await second.resume()).toEqual(st);
    expect(await second.ensure()).toEqual(st);
    expect(looked).toBe(false);
    expect(await read(st, ["display-message", "-p", "#{pid}"])).toBe(pid);
    expect(await clientFlags(st)).toContain("control-mode");

    const lines: string[] = [];
    second.on((line) => lines.push(line));
    expect(second.send("display-message -p hosted-ping")).toBe(true);
    for (let i = 0; i < 50 && !lines.includes("hosted-ping"); i++) await Bun.sleep(100);
    expect(lines).toContain("hosted-ping");
    await second.detach();
  });

  test.if(!!tmux)("opens an agent's window in its own session, in the folder, with the tmux it runs on", async () => {
    const folder = mkdtempSync(join(tmpdir(), "kiwi-hosted-work-"));
    const placed = await first.open({ argv: ["/bin/sh", "-c", 'printf "%s|%s|%s\\n" "$KIWI_TMUX" "$KIWI_LAUNCH" "$PWD"; exec sleep 60'], folder, name: "agent-one", env: { KIWI_LAUNCH: "l1" } });
    const st = first.state()!;
    if (!placed.ok || placed.place !== "hosted") throw new Error(JSON.stringify(placed));
    expect(placed.socket).toBe(st.socket);
    expect(placed.window).toMatch(/^@\d+$/);
    expect(await read(st, ["display-message", "-p", "-t", placed.pane, "#{session_name} #{window_name} #{window-size}"])).toBe(`${HOSTED_SESSION} agent-one manual`);
    const pane = first.pane(placed.pane)!;
    let screen = "";
    for (let i = 0; i < 100 && !screen.includes("|l1|"); i++) {
      screen = pane.screen() ?? "";
      await Bun.sleep(100);
    }
    expect(screen).toContain(`${st.bin}|l1|`);
    expect(screen).toContain(basename(folder));
    rmSync(folder, { recursive: true, force: true });
  });

  test.if(!!tmux)("kiwi loop start runs the seat's loop in a window of its own, only for a channel this computer is in", async () => {
    const folder = mkdtempSync(join(tmpdir(), "kiwi-hosted-loop-"));
    const start = { channel: "work", as: "ada", folder, harness: "claude", model: "opus" } as const;
    const echo = ["/bin/sh", "-c", 'echo "$*"; exec sleep 60', "kiwi"];
    expect(await startLoop({ ...start, channel: "elsewhere" }, first, ["work"], echo)).toMatchObject({ ok: false, why: "bad-request" });
    const placed = await startLoop(start, first, ["work"], echo);
    if (!placed.ok || placed.place !== "hosted") throw new Error(JSON.stringify(placed));
    const st = first.state()!;
    expect(await read(st, ["display-message", "-p", "-t", placed.pane, "#{window_name}"])).toBe("ada loop");
    let screen = "";
    for (let i = 0; i < 100 && !screen.includes("--model=opus"); i++) {
      screen = first.pane(placed.pane)?.screen() ?? "";
      await Bun.sleep(100);
    }
    expect(screen).toContain("loop --channel=work --as=ada --harness=claude --model=opus");
    rmSync(folder, { recursive: true, force: true });
  });

  test.if(!!tmux)("your own terminal is one shell window in the folder, kept while it runs, started afresh once it exits", async () => {
    const folder = mkdtempSync(join(tmpdir(), "kiwi-hosted-mine-"));
    const st = first.state()!;
    const mine = await first.mine(folder, null, "/bin/sh");
    if (!mine.ok) throw new Error(mine.detail);
    expect(await read(st, ["display-message", "-p", "-t", mine.pane, "#{session_name} #{@kiwi-mine}"])).toBe(`${HOSTED_SESSION} 1`);
    expect(await first.mine(tmpdir(), null, "/bin/sh")).toEqual(mine);
    await first.tmux(st, ["send-keys", "-t", mine.pane, 'echo "[$CLAUDECODE]" "$PWD"', "Enter"]);
    let screen = "";
    for (let i = 0; i < 100 && !screen.includes(`] /`); i++) {
      screen = first.pane(mine.pane)?.screen() ?? "";
      await Bun.sleep(100);
    }
    expect(screen).toContain("[] ");
    expect(screen).toContain(basename(folder));
    await first.tmux(st, ["send-keys", "-t", mine.pane, "exit", "Enter"]);
    for (let i = 0; i < 100 && (await read(st, ["display-message", "-p", "-t", mine.pane, "#{pane_dead}"])) !== "1"; i++) await Bun.sleep(100);
    const again = await first.mine(folder, null, "/bin/sh");
    if (!again.ok) throw new Error(again.detail);
    expect(again.pane).not.toBe(mine.pane);
    expect((await read(st, ["list-windows", "-t", `=${HOSTED_SESSION}`, "-F", "#{@kiwi-mine}"])).split("\n").filter((m) => m === "1")).toHaveLength(1);
    rmSync(folder, { recursive: true, force: true });
  });

  test.if(!!tmux)("your terminals open as tabs: a new one, picked by pane, listed by what runs in them, closed one by one", async () => {
    const one = await first.mine(tmpdir(), null, "/bin/sh");
    const two = await first.mine(tmpdir(), "new", "/bin/sh");
    if (!one.ok || !two.ok) throw new Error("no terminal");
    expect(two.pane).not.toBe(one.pane);
    expect(await first.mine(tmpdir(), two.pane, "/bin/sh")).toEqual(two);
    expect(await first.mine(tmpdir(), "%99999", "/bin/sh")).toEqual(one);
    const tabs = await first.mineTabs();
    expect(tabs.map((t) => t.pane)).toEqual([one.pane, two.pane]);
    expect(tabs.every((t) => t.label.length > 0)).toBe(true);
    expect((await first.closeMine(two.pane)).map((t) => t.pane)).toEqual([one.pane]);
    expect((await first.closeMine("%99999")).map((t) => t.pane)).toEqual([one.pane]);
  });

  test.if(!!tmux)("killing it stops the server and leaves no socket or state behind", async () => {
    const st = first.state()!;
    await first.kill();
    expect(await first.alive(st)).toBe(false);
    expect(existsSync(st.socket)).toBe(false);
    expect(first.state()).toBeNull();
  });
});

describe("a hosted tmux server under a daemon with no UTF-8 locale", () => {
  const home = mkdtempSync(join(tmpdir(), "kiwi-hosted-nolang-"));
  afterAll(() => rmSync(home, { recursive: true, force: true }));

  test.if(!!tmux)("still opens your terminal and agent windows, and reads their panes", async () => {
    const script = `
      const { HostedTmux } = await import(${JSON.stringify(join(import.meta.dir, "../src/daemon/hosted-tmux.ts"))});
      const { readPaneInfo } = await import(${JSON.stringify(join(import.meta.dir, "../src/daemon/hosted-term.ts"))});
      const hosted = new HostedTmux(process.argv[1]);
      const mine = await hosted.mine(process.argv[1], null, "/bin/sh");
      const agent = await hosted.open({ argv: ["/bin/sh", "-c", "printf 'café ✓\\n'; exec sleep 60"], folder: process.argv[1], name: "agent", env: {} });
      const tabs = await hosted.mineTabs();
      const st = hosted.state();
      const info = mine.ok ? readPaneInfo((await hosted.tmux(st, ["display-message", "-p", "-t", mine.pane, "#{session_name}\t#{window_id}\t#{pane_width}\t#{pane_height}\t0\t0\t1\t0\t0"])).stdout) : null;
      let screen = "";
      for (let i = 0; i < 50 && agent.ok && !screen.includes("caf"); i++) {
        screen = hosted.pane(agent.pane)?.screen() ?? "";
        await Bun.sleep(100);
      }
      await hosted.kill();
      console.log(JSON.stringify({ mine, agent, tabs, info, screen }));
    `;
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "LANG" && key !== "TMUX" && !key.startsWith("LC_")));
    const child = Bun.spawn([process.execPath, "-e", script, home], { env, stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (!out.trim()) throw new Error(err);
    const r = JSON.parse(out);
    expect(r.mine).toMatchObject({ ok: true, pane: expect.stringMatching(/^%\d+$/) });
    expect(r.agent).toMatchObject({ ok: true, window: expect.stringMatching(/^@\d+$/), pane: expect.stringMatching(/^%\d+$/) });
    expect(r.tabs).toEqual([{ pane: r.mine.pane, label: expect.any(String) }]);
    expect(r.info).toMatchObject({ session: "_kiwi", cols: expect.any(Number), rows: expect.any(Number) });
    expect(r.screen).toContain("café ✓");
  });
});

describe("a hosted tmux server whose own folder is deleted", () => {
  const where = 'printf "[%s]\\n" "$(pwd -P 2>/dev/null)"; exec sleep 60';
  const screenOf = async (hosted: HostedTmux, pane: string, want: string): Promise<string> => {
    let screen = "";
    for (let i = 0; i < 100 && !screen.includes(want); i++) {
      screen = hosted.pane(pane)?.screen() ?? "";
      await Bun.sleep(100);
    }
    return screen;
  };

  test("a pane's first step goes to its folder itself, then runs the command as given", () => {
    expect(inFolder("/w", ["claude", "--x"], ["/bin/sh"])).toEqual(["/bin/sh", "-c", 'cd -- "$1" 2>/dev/null || cd; shift; exec "$@"', "kiwi-cd", "/w", "claude", "--x"]);
    const r = Bun.spawnSync(inFolder(tmpdir(), ["/bin/sh", "-c", "pwd -P"], ["/bin/sh"]), { cwd: "/" });
    expect(r.stdout.toString().trim()).toBe(realpathSync(tmpdir()));
  });

  test.if(!!tmux)("a daemon running from a deleted folder starts tmux from home, so tmux's own -c still works", async () => {
    const home = mkdtempSync(join(tmpdir(), "kiwi-hosted-gone-home-"));
    const doomed = mkdtempSync(join(tmpdir(), "kiwi-hosted-gone-cwd-"));
    const folder = mkdtempSync(join(tmpdir(), "kiwi-hosted-gone-work-"));
    const script = `
      const { rmdirSync } = await import("node:fs");
      const { HostedTmux } = await import(${JSON.stringify(join(import.meta.dir, "../src/daemon/hosted-tmux.ts"))});
      rmdirSync(process.cwd());
      const [home, folder] = process.argv.slice(1);
      const hosted = new HostedTmux(home);
      const st = await hosted.ensure();
      const raw = await hosted.tmux(st, ["new-window", "-d", "-P", "-F", "#{pane_id}", "-c", folder, "--", "/bin/sh", "-c", ${JSON.stringify(where)}]);
      const pane = raw.stdout.trim();
      let screen = "";
      for (let i = 0; i < 100 && !screen.includes("]"); i++) {
        screen = hosted.pane(pane)?.screen() ?? "";
        await Bun.sleep(100);
      }
      await hosted.kill();
      console.log(JSON.stringify({ screen }));
    `;
    const child = Bun.spawn([process.execPath, "-e", script, home, folder], { cwd: doomed, env: { ...process.env, KIWI_TMUX: tmux!.bin }, stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    rmSync(home, { recursive: true, force: true });
    if (!out.trim()) throw new Error(err);
    expect(existsSync(doomed)).toBe(false);
    expect(JSON.parse(out).screen).toContain(`[${realpathSync(folder)}]`);
    rmSync(folder, { recursive: true, force: true });
  });

  test.if(!!tmux)("a server already stuck in a deleted folder still opens your terminal and agents in their folders, without a restart", async () => {
    const home = mkdtempSync(join(tmpdir(), "kiwi-hosted-stuck-home-"));
    const doomed = mkdtempSync(join(tmpdir(), "kiwi-hosted-stuck-cwd-"));
    const folder = mkdtempSync(join(tmpdir(), "kiwi-hosted-stuck-work-"));
    const st: HostedState = { ...tmux!, socket: hostedSocket(home) };
    privateDir(join(st.socket, ".."));
    writeFileSync(join(home, "hosted-tmux.conf"), HOSTED_CONF);
    const started = Bun.spawnSync([st.bin, "-u", "-S", st.socket, "-f", join(home, "hosted-tmux.conf"), "new-session", "-d", "-s", HOSTED_SESSION, "-n", "hold", "true"], { cwd: doomed });
    expect(started.exitCode).toBe(0);
    rmSync(doomed, { recursive: true, force: true });
    writeFileSync(join(home, "hosted-tmux.json"), JSON.stringify(st));
    const hosted = new HostedTmux(home);
    try {
      expect(await hosted.ensure()).toEqual(st);
      const pid = (await hosted.tmux(st, ["display-message", "-p", "#{pid}"])).stdout.trim();
      const mine = await hosted.mine(folder, null, "/bin/sh");
      if (!mine.ok) throw new Error(mine.detail);
      await hosted.tmux(st, ["send-keys", "-t", mine.pane, `printf "[%s]\\n" "$(pwd -P)"`, "Enter"]);
      expect(await screenOf(hosted, mine.pane, `[${realpathSync(folder)}]`)).toContain(`[${realpathSync(folder)}]`);
      const agent = await hosted.open({ argv: ["/bin/sh", "-c", where], folder, name: "agent", env: {} });
      if (!agent.ok || agent.place !== "hosted") throw new Error(JSON.stringify(agent));
      expect(await screenOf(hosted, agent.pane, `[${realpathSync(folder)}]`)).toContain(`[${realpathSync(folder)}]`);
      expect((await hosted.tmux(st, ["display-message", "-p", "#{pid}"])).stdout.trim()).toBe(pid);
    } finally {
      await hosted.kill();
      rmSync(home, { recursive: true, force: true });
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe("a hosted pane that has ended", () => {
  class Scripted extends HostedTmux {
    readonly shown: string[];
    constructor(shown: string[]) {
      super(mkdtempSync(join(tmpdir(), "kiwi-ended-")));
      this.shown = shown;
    }
    override state(): HostedState {
      return { bin: "tmux", version: "tmux 3.4", socket: "/tmp/kiwi-1/abc" };
    }
    override async tmux(_st: HostedState, args: readonly string[]): Promise<Ran> {
      const stdout = args[0] === "capture-pane" ? "Not logged in\nPane is dead (status 1, Fri Oct 30 13:51:12 2026)\n" : (this.shown.shift() ?? "");
      return { status: 0, stdout, stderr: "" };
    }
  }

  test("isn't ended until tmux has its exit status, and then gives that status with its last words", async () => {
    const pane = new Scripted(["0\t\t\n", "1\t\t\n", "1\t1\t\n"]);
    expect(await pane.ended("%3")).toBeNull();
    expect(await pane.ended("%3")).toBeNull();
    expect(await pane.ended("%3")).toEqual({ code: 1, tail: ["Not logged in"] });
  });

  test("one killed by a signal ends as a shell says it, 128 and the signal", async () => {
    expect(await new Scripted(["1\t\t9\n"]).ended("%3")).toEqual({ code: 137, tail: ["Not logged in"] });
  });
});
