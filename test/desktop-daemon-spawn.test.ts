// The desktop app starts this computer's daemon (desktop/src/daemon-client.ts spawnDaemon): it must
// run on the app's relay, since a daemon not yet adopted follows the relay it starts on.
import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { daemonEnv, daemonLogPath, noteDaemon, spawnDaemon } from "../desktop/src/daemon-client.ts";

test("the daemon gets only the names a child of the app keeps (desktop/src/child-env.ts): not the key's fd number, the launcher's transpiler-cache switch, Electrobun's LD_LIBRARY_PATH=. or Bun's and Node's switches, so its agents and shells don't inherit them (T439, T1062)", () => {
  const from = {
    PATH: "/usr/bin",
    HOME: "/Users/someone",
    KIWI_KEY_FD: "3",
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
    LD_LIBRARY_PATH: ".",
    BUN_OPTIONS: "--preload=/tmp/evil.ts",
    NODE_OPTIONS: "--require=/tmp/evil.js",
    REX_SESSION: "session:1",
    KIWI_RELAY: "https://from-the-environment.example",
  };
  expect(daemonEnv(from, "/tmp/home", "https://relay.example")).toEqual({ PATH: "/usr/bin", HOME: "/Users/someone", KIWI_HOME: "/tmp/home", KIWI_RELAY: "https://relay.example" });
  expect(from.KIWI_KEY_FD).toBe("3");
});

test("the daemon keeps every setting it and the harnesses it launches read from the session (src/harness.ts, src/hooks/install, src/terminals, src/cleanup.ts, shell-path.ts), and none of a harness's or terminal's own session markers (T1062)", () => {
  const settings = {
    CLAUDE_CONFIG_DIR: "/s/claude",
    CODEX_HOME: "/s/codex",
    GROK_HOME: "/s/grok",
    KIMI_CODE_HOME: "/s/kimi",
    MIMOCODE_HOME: "/s/mimo",
    PI_CODING_AGENT_DIR: "/s/pi",
    KIWI_CURSOR_DIR: "/s/cursor",
    TMUX_TMPDIR: "/s/tmux",
    REX_CONFIG: "/s/rex/init.lua",
    REX_BIN_DIR: "/s/rex/bin",
    ZDOTDIR: "/s/zsh",
    BUN_INSTALL: "/s/bun",
    XDG_CONFIG_HOME: "/s/config",
    XDG_DATA_HOME: "/s/data",
    XDG_STATE_HOME: "/s/state",
    XDG_CACHE_HOME: "/s/cache",
    XDG_RUNTIME_DIR: "/run/user/1000",
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
    DISPLAY: ":0",
    WAYLAND_DISPLAY: "wayland-0",
    SSH_AUTH_SOCK: "/s/ssh/agent",
    PATH: "/usr/bin:/bin",
    HOME: "/home/someone",
    SHELL: "/bin/zsh",
  };
  const markers = {
    CLAUDECODE: "1",
    CLAUDE_CODE_SESSION_ID: "s",
    CODEX_THREAD_ID: "t",
    GROK_SESSION_ID: "g",
    OPENCODE_SESSION_ID: "o",
    TMUX: "/tmp/tmux-1000/default,1,0",
    TMUX_PANE: "%1",
    REX_SERVER: "unix:///s/rex.sock",
    REX_SESSION: "session:1",
    REX_BLOCK: "block:1",
    TERM_PROGRAM: "rex",
    GIT_DIR: "/s/repo/.git",
    BUN_OPTIONS: "--preload=/tmp/evil.ts",
  };
  expect(daemonEnv({ ...settings, ...markers }, "/tmp/home", "https://relay.example")).toEqual({ ...settings, KIWI_HOME: "/tmp/home", KIWI_RELAY: "https://relay.example" });
});

test.skipIf(process.platform === "win32")("starts `kiwi daemon` for the home, on the app's relay", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-spawn-"));
  const out = path.join(dir, "env.txt");
  // A stand-in kiwi that writes down what it was started with.
  const bin = path.join(dir, "kiwi");
  fs.writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$1" "$KIWI_HOME" "$KIWI_RELAY" > ${JSON.stringify(`${out}.tmp`)}\nmv ${JSON.stringify(`${out}.tmp`)} ${JSON.stringify(out)}\n`);
  fs.chmodSync(bin, 0o755);
  const prev = process.env.KIWI_RELAY;
  process.env.KIWI_RELAY = "https://from-the-environment.example";
  try {
    spawnDaemon(bin, path.join(dir, "home"), "https://relay.example");
  } finally {
    if (prev === undefined) delete process.env.KIWI_RELAY;
    else process.env.KIWI_RELAY = prev;
  }
  for (let i = 0; i < 100 && !fs.existsSync(out); i++) await Bun.sleep(20);
  expect(fs.readFileSync(out, "utf8").split("\n")).toEqual(["daemon", path.join(dir, "home"), "https://relay.example", ""]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a kiwi that won't start is no uncaught error", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-spawn-home-"));
  spawnDaemon(path.join(os.tmpdir(), "kiwi-spawn-missing", "kiwi"), home, "https://relay.example");
  await Bun.sleep(50);
  fs.rmSync(home, { recursive: true, force: true });
});

test.skipIf(process.platform === "win32")("the daemon's output and the app's restarts land in KIWI_HOME/daemon.log, and a log over 1 MB moves to daemon.log.1", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-spawn-log-"));
  const home = path.join(dir, "home");
  fs.mkdirSync(home);
  fs.writeFileSync(daemonLogPath(home), "x".repeat(1_000_001));
  const bin = path.join(dir, "kiwi");
  fs.writeFileSync(bin, "#!/bin/sh\necho started on stdout\necho failed on stderr >&2\n");
  fs.chmodSync(bin, 0o755);
  spawnDaemon(bin, home, "https://relay.example");
  for (let i = 0; i < 100 && !fs.readFileSync(daemonLogPath(home), "utf8").includes("stderr"); i++) await Bun.sleep(20);
  noteDaemon("the daemon wasn't answering; started it again", home);
  const log = fs.readFileSync(daemonLogPath(home), "utf8");
  expect(log).toMatch(/^started on stdout\nfailed on stderr\n\S+Z app: the daemon wasn't answering; started it again\n$/);
  expect(fs.statSync(`${daemonLogPath(home)}.1`).size).toBe(1_000_001);
  fs.rmSync(dir, { recursive: true, force: true });
});
