// Joining without busywork: no --as (agents are called by what they run in, made unique by the
// owner's side), a seat per agent in its checkout (no -c/--as afterwards, two agents in one checkout
// each act as themselves, a restart takes its seat back), and Claude Code's hooks doing the listening.
import { spawnOwned } from "./owned.ts";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { daemonListening, daemonSock, stopDaemon } from "../src/daemon.ts";
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
    const aProcess = spawnOwned(["sleep", "120"]);
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
    const cProcess = spawnOwned(["sleep", "120"]);
    const C = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "C", CLAUDE_PID: String(cProcess.pid) };
    const refused = await run(h, ["send", "who am i"], C);
    cProcess.kill();
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("in another session");
  });

  test("a session that takes an idle session's seat is told once, with the handle, channel, session and quiet time (#2590)", async () => {
    const owner = scratch("own-idle");
    const code = created(await ok(owner, ["create", "idles", "--as", "boss"]));
    const h = scratch("idle");
    const s1 = await join_(owner, h, code, { CODEX_THREAD_ID: "t1" });
    const handle = youAre(s1.out);
    await until(async () => (await daemonListening(daemonSock(h)).catch(() => [])).some((s) => s.agent === handle), "the joiner's daemon holding its seat");
    await stopDaemon(daemonSock(h));
    const cfgPath = join(h, "config.json");
    const quiet = Date.now() - 13 * 3600_000;
    const aged = JSON.parse(readFileSync(cfgPath, "utf8")) as { bindings?: Record<string, unknown> };
    for (const [d, v] of Object.entries(aged.bindings ?? {})) {
      const seats = (Array.isArray(v) ? v : [v]) as Record<string, unknown>[];
      for (const s of seats)
        if (s && typeof s === "object") {
          s.at = quiet;
          s.seen = quiet;
        }
      aged.bindings![d] = Array.isArray(v) ? seats : seats[0]!;
    }
    writeFileSync(cfgPath, JSON.stringify(aged));
    const seat = (): { session?: string } => {
      const c = JSON.parse(readFileSync(cfgPath, "utf8")) as { bindings?: Record<string, unknown> };
      const v = c.bindings?.[realpathSync(h)];
      const seats = (Array.isArray(v) ? v : [v!]) as { session?: string }[];
      return seats[0]!;
    };
    const first = await run(h, ["status"], { CODEX_THREAD_ID: "t2" });
    expect(first.code).toBe(0);
    expect(first.out).toContain(handle);
    expect(seat().session).toBe("t2");
    const notices = first.err.split("\n").filter((l) => l.includes("t1"));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain(handle);
    expect(notices[0]).toContain("idles");
    expect(notices[0]).toMatch(/13/);
    const second = await run(h, ["status"], { CODEX_THREAD_ID: "t2" });
    expect(second.code).toBe(0);
    expect(second.err).not.toContain("t1");
  });

  test("a command that targets another channel leaves the idle seat beside it alone, even when resolving that channel fails (#2590)", async () => {
    const owner = scratch("own-two");
    const codeA = created(await ok(owner, ["create", "idles", "--as", "boss"]));
    const codeB = created(await ok(owner, ["create", "elsewhere", "--as", "boss"]));
    const h = scratch("two");
    const s1 = await join_(owner, h, codeA, { CODEX_THREAD_ID: "t1" });
    const handle = youAre(s1.out);
    await until(async () => (await daemonListening(daemonSock(h)).catch(() => [])).some((s) => s.agent === handle), "the joiner's daemon holding its seat");
    const b = spawn(h, ["join", codeB, "--timeout", "40s"], { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "s3", CLAUDE_PID: String(process.pid) });
    let bOut = "";
    const reader = b.stdout.getReader();
    const reading = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        bOut += new TextDecoder().decode(value);
      }
    })();
    await until(() => bOut.includes("waiting for the owner"), "the second join asking");
    let listed = "";
    await until(async () => {
      listed = await ok(owner, ["--as", "human", "-c", "elsewhere", "requests"]);
      return /\d{3}-\d{3}/.test(listed);
    }, "request listed with a code");
    await ok(owner, ["--as", "human", "-c", "elsewhere", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes"]);
    expect(await b.exited).toBe(0);
    await reading;
    await stopDaemon(daemonSock(h));
    const cfgPath = join(h, "config.json");
    const quiet = Date.now() - 13 * 3600_000;
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as { bindings?: Record<string, unknown> };
    for (const [d, v] of Object.entries(cfg.bindings ?? {})) {
      const seats = (Array.isArray(v) ? v : [v]) as Record<string, unknown>[];
      for (const s of seats)
        if (s && typeof s === "object" && s.harness === "codex") {
          s.at = quiet;
          s.seen = quiet;
        }
      cfg.bindings![d] = Array.isArray(v) ? seats : seats[0]!;
    }
    writeFileSync(cfgPath, JSON.stringify(cfg));
    const seat = (): { session?: string } => {
      const c = JSON.parse(readFileSync(cfgPath, "utf8")) as { bindings?: Record<string, unknown> };
      const v = c.bindings?.[realpathSync(h)];
      const seats = (Array.isArray(v) ? v : [v!]) as { session?: string; harness?: string }[];
      return seats.find((s) => s.harness === "codex")!;
    };
    await run(h, ["status", "-c", "elsewhere"], { CODEX_THREAD_ID: "t2" });
    expect(seat().session).toBe("t1");
    const unknown = await run(h, ["status", "-c", "nope"], { CODEX_THREAD_ID: "t2" });
    expect(unknown.code).not.toBe(0);
    expect(seat().session).toBe("t1");
  });

  test("the channels listing marks an idle seat without claiming it (#2590)", async () => {
    const owner = scratch("own-list");
    const code = created(await ok(owner, ["create", "idles", "--as", "boss"]));
    const h = scratch("list");
    const s1 = await join_(owner, h, code, { CODEX_THREAD_ID: "t1" });
    const handle = youAre(s1.out);
    await until(async () => (await daemonListening(daemonSock(h)).catch(() => [])).some((s) => s.agent === handle), "the joiner's daemon holding its seat");
    await stopDaemon(daemonSock(h));
    const cfgPath = join(h, "config.json");
    const quiet = Date.now() - 13 * 3600_000;
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as { bindings?: Record<string, unknown> };
    for (const [d, v] of Object.entries(cfg.bindings ?? {})) {
      const seats = (Array.isArray(v) ? v : [v]) as Record<string, unknown>[];
      for (const s of seats)
        if (s && typeof s === "object") {
          s.at = quiet;
          s.seen = quiet;
        }
      cfg.bindings![d] = Array.isArray(v) ? seats : seats[0]!;
    }
    writeFileSync(cfgPath, JSON.stringify(cfg));
    const seat = (): { session?: string } => {
      const c = JSON.parse(readFileSync(cfgPath, "utf8")) as { bindings?: Record<string, unknown> };
      const v = c.bindings?.[realpathSync(h)];
      const seats = (Array.isArray(v) ? v : [v!]) as { session?: string }[];
      return seats[0]!;
    };
    const listed = await run(h, ["channels"], { CODEX_THREAD_ID: "t2" });
    expect(listed.code).toBe(0);
    expect(listed.out).toContain("* idles");
    expect(seat().session).toBe("t1");
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

describe("a Deep Code seat (T7367)", () => {
  test("joined with --harness deepcode it keeps that harness; a Deep Code command in tmux records its pane, and a command outside tmux, from a plain terminal or from another harness leaves it", async () => {
    const owner = scratch("own-dc");
    const code = created(await ok(owner, ["create", "deep", "--as", "boss"]));
    const dc = scratch("dc");
    const plain = { CLAUDECODE: "", CLAUDE_CODE_SESSION_ID: "", CLAUDE_PID: "", TMUX: "", TMUX_PANE: "", KIWI_HARNESS: "" };
    const me = youAre((await join_(owner, dc, code, plain, dc, ["--harness", "deepcode"])).out);
    const seat = () => {
      const cfg = JSON.parse(readFileSync(join(dc, "config.json"), "utf8")) as {
        bindings?: Record<string, { as: string; harness?: string; tmux?: { pane: string } } | { as: string; harness?: string; tmux?: { pane: string } }[]>;
      };
      return Object.values(cfg.bindings ?? {})
        .flatMap((v) => (Array.isArray(v) ? v : [v]))
        .find((b) => b.as === me);
    };
    expect(seat()).toMatchObject({ as: me, harness: "deepcode" });
    expect(seat()?.tmux).toBeUndefined();
    expect(await ok(dc, ["wake"], plain)).toContain("can't be woken");

    const inTmux = { ...plain, TMUX: `${join(dc, "tmux-sock")},1,0`, TMUX_PANE: "%9", KIWI_HARNESS: "deepcode" };
    await ok(dc, ["send", "ready for reviews"], inTmux);
    expect(seat()?.tmux?.pane).toBe("%9");
    await ok(dc, ["send", "from another terminal"], plain);
    expect(seat()?.tmux?.pane).toBe("%9");
    await ok(dc, ["send", "from a plain terminal in another tmux pane"], { ...inTmux, TMUX_PANE: "%5", KIWI_HARNESS: "" });
    expect(seat()?.tmux?.pane).toBe("%9");
    await ok(dc, ["send", "from a Claude session in tmux"], { ...inTmux, TMUX_PANE: "%3", CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "other", CLAUDE_PID: String(process.pid), KIWI_AS: me });
    expect(seat()?.tmux?.pane).toBe("%9");
    await until(async () => (await ok(dc, ["wake"], plain)).includes("wakes via typing into its tmux pane"), "the daemon reading the Deep Code seat's pane");
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

describe("a session outside the folder it joined in (#1579)", () => {
  test("keeps its seat from a folder no seat binds, while another session there is still asked to say which", async () => {
    const owner = scratch("own-out");
    const owner2 = scratch("own-out2");
    const first = created(await ok(owner, ["create", "first", "--as", "boss"]));
    const second = created(await ok(owner2, ["create", "second", "--as", "boss2"]));
    const h = scratch("out-agent");
    const project = join(h, "project");
    const other = join(h, "other");
    mkdirSync(project);
    mkdirSync(other);
    const lead = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "lead-s", CLAUDE_PID: String(process.pid) };
    const helper = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "helper-s", CLAUDE_PID: String(process.pid) };
    const me = youAre((await join_(owner, h, first, lead, project)).out);
    await join_(owner2, h, second, helper, other);
    const outside = scratch("out-scratch");
    expect(await ok(h, ["status"], lead, outside)).toContain(`you are ${me}`);
    const stranger = await run(h, ["status"], { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "stranger-s", CLAUDE_PID: String(process.pid) }, outside);
    expect(stranger.code).toBe(1);
    expect(stranger.err).toContain("pass -c ALIAS --as NAME");
  });
});
