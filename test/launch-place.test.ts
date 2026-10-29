import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHosted, type Hosted } from "../src/launch/place.ts";
import type { PlaceRequest } from "../src/terminals/plugin.ts";
import { loginArgv } from "../src/terminals/shared/launch.ts";

const bash = Bun.which("bash");
const zsh = Bun.which("zsh");

let dir = "";
let folder = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "kiwi-place-"));
  folder = join(dir, "the work's folder");
  mkdirSync(folder);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const request = (over: Partial<PlaceRequest> = {}): PlaceRequest => ({ argv: ["claude", "run kiwi join"], folder, name: "claude-two", env: { KIWI_LAUNCH: "l1" }, ...over });

const hosted = (why: string | null): Hosted & { opened: PlaceRequest[] } => {
  const opened: PlaceRequest[] = [];
  return {
    opened,
    ready: async () => why,
    open: async (req) => {
      opened.push(req);
      return why ? { ok: false, why: "no-place", detail: why } : { ok: true, place: "hosted", socket: "/tmp/kiwi-1/abc", window: "@5", pane: "%5", pid: 55 };
    },
    pane: () => null,
  };
};

describe("what a request may hold", () => {
  test("nothing to run, an option or assignment as the program, control characters, a missing folder, a bad name or variable are refused before anything opens", async () => {
    const ours = hosted(null);
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
    for (const over of bad) expect(await openHosted(request(over), ours)).toMatchObject({ ok: false, why: "bad-request" });
    expect(ours.opened).toEqual([]);
  });
});

describe("the login shell runs the program", () => {
  const shellPart = (argv: string[]) => argv.slice(argv.lastIndexOf("-u") + 2);

  test('env drops the session markers a harness leaves behind and sets the variables, then POSIX shells get exec "$@", fish exec $argv, anything else /bin/sh', () => {
    const zsh = loginArgv("/bin/zsh", ["claude", "hi"], { KIWI_LAUNCH: "l1" });
    expect(zsh[0]).toBe("/usr/bin/env");
    for (const marker of ["CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "CODEX_THREAD_ID", "KIWI_HARNESS", "KIWI_MODEL", "KIWI_LOOP", "KIWI_LOOP_TASK"]) expect(zsh[zsh.indexOf(marker) - 1]).toBe("-u");
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

  test("every variable harness detection reads is dropped, except the terminal's own TERM and NO_COLOR", () => {
    const dropped = new Set(loginArgv("/bin/zsh", ["x"]).flatMap((arg, i, all) => (all[i - 1] === "-u" ? [arg] : [])));
    const read = ["src/seats.ts", "src/card.ts", "src/ancestry.ts"].flatMap((file) =>
      [...readFileSync(join(import.meta.dir, "..", file), "utf8").matchAll(/env\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]!),
    );
    expect(read.length).toBeGreaterThan(10);
    expect(read.filter((key) => !dropped.has(key) && key !== "TERM" && key !== "NO_COLOR")).toEqual([]);
  });
});

describe("Channels' own tmux", () => {
  test("opens every new agent, and nothing else is tried", async () => {
    const ours = hosted(null);
    expect(await openHosted(request(), ours)).toEqual({ ok: true, place: "hosted", socket: "/tmp/kiwi-1/abc", window: "@5", pane: "%5", pid: 55 });
    expect(ours.opened).toEqual([request()]);
  });

  test("when it can't start, the launch is refused saying why", async () => {
    const none = hosted("hosted agents need tmux 3.2 or newer: install it, or point KIWI_TMUX at one");
    expect(await openHosted(request(), none)).toEqual({ ok: false, why: "no-place", detail: "hosted agents need tmux 3.2 or newer: install it, or point KIWI_TMUX at one" });
  });
});
