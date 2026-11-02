// Joining without busywork: no --as (agents are called by what they run in, made unique by the
// owner's side), a seat per agent in its checkout (no -c/--as afterwards, two agents in one checkout
// each act as themselves, a restart takes its seat back), and Claude Code's hooks doing the listening.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { daemonListening, daemonSock } from "../src/daemon.ts";
import { HANDLE, youAre, created, joinSeats } from "./join-seats-setup.ts";

setDefaultTimeout(60_000);

const { scratch, spawn, run, ok, until, join_ } = joinSeats();

describe("joining without --as", () => {
  test("agents join under a random handle, nicknamed after what they run in, so two Claudes never clash and nothing is a RECLAIM", async () => {
    const owner = scratch("own");
    const code = created(await ok(owner, ["create", "names", "--as", "boss"]));
    const a = scratch("a");
    const b = scratch("b");
    const first = await join_(owner, a, code, { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "sa", CLAUDE_PID: String(process.pid) });
    const one = youAre(first.out);
    expect(one).toMatch(HANDLE);
    expect(first.out).toContain('in channel "names"');
    await until(async () => (await daemonListening(daemonSock(a)).catch(() => [])).some((s) => s.agent === one), "the joiner's daemon holding its seat");

    const second = await join_(owner, b, code, { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "sb", CLAUDE_PID: String(process.pid) });
    const two = youAre(second.out);
    expect(two).toMatch(HANDLE);
    expect(two).not.toBe(one);
    expect(second.asked).toContain(two);
    expect(second.asked).not.toContain("RECLAIM");
    expect(second.out).toContain(`asked to join as ${two}.`);
    const room = readdirSync(join(b, "identities"))[0]!;
    expect(readdirSync(join(b, "identities", room))).toEqual([`${two}.json`]);
    await ok(b, ["send", "hello from b"], { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "sb", CLAUDE_PID: String(process.pid) });
    expect(await ok(owner, ["log"])).toContain(`${two} (claude) → `);
    const status = await ok(owner, ["status"]);
    expect(status).toContain(`${one} · nickname claude`);
    expect(status).toContain(`${two} · nickname claude`);
    expect(second.out.split("\n").filter(Boolean).length).toBeLessThan(13);
  });

  test("two agents in one checkout each act as themselves; a restart takes its seat back", async () => {
    const owner = scratch("own2");
    const code = created(await ok(owner, ["create", "shared", "--as", "boss"]));
    const h = scratch("same");
    // A's Claude Code is a process that's running for now.
    const aProcess = Bun.spawn(["sleep", "120"]);
    const A = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "A", CLAUDE_PID: String(aProcess.pid) };
    const B = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "B", CLAUDE_PID: String(process.pid) };
    const a = youAre((await join_(owner, h, code, A)).out);
    const b = await join_(owner, h, code, B);
    const bName = youAre(b.out);
    expect(bName).not.toBe(a);
    expect(b.err).not.toContain("not rebinding");

    await ok(h, ["send", "from B"], B);
    expect(await ok(owner, ["log"])).toContain(`${bName} (claude) → all: from B`);

    aProcess.kill();
    await aProcess.exited;
    const A2 = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "A2", CLAUDE_PID: String(process.ppid) };
    await ok(h, ["send", "from A2"], A2);
    expect(await ok(owner, ["log"])).toContain(`${a} (claude) → all: from A2`);
    const again = await run(h, ["join", code, "--timeout", "5s"], A2);
    expect(again.code).toBe(0);
    expect(again.out).toContain("resumed");
    expect(youAre(again.out)).toBe(a);

    // A third live Claude Code that never joined isn't anyone here. (The same process under a new
    // session id, after /clear, is still the same agent: that's why it's a different process here.)
    const cProcess = Bun.spawn(["sleep", "120"]);
    const C = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "C", CLAUDE_PID: String(cProcess.pid) };
    const refused = await run(h, ["send", "who am i"], C);
    cProcess.kill();
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("in another session");
  });

  test("two Gemini CLIs in one checkout, both running, join as two agents: each is told apart by its own process", async () => {
    const owner = scratch("own-gem");
    const code = created(await ok(owner, ["create", "gems", "--as", "boss"]));
    const h = scratch("gem");
    const bin = scratch("gem-bin");
    symlinkSync(process.execPath, join(bin, "gemini"));
    const cli = join(bin, "gemini-cli.ts");
    writeFileSync(cli, "const child = Bun.spawn(process.argv.slice(2), { stdout: 'inherit', stderr: 'inherit' });\nconsole.log(`joined: ${await child.exited}`);\nsetInterval(() => {}, 60_000);\n");
    const running: Bun.Subprocess[] = [];
    const gemini = async (): Promise<string> => {
      const p = spawn(h, ["join", code, "--timeout", "40s"], { GEMINI_CLI: "1" }, h, undefined, [join(bin, "gemini"), cli]);
      running.push(p);
      let out = "";
      void (async () => {
        for await (const chunk of p.stdout) out += new TextDecoder().decode(chunk);
      })();
      await until(() => out.includes("waiting for the owner") || out.includes("joined: "), "the join asking, or ending");
      if (out.includes("waiting for the owner")) {
        let listed = "";
        await until(async () => /\d{3}-\d{3}/.test((listed = await ok(owner, ["--as", "human", "requests"]))), "the request listed with its code");
        await ok(owner, ["--as", "human", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes"]);
      }
      await until(() => out.includes("joined: "), "the join ending");
      return out;
    };
    try {
      const first = await gemini();
      const second = await gemini();
      expect(second).not.toContain("resumed");
      expect(youAre(second)).not.toBe(youAre(first));
    } finally {
      for (const p of running) p.kill();
    }
  });

  test("running the same join again while it waits asks once, under the same name", async () => {
    const owner = scratch("own3");
    const code = created(await ok(owner, ["create", "again", "--as", "boss"]));
    const h = scratch("again");
    const S = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "S", CLAUDE_PID: String(process.pid) };
    const first = await run(h, ["join", code, "--timeout", "2s"], S);
    expect(first.code).toBe(3);
    const second = await run(h, ["join", code, "--timeout", "2s"], S);
    expect(second.code).toBe(3);
    const asked = /asked to join as (\S+)\./.exec(first.out)![1]!;
    expect(asked).toMatch(HANDLE);
    expect(second.out).toContain(`asked to join as ${asked}.`);
    const listed = await ok(owner, ["--as", "human", "requests"]);
    expect(listed.match(/^\S+\s+[a-z]+-[a-z]+ /gm)?.length).toBe(1);
    expect(listed).toContain(` ${asked} `);
  });
});

