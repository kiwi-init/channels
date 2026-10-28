import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOSTED_CONF, HOSTED_SESSION, HostedTmux, findTmux, hostedSocket, privateDir, tmuxHosts, type HostedState } from "../src/daemon/hosted-tmux.ts";

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

const tmux = process.platform === "win32" ? null : await findTmux({});

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

  test.if(!!tmux)("killing it stops the server and leaves no socket or state behind", async () => {
    const st = first.state()!;
    await first.kill();
    expect(await first.alive(st)).toBe(false);
    expect(existsSync(st.socket)).toBe(false);
    expect(first.state()).toBeNull();
  });
});
