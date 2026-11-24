import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { externalUrl, type ExternalUrl } from "../desktop/src/guard.ts";
import { openInBrowser } from "../desktop/src/open.ts";
import { spawnOwned } from "./owned.ts";

const dir = mkdtempSync(join(tmpdir(), "kiwi-open-child-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const NOISE = "head -c 6800 /dev/zero | tr '\\0' x >&2; echo >&2";

function opener(name: string, body: string): Record<string, string> {
  const bin = join(dir, name);
  mkdirSync(bin);
  writeFileSync(join(bin, "xdg-open"), `#!/bin/sh\n${body}\n`);
  chmodSync(join(bin, "xdg-open"), 0o755);
  return { PATH: `${bin}:/usr/bin:/bin`, HOME: dir };
}

function web(url: string): ExternalUrl {
  const checked = externalUrl(url);
  if (!checked) throw new Error(`${url} is not a web link`);
  return checked;
}

const open = (env: Record<string, string>, stillOpeningMs?: number) => openInBrowser(web("https://example.com/r"), async () => {}, "linux", env, undefined, stillOpeningMs);

async function statusOf(file: string, withinMs: number): Promise<string> {
  const until = performance.now() + withinMs;
  const written = () => (existsSync(file) ? readFileSync(file, "utf8").trim() : "");
  while (written() === "" && performance.now() < until) await Bun.sleep(50);
  return written() || "never wrote: killed by SIGPIPE";
}

describe.skipIf(process.platform !== "linux")("a real xdg-open's stderr and pipes (#2534)", () => {
  test("after 6.8 KB of noise, the reason is still the final stderr line", async () => {
    const env = opener("noisy", `${NOISE}\necho "actual final reason" >&2\nexit 3`);
    await expect(open(env)).rejects.toThrow(/^xdg-open couldn't open the link: exit 3: actual final reason$/);
  });

  test("KDE's branch, then 6.8 KB of noise, then the missing kfmclient still fails at exit 0", async () => {
    const env = opener("kde-noisy", `echo "Selected DE kde" >&2\n${NOISE}\necho "/usr/bin/xdg-open: line 757: kfmclient: command not found" >&2\nexit 0`);
    await expect(open(env)).rejects.toThrow("isn't installed: /usr/bin/xdg-open: line 757: kfmclient: command not found");
  });

  test("a reason written just after the opener exits is still collected", async () => {
    const env = opener("late", `(sleep 0.1; echo "late reason" >&2) &\nexit 3`);
    await expect(open(env)).rejects.toThrow("exit 3: late reason");
  });

  test("a descendant that keeps the opener's stderr open neither delays the answer nor keeps the app alive", async () => {
    const env = opener("held", "sleep 3 &\nexit 0");
    const started = performance.now();
    await expect(open(env)).resolves.toBeUndefined();
    expect(performance.now() - started).toBeLessThan(1_000);
    const script = `import { openInBrowser } from ${JSON.stringify(resolve(import.meta.dir, "../desktop/src/open.ts"))};
await openInBrowser("https://example.com/r", async () => {}, "linux", ${JSON.stringify(env)});`;
    const app = spawnOwned([process.execPath, "-e", script], { stdout: "ignore", stderr: "pipe" });
    const appStarted = performance.now();
    const code = await app.exited;
    expect({ code, stderr: await new Response(app.stderr).text() }).toEqual({ code: 0, stderr: "" });
    expect(performance.now() - appStarted).toBeLessThan(2_000);
  });

  test("a browser xdg-open still waits on past the bound can write to stderr afterwards and lives on", async () => {
    const status = join(dir, "foreground.status");
    const env = opener("foreground", `sleep 0.6\necho "browser says something" >&2\necho "wrote $?" > ${status}`);
    await expect(open(env, 200)).resolves.toBeUndefined();
    expect(await statusOf(status, 3_000)).toBe("wrote 0");
  });

  test("a browser left running after xdg-open exits can write to stderr afterwards and lives on", async () => {
    const status = join(dir, "left.status");
    const env = opener("left", `(sleep 0.6; echo "browser says something" >&2; echo "wrote $?" > ${status}) &\nexit 0`);
    await expect(open(env)).resolves.toBeUndefined();
    expect(await statusOf(status, 3_000)).toBe("wrote 0");
  });
});
