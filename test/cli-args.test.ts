import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(30_000);

const home = mkdtempSync(join(tmpdir(), "kiwi-cli-args-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

async function kiwi(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  const p = Bun.spawn(["bun", join(import.meta.dir, "../src/cli/main.ts"), ...args], {
    cwd: home,
    env: { ...process.env, KIWI_HOME: join(home, "kiwi"), KIWI_NO_HOOKS: "1", CLAUDE_CONFIG_DIR: join(home, "claude"), CLAUDECODE: "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}

test("a message that starts with a dash is text, not an option", async () => {
  const r = await kiwi("send", "- first item\n- second item");
  expect(r.err).not.toContain("Unknown option");
  expect(r.err).toContain("no channel");
});

test("send refuses an option it doesn't use before sending anything", async () => {
  const r = await kiwi("send", "--thread", "12", "hello");
  expect(r.code).toBe(1);
  expect(r.err).toContain("kiwi send doesn't take --thread: nothing was sent");
});

test("reply checks its kind and refuses options it doesn't use", async () => {
  expect((await kiwi("reply", "3", "hi", "--room", "ops")).err).toContain("kiwi reply doesn't take --room");
});

test("an option a command never reads is reported, not silently dropped", async () => {
  const r = await kiwi("channels", "--thread", "4");
  expect(r.err).toContain("kiwi: channels doesn't use --thread, so it was ignored");
});
