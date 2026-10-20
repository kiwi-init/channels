import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { KNOWN_HARNESSES, readHarnessRow } from "@kiwi/core/harnesses.ts";
import { daemonHarnesses, startDaemon, type Daemon } from "../src/daemon.ts";
import { harnessInventory, inventoryText, versionIn, wakeOf } from "../src/launch/harnesses.ts";
import { loginShell, passwdShell, pathAfterMark, readLoginPath } from "../src/launch/shell.ts";

setDefaultTimeout(30_000);

const root = mkdtempSync(join(tmpdir(), "kiwi-harnesses-"));
const prevHome = process.env.KIWI_HOME;
const prevShell = process.env.SHELL;

function script(dir: string, name: string, body: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

function fakeShell(name: string, before: string, path: string): string {
  return script(join(root, "shells"), name, `[ "$1" = "-ilc" ] || exit 3\n${before}\nPATH='${path}'; export PATH\nexec /bin/sh -c "$2"`);
}

afterAll(() => {
  if (prevHome === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = prevHome;
  if (prevShell === undefined) delete process.env.SHELL;
  else process.env.SHELL = prevShell;
  rmSync(root, { recursive: true, force: true });
});

describe("the login shell's PATH", () => {
  test("is the line after the last mark, whatever the shell's profile printed around it", () => {
    expect(pathAfterMark("Welcome!\n__kiwi_login_path__\n/a:/b\nbye\n")).toBe("/a:/b");
    expect(pathAfterMark("__kiwi_login_path__\n/old\n__kiwi_login_path__\r\n/a:/b\r\n")).toBe("/a:/b");
    expect(pathAfterMark("__kiwi_login_path__\n/a:/b")).toBeNull();
    expect(pathAfterMark("no mark\n/a:/b\n")).toBeNull();
  });

  test("is read from an interactive login shell, past what its profile prints", async () => {
    const shell = fakeShell("chatty", "echo 'Last login: today'; echo motd >&2", "/from/zshrc:/usr/bin:/bin");
    expect(await readLoginPath(shell)).toBe("/from/zshrc:/usr/bin:/bin");
  });

  test("comes back as soon as it's printed, even while the profile left something running on its output", async () => {
    const shell = fakeShell("lingering", "(sleep 2; echo late) &", "/lingering:/usr/bin:/bin");
    const started = Date.now();
    expect(await readLoginPath(shell)).toBe("/lingering:/usr/bin:/bin");
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  test("is null when the shell hangs, fails or isn't there", async () => {
    const hangs = script(join(root, "shells"), "hangs", "exec sleep 30");
    const started = Date.now();
    expect(await readLoginPath(hangs, process.env, 300)).toBeNull();
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(await readLoginPath(script(join(root, "shells"), "fails", "exit 1"))).toBeNull();
    expect(await readLoginPath(join(root, "shells", "missing"))).toBeNull();
  });

  test("the login shell is $SHELL, else the account's own from the directory, not Bun's echo of $SHELL", () => {
    expect(loginShell({ SHELL: "/opt/fish" })).toBe("/opt/fish");
    for (const env of [{}, { SHELL: "zsh" }, { SHELL: "" }]) {
      const shell = loginShell(env);
      expect(isAbsolute(shell)).toBe(true);
      expect(existsSync(shell)).toBe(true);
    }
  });

  test("an account's shell is read from dscl on macOS and from getent elsewhere", () => {
    expect(passwdShell("darwin", "UserShell: /bin/zsh\n")).toBe("/bin/zsh");
    expect(passwdShell("darwin", "No such key: UserShell\n")).toBeNull();
    expect(passwdShell("linux", "runner:x:1001:118::/home/runner:/bin/bash\n")).toBe("/bin/bash");
    expect(passwdShell("linux", "runner:x:1001:118::/home/runner:bash\n")).toBeNull();
    expect(passwdShell("linux", "")).toBeNull();
  });
});

describe("the harness inventory", () => {
  const bins = join(root, "bins");
  const more = join(root, "more");
  const runs = join(root, "codex-runs");

  beforeAll(() => {
    script(bins, "claude", "echo '2.0.1 (Claude Code)'");
    script(bins, "codex", `echo run >> '${runs}'\necho 'codex-cli 0.163.0'`);
    script(bins, "agent", "echo 'grok 1.0.62 (1474f9cbdd91) [stable]'");
    script(bins, "kimi-code", "echo 'kimi, version 1.4.0' >&2");
    writeFileSync(join(bins, "gemini"), "not runnable");
    script(more, "agent", "echo '2026.01.02-abc123'");
    script(bins, "kimi", "echo 'kimi, version 0.9.0'");
    script(join(root, "cln"), "pi", "echo 'pi (cln) 1.3.6'");
    script(join(root, "pi-bare"), "pi", "echo '0.73.1'");
    script(join(root, "node_modules", "@mariozechner", "pi-coding-agent", "dist"), "cli.js", "echo 'Debugger attached.'; echo 0.73.1");
    mkdirSync(join(root, "pi-npm"), { recursive: true });
    symlinkSync(join(root, "node_modules", "@mariozechner", "pi-coding-agent", "dist", "cli.js"), join(root, "pi-npm", "pi"));
  });

  test("finds each harness on the PATH it's given, with its version, and lists the missing ones", async () => {
    const rows = await harnessInventory(`${bins}:/usr/bin:/bin`);
    expect(rows.map((r) => r.harness)).toEqual([...KNOWN_HARNESSES]);
    const by = Object.fromEntries(rows.map((r) => [r.harness, r]));
    expect(by.claude).toMatchObject({ path: join(bins, "claude"), version: "2.0.1" });
    expect(by.codex).toMatchObject({ path: join(bins, "codex"), version: "0.163.0", wake: "codex-queue", why: null });
    expect(by.kimi).toMatchObject({ path: join(bins, "kimi-code"), version: "1.4.0" });
    expect(by.grok).toMatchObject({ path: null });
    expect(by.gemini).toMatchObject({ path: null, version: null });
    expect(by.pi).toMatchObject({ path: null, version: null });
  });

  test("takes agent as Cursor's only when it isn't Grok Build's", async () => {
    const grokOnly = await harnessInventory(`${bins}:/usr/bin:/bin`);
    expect(grokOnly.find((r) => r.harness === "cursor")).toMatchObject({ path: null });
    const both = await harnessInventory(`${bins}:${more}:/usr/bin:/bin`);
    expect(both.find((r) => r.harness === "cursor")).toMatchObject({ path: join(more, "agent"), version: "2026.01.02-abc123" });
  });

  test("a generic name counts only when it prints a bare version or lives in its harness's package", async () => {
    const pi = async (dir: string) => (await harnessInventory(`${join(root, dir)}:/usr/bin:/bin`)).find((r) => r.harness === "pi");
    expect(await pi("cln")).toMatchObject({ path: null });
    expect(await pi("pi-bare")).toMatchObject({ path: join(root, "pi-bare", "pi"), version: "0.73.1" });
    expect(await pi("pi-npm")).toMatchObject({ path: join(root, "pi-npm", "pi"), version: "0.73.1" });
    const both = await harnessInventory(`${join(root, "cln")}:${join(root, "pi-bare")}:/usr/bin:/bin`);
    expect(both.find((r) => r.harness === "pi")).toMatchObject({ path: join(root, "pi-bare", "pi") });
  });

  test("asks a binary its version once, and again once the binary changes", async () => {
    writeFileSync(runs, "");
    await harnessInventory(`${bins}:/usr/bin:/bin`);
    await harnessInventory(`${bins}:/usr/bin:/bin`);
    expect(readFileSync(runs, "utf8")).toBe("");
    script(bins, "codex", `echo run >> '${runs}'\necho 'codex-cli 0.164.0'`);
    const rows = await harnessInventory(`${bins}:/usr/bin:/bin`);
    expect(rows.find((r) => r.harness === "codex")?.version).toBe("0.164.0");
    expect(readFileSync(runs, "utf8")).toBe("run\n");
  });

  test("says whether Kiwi can wake a session started now, and why not", () => {
    expect(wakeOf("claude", "2.1.304")).toEqual({ wake: "hooks", why: null });
    expect(wakeOf("claude", null)).toEqual({ wake: "hooks", why: null });
    expect(wakeOf("claude", "2.0.1")).toEqual({ wake: null, why: "Claude Code 2.0.1 is older than 2.1.296, the first Kiwi can wake" });
    expect(wakeOf("opencode", "2.1.0")).toEqual({ wake: "opencode-api", why: null });
    expect(wakeOf("pi", null)).toEqual({ wake: "pi-extension", why: null });
    expect(wakeOf("mimo", null)).toEqual({ wake: "mimo-plugin", why: null });
    expect(wakeOf("kimi", null).wake).toBeNull();
    expect(wakeOf("kimi", null).why).toContain("kimi web");
    expect(wakeOf("gemini", null)).toMatchObject({ wake: null, why: expect.stringContaining("Gemini CLI") });
    expect(wakeOf("grok", null).wake).toBeNull();
    expect(wakeOf("cursor", null).wake).toBeNull();
  });

  test("reads versions as harnesses print them", () => {
    expect(versionIn("2.1.304 (Claude Code)")).toBe("2.1.304");
    expect(versionIn("codex-cli 0.163.0")).toBe("0.163.0");
    expect(versionIn("grok 1.0.62 (1474f9cbdd91) [stable]")).toBe("1.0.62");
    expect(versionIn("opencode v2.1.0")).toBe("2.1.0");
    expect(versionIn("no version here")).toBeNull();
  });

  test("prints one line per harness", async () => {
    const text = inventoryText(await harnessInventory(`${bins}:/usr/bin:/bin`));
    expect(text).toContain(`codex: 0.164.0 at ${join(bins, "codex")}; Kiwi wakes it via codex queue`);
    expect(text).toContain("claude: 2.0.1 at");
    expect(text).toContain("Kiwi can't wake it: Claude Code 2.0.1 is older than 2.1.296");
    expect(text).toContain("gemini: not installed");
  });

  test("a row from the daemon keeps what checks out and drops what doesn't", () => {
    expect(readHarnessRow({ harness: "codex", path: "/bin/codex", version: "1.0.0", wake: "codex-queue", why: null })).toEqual({
      harness: "codex",
      path: "/bin/codex",
      version: "1.0.0",
      wake: "codex-queue",
      why: null,
    });
    expect(readHarnessRow({ harness: "codex", path: 3, version: "", wake: "carrier-pigeon", why: "x" })).toEqual({ harness: "codex", path: null, version: null, wake: null, why: "x" });
    expect(readHarnessRow({ harness: "grok-bot" })).toBeNull();
    expect(readHarnessRow("codex")).toBeNull();
  });
});

describe("the daemon's harnesses verb", () => {
  let daemon: Daemon | undefined;

  beforeAll(async () => {
    process.env.KIWI_HOME = join(root, "home");
    process.env.SHELL = fakeShell("daemon-login", "", `${join(root, "bins")}:/usr/bin:/bin`);
    daemon = await startDaemon();
  });

  afterAll(async () => {
    await daemon?.stop().catch(() => {});
  });

  test("answers with the inventory from the login shell's PATH", async () => {
    const rows = await daemonHarnesses();
    expect(rows.map((r) => r.harness)).toEqual([...KNOWN_HARNESSES]);
    expect(rows.find((r) => r.harness === "claude")).toMatchObject({ path: join(root, "bins", "claude"), version: "2.0.1", wake: null });
    expect(rows.find((r) => r.harness === "gemini")).toMatchObject({ path: null });
  });
});
