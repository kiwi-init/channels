import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { daemonListeners, daemonSock } from "../src/daemon.ts";
import { DEAD, HANDLE, youAre, created, joinSeats } from "./join-seats-setup.ts";

setDefaultTimeout(60_000);

const { scratch, spawn, run, ok, until, join_, claudeDir } = joinSeats();

describe("Claude Code's hooks do the listening", () => {
  test("installed with asyncRewake; the listener wakes the session with the message; nothing nags about a Monitor", async () => {
    const owner = scratch("own4");
    const code = created(await ok(owner, ["create", "hooked", "--as", "boss"]));
    const h = scratch("hooked");
    const S = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "L", CLAUDE_PID: String(process.pid), AI_AGENT: "claude-code_2-1-296_agent" };
    const joined = await join_(owner, h, code, S);
    const me = youAre(joined.out);
    expect(joined.out).toContain("Kiwi's hooks wake you");
    expect(joined.out).not.toContain("Monitor");

    const settings = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8")) as { hooks: Record<string, { hooks: { command: string; asyncRewake?: boolean; async?: boolean }[] }[]> };
    for (const e of ["SessionStart", "UserPromptSubmit", "Stop"]) {
      const listener = settings.hooks[e]!.flatMap((x) => x.hooks).find((x) => x.command.endsWith(" hook listen # kiwi"));
      expect(listener).toMatchObject({ async: true, asyncRewake: true });
    }

    const input = JSON.stringify({ session_id: "L", cwd: h });
    expect((await run(h, ["hook", "session-start"], S, h, input)).out).toContain("arrive on their own");
    // Nothing listening yet, and still no nag: the hooks are the listener.
    expect((await run(h, ["hook", "stop"], S, h, input)).out).toBe("");

    const listening = spawn(h, ["hook", "listen"], S, h, input);
    // A second listener for the same agent steps aside at once.
    await until(async () => (await daemonListeners(daemonSock(h)).catch(() => [])).some((l) => l.kind === "hook" && l.agent === me), "listener slot");
    expect(existsSync(join(h, "listen-hooks"))).toBe(false);
    expect((await run(h, ["hook", "listen"], S, h, input)).code).toBe(0);
    await ok(owner, ["send", "--to", me, "wake up"]);
    expect(await listening.exited).toBe(2);
    expect(await new Response(listening.stderr).text()).toContain(`boss → ${me}: wake up`);

    // A listener whose session ends goes too, and leaves the next message unread for whoever comes next.
    const session = Bun.spawn(["sleep", "120"]);
    const orphan = spawn(h, ["hook", "listen"], { ...S, CLAUDE_CODE_SESSION_ID: "L2", CLAUDE_PID: String(session.pid) }, h, JSON.stringify({ session_id: "L2", cwd: h }));
    await Bun.sleep(1500);
    session.kill();
    expect(await orphan.exited).toBe(0);
    await ok(owner, ["send", "--to", me, "after the session ended"]);
    expect(await ok(h, ["read"], S)).toContain("after the session ended");

    // Peek: what the listener handed over is committed by the session's next hook, not by the listener.
    const peeking = spawn(h, ["hook", "listen"], S, h, input);
    await Bun.sleep(1000);
    await ok(owner, ["send", "--to", me, "handed, not yet read"]);
    expect(await peeking.exited).toBe(2);
    // The same session's next hook commits it: its prompt hook doesn't hand it over a second time.
    expect((await run(h, ["hook", "prompt"], S, h, input)).out).not.toContain("handed, not yet read");

    // A listener that hears a message but has nobody to hand it to (its session is gone) leaves it unread.
    await ok(owner, ["send", "--to", me, "nobody to hand this to"]);
    const late = await run(h, ["hook", "listen"], { ...S, CLAUDE_CODE_SESSION_ID: "L3", CLAUDE_PID: DEAD }, h, JSON.stringify({ session_id: "L3", cwd: h }));
    expect(late.code).toBe(0);
    expect(late.err).toBe("");
    expect(await ok(h, ["read"], S)).toContain("nobody to hand this to");
  });

  test("an older Claude Code is told it can't be woken, gets no listener, and nothing nags it", async () => {
    const owner = scratch("own5");
    const code = created(await ok(owner, ["create", "older", "--as", "boss"]));
    const h = scratch("older");
    // Its own settings: what an older Claude Code's join installs, with no listener in it.
    const S = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "O", CLAUDE_PID: String(process.pid), AI_AGENT: "claude-code_2-1-100_agent", CLAUDE_CONFIG_DIR: scratch("older-claude") };
    const joined = await join_(owner, h, code, S);
    expect(joined.out).toContain("Kiwi can't wake you in this session");
    expect(joined.out).not.toContain("Monitor");
    const input = JSON.stringify({ session_id: "O", cwd: h });
    expect(readFileSync(join(S.CLAUDE_CONFIG_DIR, "settings.json"), "utf8")).not.toContain("hook listen");
    const r = await run(h, ["hook", "listen"], S, h, input);
    expect(r.code).toBe(0);
    expect(r.err).toBe("");
    expect((await run(h, ["hook", "stop"], S, h, input)).out).toBe("");
  });
});

