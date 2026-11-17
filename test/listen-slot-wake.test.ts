import { spawnOwned } from "./owned.ts";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { daemonListeners, daemonSock, holdListener } from "../src/daemon.ts";
import { processStart } from "../src/pid.ts";
import { youAre, created, joinSeats } from "./join-seats-setup.ts";

setDefaultTimeout(60_000);

const { scratch, spawn, run, ok, until, join_ } = joinSeats();

describe("a seat whose slot was stranded is woken once by its own listener (#2502)", () => {
  test("the session's listener takes over a dead process's hold, a second one steps aside, and one message wakes it once", async () => {
    const owner = scratch("own-strand");
    const code = created(await ok(owner, ["create", "strand", "--as", "boss"]));
    const h = scratch("strand");
    const S = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "L", CLAUDE_PID: String(process.pid), AI_AGENT: "claude-code_2-1-296_agent" };
    const me = youAre((await join_(owner, h, code, S)).out);
    const input = JSON.stringify({ session_id: "L", cwd: h });
    await run(h, ["hook", "session-start"], S, h, input);

    const gone = spawnOwned(["sleep", "30"]);
    const started = processStart(gone.pid);
    if (!started) throw new Error("no start time for the stand-in listener");
    const stranded = await holdListener(
      { channel: "strand", agent: me, kind: "hook", cwd: h, harness: "claude", session: "L", pid: process.pid, proc: { pid: gone.pid, started }, marks: true },
      daemonSock(h),
    );
    expect(stranded.held).toBe(true);
    gone.kill();
    await gone.exited;

    const listening = spawn(h, ["hook", "listen"], S, h, input);
    await until(async () => (await daemonListeners(daemonSock(h)).catch(() => [])).some((l) => l.kind === "hook" && l.agent === me && l.proc?.pid !== gone.pid), "the session's own listener");
    expect((await run(h, ["hook", "listen"], S, h, input)).code).toBe(0);
    const hooks = (await daemonListeners(daemonSock(h))).filter((l) => l.kind === "hook" && l.agent === me);
    expect(hooks).toHaveLength(1);

    await ok(owner, ["send", "--to", me, "wake once"]);
    expect(await listening.exited).toBe(2);
    const told = await new Response(listening.stderr).text();
    expect(told.split("wake once")).toHaveLength(2);
    stranded.close();
  });
});
