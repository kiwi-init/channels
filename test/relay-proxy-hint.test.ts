import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trustProxyHint, untrustedProxy } from "../src/relay/address.ts";

test("a peer sending X-Forwarded-For that isn't trusted is named, once its header has anything in it", () => {
  expect(untrustedProxy("127.0.0.1", "203.0.113.9", false)).toBe("127.0.0.1");
  expect(untrustedProxy("::ffff:172.17.0.1", "203.0.113.9", ["10.0.0.0/8"])).toBe("172.17.0.1");
  expect(untrustedProxy("127.0.0.1", "203.0.113.9", true)).toBeNull();
  expect(untrustedProxy("172.17.0.1", "203.0.113.9", ["172.17.0.1"])).toBeNull();
  expect(untrustedProxy("127.0.0.1", "  ", false)).toBeNull();
  expect(untrustedProxy("127.0.0.1", null, false)).toBeNull();
  expect(untrustedProxy("not an ip", "203.0.113.9", false)).toBeNull();
});

test("the hint names the flag and the variable that would trust that peer", () => {
  expect(trustProxyHint("127.0.0.1")).toContain("start the relay with --trust-proxy (or KIWI_TRUST_PROXY=1)");
  expect(trustProxyHint("172.17.0.1")).toContain("start the relay with --trust-proxy 172.17.0.1 (or KIWI_TRUST_PROXY=172.17.0.1)");
});

const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

async function relayLog(trust: string[]): Promise<string> {
  const data = mkdtempSync(join(tmpdir(), "kiwi-proxy-hint-"));
  made.push(data);
  const relay = Bun.spawn(["bun", "src/relay/bun.ts", "--hostname", "127.0.0.1", "--port", "0", "--data", data, "--no-web", ...trust], {
    cwd: join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    const reader = relay.stdout.getReader();
    let out = "";
    while (!/listening on http:\/\/127\.0\.0\.1:(\d+)\//.test(out)) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`the relay stopped before listening: ${out}`);
      out += new TextDecoder().decode(value);
    }
    const port = /listening on http:\/\/127\.0\.0\.1:(\d+)\//.exec(out)![1];
    for (let i = 0; i < 3; i++) await fetch(`http://127.0.0.1:${port}/v1/nowhere`, { headers: { "x-forwarded-for": `203.0.113.${i}` } });
  } finally {
    relay.kill();
  }
  await relay.exited;
  return new Response(relay.stderr).text();
}

test("behind a proxy it doesn't trust, the relay says so once, with what to pass; trusting it, it says nothing", async () => {
  const untrusted = await relayLog([]);
  expect(untrusted.split("\n").filter((l) => l.includes("isn't a trusted proxy"))).toEqual([trustProxyHint("127.0.0.1")]);
  expect(await relayLog(["--trust-proxy"])).not.toContain("isn't a trusted proxy");
}, 30_000);