describe("a harness started from another harness's session", () => {
  test("a Codex hook run from inside a Claude Code session is Codex's: it serves no Claude seat and leaves its messages unread", async () => {
    const owner = scratch("own12");
    const code = created(await ok(owner, ["create", "nested", "--as", "boss"]));
    const h = scratch("nested");
    const C = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "sc", CLAUDE_PID: String(process.pid) };
    const me = youAre((await join_(owner, h, code, C)).out);
    await ok(owner, ["send", "--to", me, "for the Claude session only"]);
    const review = join(h, "review");
    mkdirSync(review);
    const nested = { ...C, CODEX_THREAD_ID: "cx" };
    const codexInput = JSON.stringify({ session_id: "cx", cwd: review, hook_event_name: "UserPromptSubmit" });
    const codex = await run(h, ["--harness", "codex", "hook", "prompt"], nested, review, codexInput);
    expect(codex.code).toBe(0);
    expect(codex.out).toBe("");
    const stop = await run(h, ["--harness", "codex", "hook", "stop"], nested, review, JSON.stringify({ session_id: "cx", cwd: review, hook_event_name: "Stop" }));
    expect(stop.out).toBe("");
    const cfg = JSON.parse(readFileSync(join(h, "config.json"), "utf8")) as { bindings?: Record<string, { as: string; session?: string } | { as: string; session?: string }[]> };
    const seats = Object.values(cfg.bindings ?? {}).flatMap((v) => (Array.isArray(v) ? v : [v]));
    expect(seats.map((b) => [b.as, b.session])).toEqual([[me, "sc"]]);
    expect((await run(h, ["hook", "prompt"], C, h, JSON.stringify({ session_id: "sc", cwd: h }))).out).toContain("for the Claude session only");
  });
});

describe("--as", () => {
  test("a typo does not mint a new unused identity", async () => {
    const owner = scratch("as-typo");
    await ok(owner, ["create", "proj", "--as", "boss"]);
    const r = await run(owner, ["-c", "proj", "--as", "typo", "status"]);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain('typo has no key in "proj" on this machine');
    const idDir = join(owner, "identities");
    const files = existsSync(idDir) ? readdirSync(idDir).flatMap((room) => readdirSync(join(idDir, room))) : [];
    expect(files.some((f) => f.toLowerCase().includes("typo"))).toBe(false);
  });
});
