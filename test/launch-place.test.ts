import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { openPlace, placeKind } from "../src/launch/place.ts";
import { terminalLine } from "../src/terminals/app/index.ts";
import type { Config } from "../src/config.ts";
import type { PlaceRequest, PlaceTools, TerminalId } from "../src/terminals/plugin.ts";
import { loginArgv } from "../src/terminals/shared/launch.ts";

const SESSION = "session:01a15acd-04bb-7b4e-9c8a-feb34c17dd89";
const OTHER = "session:01a15acd-04bb-7b4e-9c8a-feb34c17dd8a";
const PHONE = "session:01a15acd-04bb-7b4e-9c8a-feb34c17dd8b";
const MADE = "session:01a15acd-04bb-7b4e-9c8a-feb34c17dd8c";
const BLOCK = "block:01a15ace-d87b-75bc-97b7-138c007cd1a6";
const ENDPOINT = "unix:///Users/someone/Library/Application%20Support/rex/server.sock";

const bash = Bun.which("bash");
const zsh = Bun.which("zsh");
const hasTmux = spawnSync("tmux", ["-V"]).status === 0;

let dir = "";
let folder = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "kiwi-place-"));
  folder = join(dir, "the work's folder");
  mkdirSync(folder);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const request = (over: Partial<PlaceRequest> = {}): PlaceRequest => ({ argv: ["claude", "run kiwi join"], folder, name: "claude-two", env: { KIWI_LAUNCH: "l1" }, ...over });

const tools = (over: Partial<PlaceTools> = {}): PlaceTools => ({ platform: "linux", shell: "/bin/zsh", rex: null, tmux: null, osascript: null, ...over });
const prefers = (prefer: TerminalId, on: "on" | "off" = "on"): Pick<Config, "terminals"> => ({ terminals: { prefer, helpers: prefer === "app" ? {} : { [prefer]: on } } });
const REX = prefers("rex");

function fake(name: string, body: string): { bin: string; calls: () => string[][] } {
  const bin = join(dir, name);
  const log = `${bin}.log`;
  rmSync(log, { force: true });
  writeFileSync(bin, `#!/bin/sh\nfor a in "$@"; do printf '%s\\037' "$a" >> '${log}'; done\nprintf '\\n' >> '${log}'\n${body}\n`);
  chmodSync(bin, 0o755);
  const calls = () =>
    existsSync(log)
      ? readFileSync(log, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => line.split("\x1f").slice(0, -1))
      : [];
  return { bin, calls };
}

interface RexAnswers {
  whoami?: string;
  clients?: object;
  sessions?: object;
  window?: string;
}

function fakeRex(a: RexAnswers = {}) {
  const json = (v: object) => `echo '${JSON.stringify(v)}'`;
  return fake(
    "rex",
    `case "$*" in
  *whoami*) ${a.whoami ?? json({ endpoint: ENDPOINT })} ;;
  *client.list*) ${json(a.clients ?? { clients: [] })} ;;
  *session.list*) ${json(a.sessions ?? { sessions: [] })} ;;
  *session.create*) ${json({ session_id: MADE })} ;;
  *session.new_window*) ${a.window ?? json({ window_id: "window:w1", block_ids: [BLOCK], revision: 3 })} ;;
  *terminal.process*) ${json({ child: { pid: 4242, name: "zsh" } })} ;;
  *) exit 1 ;;
esac`,
  );
}

const method = (call: string[]) => call[call.indexOf("call") + (call.includes("-s") ? 3 : 1)];
const argsOf = (call: string[]) => JSON.parse(call.at(-1)!) as Record<string, unknown>;

