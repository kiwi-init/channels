
import { kiwiCmd } from "./owner.ts";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(60_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-handoff-relay-"));
const made: string[] = [dataDir];
let server: ReturnType<typeof startRelay> | undefined;
let relay = "";

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
});
afterAll(() => {
  server?.stop(true);
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-handoff-${tag}-`));
  made.push(d);
  return d;
};

function spawn(home: string, args: string[]) {
  return Bun.spawn(kiwiCmd(args), {
    cwd: home,
    env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: relay, KIWI_NO_HOOKS: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function run(home: string, ...args: string[]) {
  const p = spawn(home, args);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}

async function ok(home: string, ...args: string[]): Promise<string> {
  const r = await run(home, ...args);
  if (r.code !== 0) throw new Error(`kiwi ${args.join(" ")} exited ${r.code}: ${r.err}`);
  return r.out;
}

async function until(pred: () => boolean | Promise<boolean>, label: string, ms = 15_000) {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(50);
  }
}

const seqOf = (out: string) => /#(\d+)/.exec(out)![1]!;
import { wellFormed, type Payload } from "../src/protocol.ts";

const LINK = "https://live.example.com/devtools/inspector.html?jwt=SECRET-TOKEN-1234";

const payload = (extra: Record<string, unknown>): Payload =>
  ({ v: 1, id: "x", from: "dev", kind: "blocking", body: "log in", ts: 1, ...extra }) as Payload;

const handoff = (over: Record<string, unknown> = {}) => ({ url: LINK, vendor: "cloudflare", expiresAt: Date.now() + 600_000, ...over });

describe("handoff payload", () => {
  test("only an escalation carries a browser link, and it has to be https without credentials", () => {
    expect(wellFormed(payload({ esc: true, handoff: handoff() }))).toBe(true);
    expect(wellFormed(payload({ handoff: handoff() }))).toBe(false);
    expect(wellFormed(payload({ esc: true, handoff: handoff({ url: "http://live.example.com/x" }) }))).toBe(false);
    expect(wellFormed(payload({ esc: true, handoff: handoff({ url: "https://user:pw@live.example.com/x" }) }))).toBe(false);
    expect(wellFormed(payload({ esc: true, handoff: handoff({ url: `https://live.example.com/${"a".repeat(2100)}` }) }))).toBe(false);
    expect(wellFormed(payload({ esc: true, handoff: handoff({ vendor: "v".repeat(41) }) }))).toBe(false);
    expect(wellFormed(payload({ esc: true, handoff: handoff({ mode: "devtools" }) }))).toBe(false);
    expect(wellFormed(payload({ esc: true, handoff: handoff({ url: "https://live.example.com/a\u202eb" }) }))).toBe(false);
    expect(wellFormed(payload({ esc: true, handoff: handoff({ url: "https://live.example.com/a\nb" }) }))).toBe(false);
    expect(wellFormed(payload({ esc: true, handoff: handoff({ expiresAt: 1e20 }) }))).toBe(false);
  });
});

describe("handoff escalation", () => {
  const owner = scratch("owner");
  const agent = scratch("agent");

  beforeAll(async () => {
    const code = /join code: (\S+)/.exec(await ok(owner, "create", "handoff", "--as", "lead", "--open"))![1]!;
    const p = spawn(agent, ["join", code, "--as", "dev"]);
    let listed = "";
    await until(async () => {
      listed = await ok(owner, "--as", "human", "requests");
      return /\d{3}-\d{3}/.test(listed);
    }, "request");
    await ok(owner, "--as", "human", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes");
    expect(await p.exited).toBe(0);
    await ok(agent, "listen", "--now");
  });

  const newest = async () => {
    const found = [...(await ok(owner, "log")).matchAll(/#(\d+) dev → .*\[escalation\]/g)];
    return Number(found.at(-1)?.[1] ?? 0);
  };

  const waiting = async (args: string[]) => {
    const before = await newest();
    const p = spawn(agent, ["send", "--escalate", "--handoff", LINK, "--wait", "30s", ...args]);
    let seq = "";
    await until(async () => {
      const latest = await newest();
      seq = latest > before ? String(latest) : "";
      return !!seq;
    }, "the escalation");
    return { p, seq };
  };

  test("done ends the wait with 0 and the link stays out of every printed view", async () => {
    const { p, seq } = await waiting(["--expires", "10m", "Log in to GitHub, then press Done"]);
    const log = await ok(owner, "log");
    expect(log).toContain("[browser link]");
    expect(log).not.toContain("SECRET-TOKEN");
    expect(await ok(owner, "show", seq)).not.toContain("SECRET-TOKEN");
    expect(await ok(owner, "--as", "human", "show", seq, "--reveal")).toContain(LINK);
    expect(await ok(owner, "show", seq, "--reveal")).not.toContain(LINK);
    await ok(owner, "reply", seq, "handoff: done");
    expect(await p.exited).toBe(0);
    const printed = await new Response(p.stdout).text();
    expect(printed).toContain("handoff: done");
    expect(printed).not.toContain("SECRET-TOKEN");
    expect(await ok(owner, "listen", "--now", "--all", "--json")).not.toContain("SECRET-TOKEN");
  });

  test("couldn't ends the wait with 4", async () => {
    const { p, seq } = await waiting(["Solve the CAPTCHA"]);
    await ok(owner, "reply", seq, "handoff: failed");
    expect(await p.exited).toBe(4);
  });

  test("a link nobody opens ends the wait with 4 at expiry", async () => {
    const r = await run(agent, "send", "--escalate", "--handoff", LINK, "--expires", "2s", "--wait", "30s", "Accept the terms");
    expect(r.code).toBe(4);
    expect(r.err).toContain("expired");
  });

  test("a wait that ends while the link is open exits 2, not 4", async () => {
    const r = await run(agent, "send", "--escalate", "--handoff", LINK, "--expires", "10m", "--wait", "2s", "Accept the terms");
    expect(r.code).toBe(2);
    expect(r.err).toContain("still open");
  });

  test("the flags are refused where they don't fit", async () => {
    expect((await run(agent, "send", "--escalate", "--handoff", "http://live.example.com/x", "why")).code).toBe(1);
    expect((await run(agent, "send", "--escalate", "--handoff", LINK, "--expires", "2h", "why")).code).toBe(1);
    expect((await run(agent, "send", "--escalate", "--wait", "5s", "why")).code).toBe(1);
    expect((await run(agent, "send", "--handoff", LINK, "hello")).code).toBe(1);
    expect((await run(agent, "send", "--escalate", "--handoff", LINK, "--expires", "0", "why")).code).toBe(1);
  });
});
