import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HANDLE, youAre, created, joinSeats } from "./join-seats-setup.ts";

setDefaultTimeout(60_000);

const { scratch, spawn, run, ok, until, join_ } = joinSeats();

describe("review fixes (#1352)", () => {
  test("a join that died while waiting: running it again after the approval takes the name the owner's side gave", async () => {
    const owner = scratch("own6");
    const code = created(await ok(owner, ["create", "rerun", "--as", "boss"]));
    await join_(owner, scratch("first"), code, { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "f", CLAUDE_PID: String(process.pid) });
    const b = scratch("died");
    const S = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "d", CLAUDE_PID: String(process.pid) };
    // It asks, shows its code, and its shell gives up before the owner gets to it.
    const p = spawn(b, ["join", code, "--timeout", "4s"], S);
    let listed = "";
    await until(async () => {
      listed = await ok(owner, ["--as", "human", "requests"]);
      return /\d{3}-\d{3}/.test(listed);
    }, "request with a code");
    expect(await p.exited).toBe(3);
    const asked = /asked to join as (\S+)\./.exec(await new Response(p.stdout).text())![1]!;
    expect(listed).toContain(asked);
    await ok(owner, ["--as", "human", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes"]);
    const again = await run(b, ["join", code, "--timeout", "5s"], S);
    expect(again.code).toBe(0);
    expect(youAre(again.out)).toBe(asked);
    const room = readdirSync(join(b, "identities"))[0]!;
    expect(readdirSync(join(b, "identities", room))).toEqual([`${asked}.json`]);
    expect(await ok(b, ["status"], S)).toContain(`${asked} (you)`);
  });

  test("two live Codex sessions in one folder: the second isn't the first, and joins under its own handle", async () => {
    const owner = scratch("own7");
    const code = created(await ok(owner, ["create", "codex", "--as", "boss"]));
    const h = scratch("codex");
    const T1 = { CODEX_THREAD_ID: "t1" };
    const T2 = { CODEX_THREAD_ID: "t2" };
    const one = youAre((await join_(owner, h, code, T1)).out);
    const refused = await run(h, ["send", "who am i"], T2);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("in another session");
    const two = youAre((await join_(owner, h, code, T2)).out);
    expect(two).not.toBe(one);
    await ok(h, ["send", "from t1"], T1);
    await ok(h, ["send", "from t2"], T2);
    const log = await ok(owner, ["log"]);
    expect(log).toContain(`${one} (codex) → all: from t1`);
    expect(log).toContain(`${two} (codex) → all: from t2`);
  });

  test("an agent of a harness kiwi can't tell is never taken for the one already seated in its folder", async () => {
    const owner = scratch("own10");
    const code = created(await ok(owner, ["create", "unknown", "--as", "boss"]));
    const h = scratch("unknown");
    const PLAIN = { CLAUDECODE: "" };
    const first = youAre((await join_(owner, h, code, PLAIN)).out);
    expect(first).toMatch(HANDLE);
    const again = await run(h, ["join", code], PLAIN);
    expect(again.code).toBe(2);
    expect(again.err).toContain(`this folder already has ${first}'s seat`);
    expect(again.err).toContain(`kiwi join ${code} --as ${first}`);
    expect((await join_(owner, h, code, PLAIN, h, ["--as", "glm"])).out).toContain('You\'re "glm"');
    const cfg = JSON.parse(readFileSync(join(h, "config.json"), "utf8")) as { bindings?: Record<string, { as: string } | { as: string }[]> };
    const seated = Object.values(cfg.bindings ?? {})
      .flatMap((v) => (Array.isArray(v) ? v : [v]))
      .map((b) => b.as);
    expect(seated.sort()).toEqual([first, "glm"].sort());
    await ok(h, ["--as", first, "send", "from agent"], PLAIN);
    await ok(h, ["--as", "glm", "send", "from glm"], PLAIN);
    const log = await ok(owner, ["log"]);
    expect(log).toContain(`${first} (agent) → all: from agent`);
    expect(log).toContain("glm → all: from glm");
  });

  test("an agent of another harness never takes a folder's only seat", async () => {
    const owner = scratch("own11");
    const code = created(await ok(owner, ["create", "mixed", "--as", "boss"]));
    const h = scratch("mixed");
    const codex = youAre((await join_(owner, h, code, { CODEX_THREAD_ID: "t1", CLAUDECODE: "" })).out);
    const gemini = youAre((await join_(owner, h, code, { GEMINI_CLI: "1", CLAUDECODE: "" })).out);
    expect(gemini).not.toBe(codex);
    const status = await ok(owner, ["status"]);
    expect(status).toContain(`${codex} · nickname codex`);
    expect(status).toContain(`${gemini} · nickname gemini`);
  });

  test("two agents of one machine let in at once never lose each other's keys", async () => {
    const owner = scratch("own9");
    const code = created(await ok(owner, ["create", "keys", "--as", "boss"]));
    await join_(owner, scratch("remote"), code, { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "rm", CLAUDE_PID: String(process.pid) });
    const h = scratch("twokeys");
    const d2 = join(h, "two");
    const d3 = join(h, "three");
    mkdirSync(d2);
    mkdirSync(d3);
    const procs = [Bun.spawn(["sleep", "120"]), Bun.spawn(["sleep", "120"])];
    const S2 = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "s2", CLAUDE_PID: String(procs[0]!.pid) };
    const S3 = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "s3", CLAUDE_PID: String(procs[1]!.pid) };
    try {
      const j2 = spawn(h, ["join", code, "--timeout", "40s"], S2, d2);
      await until(async () => (await ok(owner, ["--as", "human", "requests"])).includes(" "), "first request");
      const j3 = spawn(h, ["join", code, "--timeout", "40s"], S3, d3);
      let listed = "";
      await until(async () => {
        listed = await ok(owner, ["--as", "human", "requests"]);
        return (listed.match(/\d{3}-\d{3}/g) ?? []).length === 2;
      }, "both requests with codes");
      for (const c of listed.match(/\d{3}-\d{3}/g)!) await ok(owner, ["--as", "human", "approve", c, "--yes"]);
      expect(await j2.exited).toBe(0);
      expect(await j3.exited).toBe(0);
      const two = youAre(await new Response(j2.stdout).text());
      const three = youAre(await new Response(j3.stdout).text());
      expect(two).not.toBe(three);
      await ok(h, ["send", "two here"], S2, d2);
      await ok(h, ["send", "three here"], S3, d3);
      const log = await ok(owner, ["log"]);
      expect(log).toContain(`${two} (claude) → all: two here`);
      expect(log).toContain(`${three} (claude) → all: three here`);
      const room = readdirSync(join(h, "identities"))[0]!;
      expect(readdirSync(join(h, "identities", room)).sort()).toEqual([`${two}.json`, `${three}.json`].sort());
    } finally {
      for (const p of procs) p.kill();
    }
  });

  test("two joins at once on one machine ask under different names", async () => {
    const owner = scratch("own8");
    const code = created(await ok(owner, ["create", "race", "--as", "boss"]));
    const h = scratch("race");
    const d1 = join(h, "one");
    const d2 = join(h, "two");
    mkdirSync(d1);
    mkdirSync(d2);
    const [a, b] = await Promise.all([
      run(h, ["join", code, "--timeout", "3s"], { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "r1", CLAUDE_PID: String(process.pid) }, d1),
      run(h, ["join", code, "--timeout", "3s"], { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "r2", CLAUDE_PID: String(process.pid) }, d2),
    ]);
    const asked = [a.out, b.out].map((o) => /asked to join as (\S+)\./.exec(o)?.[1] ?? "");
    for (const n of asked) expect(n).toMatch(HANDLE);
    expect(asked[0]).not.toBe(asked[1]);
  });
});