describe("what runs an agent", () => {
  test("an agent in a harness says its model or can't ask; the owner sees it, and approving signs it into the seat", async () => {
    const owner = scratch("own6");
    const code = created(await ok(owner, ["create", "runs", "--as", "boss"]));
    const h = scratch("runs");
    const S = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "R", CLAUDE_PID: String(process.pid) };
    // No transcript for this session and nothing said: refused before any request is made.
    const refused = await run(h, ["join", code], { ...S, KIWI_MODEL: "" });
    expect(refused.code).not.toBe(0);
    expect(refused.err).toContain("say what model runs you");
    expect(await ok(owner, ["--as", "human", "requests"])).toBe("no pending join requests\n");

    // Said outright: the request carries it, and the owner reads it next to the code.
    const joined = await join_(owner, h, code, { ...S, KIWI_MODEL: "claude-fable-5-1" });
    expect(joined.asked).toContain("runs claude-code · claude-fable-5-1");
    expect(youAre(joined.out)).toMatch(HANDLE);
    expect(joined.out).toContain('in channel "runs"');
    // Approved: the seat's record says so, owner-signed, and status shows it beside the card.
    const status = await ok(owner, ["--as", "human", "status"]);
    expect(status).toContain("runs claude-code · claude-fable-5-1 (owner-signed)");
    await ok(h, ["card", "--model", "claude-opus-5-5"], S);
    const later = await ok(owner, ["--as", "human", "status"]);
    expect(later).toContain("runs claude-code · claude-fable-5-1 (owner-signed)");
    expect(later).not.toContain("claude-opus-5-5");
  });

  test("a harness kiwi can't tell apart declares itself with --harness and --model", async () => {
    const owner = scratch("own7");
    const code = created(await ok(owner, ["create", "other", "--as", "boss"]));
    const h = scratch("other");
    // No harness marker at all: --harness alone is not enough, --model alone is not enough.
    const half = await run(h, ["join", code, "--as", "glm", "--harness", "opencode"], { CLAUDECODE: "", KIWI_MODEL: "" });
    expect(half.code).not.toBe(0);
    expect(half.err).toContain("--model");
    const p = spawn(h, ["join", code, "--as", "glm", "--harness", "OpenCode", "--model", "glm-5.3", "--timeout", "40s"], { CLAUDECODE: "", KIWI_MODEL: "" });
    let listed = "";
    await until(async () => {
      listed = await ok(owner, ["--as", "human", "requests"]);
      return /\d{3}-\d{3}/.test(listed);
    }, "request listed");
    expect(listed).toContain("glm · runs opencode · glm-5.3");
    await ok(owner, ["--as", "human", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes"]);
    expect(await p.exited).toBe(0);
    expect(await ok(owner, ["--as", "human", "status"])).toContain("runs opencode · glm-5.3 (owner-signed)");
  });
});
