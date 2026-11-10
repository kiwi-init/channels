import { spawn } from "node:child_process";
import path from "node:path";
import type { Duplex } from "node:stream";
import { describe, expect, test } from "bun:test";

const CHILD = path.join(import.meta.dir, "fixtures", "launcher-wait.ts");
const PROMPT_MS = 600;

function waitingOnPrompt(): Promise<{ inTime: boolean; ticks: number; key: string | null }> {
  return new Promise((done, failed) => {
    const child = spawn(process.execPath, [CHILD], { stdio: ["ignore", "pipe", "inherit", "pipe"], env: { ...process.env, KIWI_KEY_FD: "3" } });
    const launcher = child.stdio[3] as Duplex;
    let asked = "";
    launcher.on("data", (d: Buffer) => {
      asked += d.toString("latin1");
      if (asked !== "get\n") return;
      asked = "";
      setTimeout(() => launcher.write(`key ${Buffer.from("the store key", "utf8").toString("base64")}\n`), PROMPT_MS);
    });
    let out = "";
    child.stdout?.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.on("error", failed);
    child.on("exit", (code) => {
      try {
        done(JSON.parse(out) as { inTime: boolean; ticks: number; key: string | null });
      } catch {
        // The child printed no report: say how it ended instead of a JSON error.
        failed(new Error(`the child ended with ${code} and said ${JSON.stringify(out)}`));
      }
    });
  });
}

describe("waiting for the launcher's keychain answer (T1762)", () => {
  test("the main thread keeps running while the launcher waits on a keychain prompt, so the 2 s grace can fire and the window can say it's waiting", async () => {
    const got = await waitingOnPrompt();
    expect(got.key).toBe("the store key");
    expect(got.inTime).toBe(false);
    expect(got.ticks).toBeGreaterThan(PROMPT_MS / 10 / 3);
  }, 15_000);
});