describe("what a request may hold", () => {
  test("nothing to run, an option or assignment as the program, control characters, a missing folder, a bad name or variable are refused", async () => {
    const refused = async (over: Partial<PlaceRequest>) => openPlace(request(over), tools({ tmux: "/nonexistent/tmux" }), {});
    const bad: Partial<PlaceRequest>[] = [
      { argv: [] },
      { argv: ["-c", "x"] },
      { argv: ["A=b", "x"] },
      { argv: ["claude", "two\nlines"] },
      { folder: "relative/path" },
      { folder: join(dir, "missing") },
      { name: "" },
      { name: "x".repeat(65) },
      { name: "tab\there" },
      { env: { "BAD-KEY": "x" } },
      { env: { KIWI_LAUNCH: "a\rb" } },
    ];
    for (const over of bad) {
      expect(await refused(over)).toMatchObject({ ok: false, why: "bad-request" });
    }
  });
});

describe("the login shell runs the program", () => {
  const shellPart = (argv: string[]) => argv.slice(argv.lastIndexOf("-u") + 2);

  test('env drops the session markers a harness leaves behind and sets the variables, then POSIX shells get exec "$@", fish exec $argv, anything else /bin/sh', () => {
    const zsh = loginArgv("/bin/zsh", ["claude", "hi"], { KIWI_LAUNCH: "l1" });
    expect(zsh[0]).toBe("/usr/bin/env");
    for (const marker of ["CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "CODEX_THREAD_ID", "KIWI_HARNESS", "KIWI_MODEL"]) expect(zsh[zsh.indexOf(marker) - 1]).toBe("-u");
    expect(shellPart(zsh)).toEqual(["KIWI_LAUNCH=l1", "/bin/zsh", "-ilc", 'exec "$@"', "kiwi-launch", "claude", "hi"]);
    expect(shellPart(loginArgv("/opt/homebrew/bin/fish", ["claude"], {}))).toEqual(["/opt/homebrew/bin/fish", "-ilc", "exec $argv", "claude"]);
    expect(shellPart(loginArgv("/usr/bin/nu", ["claude"]))).toEqual(["/bin/sh", "-ilc", 'exec "$@"', "kiwi-launch", "claude"]);
  });

  for (const shell of [bash, zsh]) {
    test.skipIf(!shell)(`${shell ?? "a shell"} passes every argument through unchanged, with the variable set and a parent harness's markers gone`, () => {
      const argv = loginArgv(shell!, ["sh", "-c", 'printf "%s|" "$KIWI_LAUNCH" "${CLAUDECODE-unset}" "${KIWI_HARNESS-unset}" "$@"', "-", "it's", '"b" $c', "a\\b", "*"], { KIWI_LAUNCH: "x y" });
      const env = { HOME: dir, PATH: process.env.PATH ?? "/usr/bin:/bin", ZDOTDIR: dir, CLAUDECODE: "1", KIWI_HARNESS: "codex" };
      const r = spawnSync(argv[0]!, argv.slice(1), { cwd: folder, encoding: "utf8", env });
      expect(r.stdout).toEndWith(`x y|unset|unset|it's|"b" $c|a\\b|*|`);
    });
  }

  test.skipIf(!bash)("Terminal's line goes to the folder and runs the program with the variable set", () => {
    const line = terminalLine(bash!, request({ argv: ["sh", "-c", 'printf "%s|%s|" "$KIWI_LAUNCH" "$1"; pwd', "-", 'it\'s "b" $c'], env: { KIWI_LAUNCH: "x y" } }));
    const r = spawnSync(bash!, ["-c", line], { encoding: "utf8", env: { HOME: dir, PATH: process.env.PATH ?? "/usr/bin:/bin" } });
    expect(r.stdout.split("|").slice(0, 2)).toEqual(["x y", `it's "b" $c`]);
    expect(realpathSync(r.stdout.split("|")[2]!.trim())).toBe(realpathSync(folder));
  });

  test("every variable harness detection reads is dropped, except the terminal's own TERM and NO_COLOR", () => {
    const dropped = new Set(loginArgv("/bin/zsh", ["x"]).flatMap((arg, i, all) => (all[i - 1] === "-u" ? [arg] : [])));
    const read = ["src/seats.ts", "src/card.ts", "src/ancestry.ts"].flatMap((file) =>
      [...readFileSync(join(import.meta.dir, "..", file), "utf8").matchAll(/env\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]!),
    );
    expect(read.length).toBeGreaterThan(10);
    expect(read.filter((key) => !dropped.has(key) && key !== "TERM" && key !== "NO_COLOR")).toEqual([]);
  });

  test("fish's quotes escape backslashes and quotes inside them", () => {
    expect(terminalLine("/usr/bin/fish", request({ folder: "/a'b", argv: ["x\\y"], env: {} }))).toBe("cd '/a\\'b' && exec 'x\\\\y'");
  });
});

describe("Rex", () => {
  test("opens a window in the session Rex.app on this computer is attached to, without focus, through the login shell", async () => {
    const rex = fakeRex({
      clients: {
        clients: [
          { client_id: "c0", info: { kind: "cli" }, session_ids: [OTHER] },
          { client_id: "c1", info: { kind: "app", platform: "ios" }, connected_at: "2026-10-20T16:00:00Z", connection_state: "connected", session_ids: [PHONE] },
          { client_id: "c2", info: { kind: "app", platform: "linux" }, connected_at: "2026-10-20T11:00:00Z", connection_state: "connected", session_ids: [SESSION] },
          { client_id: "c3", info: { kind: "app", platform: "linux" }, connected_at: "2026-10-20T17:00:00Z", connection_state: "lost", session_ids: [OTHER] },
        ],
      },
    });
    const placed = await openPlace(request(), tools({ rex: rex.bin, tmux: "/nonexistent/tmux" }), REX);
    expect(placed).toEqual({ ok: true, place: "rex", rex: { server: ENDPOINT, session: SESSION, block: BLOCK }, window: "window:w1", pid: 4242 });
    const calls = rex.calls();
    expect(calls.every((c) => c.includes("--autostart=false"))).toBe(true);
    expect(calls.slice(1).every((c) => c[0] === "-S" && c[1] === ENDPOINT)).toBe(true);
    const window = calls.find((c) => method(c) === "session.new_window")!;
    expect(argsOf(window)).toEqual({
      session_id: SESSION,
      focus: false,
      window_label: "claude-two",
      layout: {
        block: {
          flavor: "com.superlogical.terminal.shell",
          label: "claude-two",
          options: { shell: "none", login: false, command: loginArgv("/bin/zsh", ["claude", "run kiwi join"], { KIWI_LAUNCH: "l1" }), cwd: folder },
        },
      },
    });
    expect(calls.some((c) => method(c) === "session.create")).toBe(false);
  });

  test("with no app attached it takes the newest session, and with none it makes one", async () => {
    const some = fakeRex({
      sessions: {
        sessions: [
          { session_id: OTHER, label: "a" },
          { session_id: SESSION, label: "b" },
        ],
      },
    });
    expect(await openPlace(request(), tools({ rex: some.bin }), REX)).toMatchObject({ ok: true, rex: { session: SESSION } });
    const none = fakeRex();
    expect(await openPlace(request(), tools({ rex: none.bin }), REX)).toMatchObject({ ok: true, rex: { session: MADE } });
    expect(argsOf(none.calls().find((c) => method(c) === "session.create")!)).toEqual({ label: "kiwi" });
  });

  test("a window Rex refuses is a failure, never a second try somewhere else", async () => {
    const rex = fakeRex({ window: "echo 'conflict: too many windows' >&2; exit 1" });
    const tmux = fake("tmux", "exit 0");
    const placed = await openPlace(request(), tools({ rex: rex.bin, tmux: tmux.bin }), REX);
    expect(placed).toEqual({ ok: false, why: "failed", detail: "Rex session.new_window: conflict: too many windows" });
    expect(tmux.calls()).toEqual([]);
  });
});

describe("which place", () => {
  test("the preferred terminal while its helpers are on and it can open, else Terminal saying why, else tmux; with none, nothing", async () => {
    const up = fakeRex();
    const down = fake("rex-down", "exit 4");
    const tmux = fake("tmux", `printf '/tmp/tmux-1/default\\tkiwi\\t@3\\t%%3\\t777\\n'`);
    const osascript = fake("osascript", "echo 'tab 1 of window id 4711'");
    const mac = (over: Partial<PlaceTools> = {}) => tools({ platform: "darwin", osascript: osascript.bin, tmux: tmux.bin, ...over });
    expect(await placeKind(mac({ rex: up.bin }), REX)).toBe("rex");
    expect(await placeKind(mac({ rex: up.bin }), {})).toBe("terminal");
    expect(await placeKind(mac({ rex: up.bin }), prefers("rex", "off"))).toBe("terminal");
    expect(await placeKind(mac(), prefers("tmux"))).toBe("tmux");
    expect(await placeKind(mac({ osascript: null }), {})).toBe("tmux");
    expect(await placeKind(tools({ rex: up.bin, tmux: tmux.bin }), {})).toBe("tmux");
    expect(await placeKind(tools({ rex: down.bin }), REX)).toBeNull();
    expect(await openPlace(request(), mac({ rex: down.bin }), REX)).toEqual({ ok: true, place: "terminal", window: 4711, instead: "Rex isn't running, so it opened in Terminal" });
    expect(await openPlace(request(), tools({ rex: down.bin, tmux: tmux.bin }), REX)).toEqual({
      ok: true,
      place: "tmux",
      socket: "/tmp/tmux-1/default",
      session: "kiwi",
      window: "@3",
      pane: "%3",
      pid: 777,
      instead: "Rex isn't running, so it opened in tmux",
    });
    expect(await openPlace(request(), tools({ rex: down.bin }), REX)).toEqual({ ok: false, why: "no-place", detail: "No terminal to open: install tmux, or run kiwi join yourself" });
    expect(down.calls().every((c) => c.includes("--autostart=false"))).toBe(true);
  });
});

describe("tmux's own answers", () => {
  test("a missing session is made, a race to make it ends in its window, and any other refusal tries nothing more", async () => {
    const racing = fake(
      "tmux",
      `case "$*" in
  *new-window*) if [ -e '${join(dir, "made")}' ]; then printf '/s\\tkiwi\\t@2\\t%%2\\t5\\n'; else echo "can't find session: kiwi" >&2; exit 1; fi ;;
  *new-session*) : > '${join(dir, "made")}'; echo 'duplicate session: kiwi' >&2; exit 1 ;;
esac`,
    );
    rmSync(join(dir, "made"), { force: true });
    expect(await openPlace(request(), tools({ tmux: racing.bin }), {})).toMatchObject({ ok: true, place: "tmux", window: "@2" });
    expect(racing.calls().every((c) => c[0] === "-u")).toBe(true);
    expect(racing.calls().map((c) => c[1])).toEqual(["new-window", "new-session", "new-window"]);
    const refusing = fake("tmux", "echo 'create window failed: index 3 in use' >&2; exit 1");
    expect(await openPlace(request(), tools({ tmux: refusing.bin }), {})).toEqual({ ok: false, why: "failed", detail: "tmux: create window failed: index 3 in use" });
    expect(refusing.calls()).toHaveLength(1);
  });
});

describe("Terminal.app", () => {
  test("do script gets the line as an argument and the window id comes back", async () => {
    const osascript = fake("osascript", "echo 'tab 1 of window id 4711'");
    const req = request();
    expect(await openPlace(req, tools({ platform: "darwin", osascript: osascript.bin }), {})).toEqual({ ok: true, place: "terminal", window: 4711 });
    const [call] = osascript.calls();
    expect(call!.at(-1)).toBe(terminalLine("/bin/zsh", req));
    const script = call!.filter((a) => a !== "-e").slice(0, -1);
    expect(script.at(0)).toBe("on run argv");
    expect(script).toContain("if (count of windows) > 0 then return do script (item 1 of argv) in window 1");
    expect(script).toContain("return do script (item 1 of argv)");
  });

  test("Automation turned off for the app says where to allow it", async () => {
    const osascript = fake("osascript", "echo 'execution error: Not authorized to send Apple events to Terminal. (-1743)' >&2; exit 1");
    expect(await openPlace(request(), tools({ platform: "darwin", osascript: osascript.bin }), {})).toMatchObject({ ok: false, why: "not-allowed" });
  });
});

describe.skipIf(!hasTmux || !bash)("tmux", () => {
  const socket = () => join(dir, "t");
  const bareTmux = (): string => {
    const wrapper = join(dir, "tmux-bare");
    writeFileSync(wrapper, `#!/bin/sh\nexec '${Bun.which("tmux")}' -f /dev/null "$@"\n`);
    chmodSync(wrapper, 0o755);
    return wrapper;
  };
  afterAll(() => spawnSync("tmux", ["-S", socket(), "kill-server"]));

  test("each launch is a window in the detached session kiwi, in its folder, and the pane's pid is the program's", async () => {
    const t = tools({ shell: bash!, tmux: bareTmux(), socket: socket() });
    const script = 'printf "%s\\n%s\\n" "$KIWI_LAUNCH" "$(pwd)" > "out-$KIWI_LAUNCH"; exec sleep 30';
    const one = await openPlace(request({ argv: ["sh", "-c", script], env: { KIWI_LAUNCH: "one" } }), t, {});
    const two = await openPlace(request({ argv: ["sh", "-c", script], env: { KIWI_LAUNCH: "two" }, name: "claude-three" }), t, {});
    if (!one.ok || one.place !== "tmux" || !two.ok || two.place !== "tmux") throw new Error(`not placed: ${JSON.stringify([one, two])}`);
    expect([realpathSync(dirname(one.socket)), basename(one.socket)]).toEqual([realpathSync(dir), "t"]);
    expect([one.session, two.session]).toEqual(["kiwi", "kiwi"]);
    expect(one.window).not.toBe(two.window);
    const out = join(folder, "out-two");
    for (let i = 0; i < 100 && !existsSync(out); i++) await Bun.sleep(50);
    const [launch, cwd] = readFileSync(out, "utf8").trim().split("\n");
    expect(launch).toBe("two");
    expect(realpathSync(cwd!)).toBe(realpathSync(folder));
    const names = spawnSync("tmux", ["-S", socket(), "list-windows", "-t", "=kiwi:", "-F", "#{window_name}"], { encoding: "utf8" }).stdout.trim().split("\n");
    expect(names).toEqual(["claude-two", "claude-three"]);
    for (let i = 0; i < 100 && spawnSync("ps", ["-o", "comm=", "-p", String(two.pid)], { encoding: "utf8" }).stdout.trim() !== "sleep"; i++) await Bun.sleep(50);
    expect(spawnSync("ps", ["-o", "comm=", "-p", String(two.pid)], { encoding: "utf8" }).stdout.trim()).toBe("sleep");
  });

  test("with no UTF-8 locale, as the app's daemon runs, the window still says which it is", () => {
    const bare = join(dir, "u");
    const script = join(dir, "bare.ts");
    const t = tools({ shell: bash!, tmux: bareTmux(), socket: bare });
    const place = join(import.meta.dir, "..", "src", "launch", "place.ts");
    writeFileSync(
      script,
      `import { openPlace } from ${JSON.stringify(place)};\nconsole.log(JSON.stringify(await openPlace(${JSON.stringify(request({ argv: ["sleep", "30"] }))}, ${JSON.stringify(t)}, {})));\n`,
    );
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "LANG" && !key.startsWith("LC_")));
    try {
      const r = spawnSync(process.execPath, [script], { env, encoding: "utf8" });
      const placed = JSON.parse(r.stdout.trim().split("\n").at(-1) ?? "null") as unknown;
      expect(placed).toMatchObject({ ok: true, place: "tmux", session: "kiwi", window: expect.stringMatching(/^@\d+$/), pane: expect.stringMatching(/^%\d+$/) });
    } finally {
      spawnSync("tmux", ["-S", bare, "kill-server"]);
    }
  });
});
