import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { presenceWords } from "@kiwi/core/format.ts";
import { readUnarmed, UNARMED_ALERT_MS } from "@kiwi/core/protocol.ts";
import { daemonListeners, daemonSeat, daemonSock, reportUnarmed } from "../src/daemon.ts";
import { youAre, created, joinSeats } from "./join-seats-setup.ts";

setDefaultTimeout(60_000);

const { scratch, spawn, run, ok, until, join_ } = joinSeats();

const now = 1_800_000_000_000;
const seat = { client: "daemon", reach: "listening" as const, wake: "hooks", readAt: now - 60_000 };

describe("a listener that can't arm is flagged after five minutes (#2502)", () => {
  test("kiwi status says so only once the failure is five minutes old, and never without one", () => {
    const why = "the listen slot for lead in alpha is held by session L, claude pid 7, listener pid 9";
    expect(presenceWords(seat, now)).not.toContain("listener not armed");
    expect(presenceWords({ ...seat, unarmed: { since: now - UNARMED_ALERT_MS + 1_000, why } }, now)).not.toContain("listener not armed");
    expect(presenceWords({ ...seat, unarmed: { since: now - 6 * 60_000, why } }, now)).toContain(`listener not armed for 6m: ${why}`);
  });

  test("only a well-formed record is read off the wire", () => {
    expect(readUnarmed({ since: now, why: "held" })).toEqual({ since: now, why: "held" });
    expect(readUnarmed({ since: "soon", why: "held" })).toBeNull();
    expect(readUnarmed({ since: now, why: "" })).toBeNull();
    expect(readUnarmed({ since: now, why: "x".repeat(301) })).toBeNull();
  });

  test("the daemon keeps the failure until the seat's listener arms, ignores it while one is held, and never records it with wake off", async () => {
    const owner = scratch("own-unarmed");
    const code = created(await ok(owner, ["create", "unarmed", "--as", "boss"]));
    const h = scratch("unarmed");
    const S = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "L", CLAUDE_PID: String(process.pid), AI_AGENT: "claude-code_2-1-296_agent" };
    const me = youAre((await join_(owner, h, code, S)).out);
    const input = JSON.stringify({ session_id: "L", cwd: h });
    const sock = daemonSock(h);
    await run(h, ["hook", "session-start"], S, h, input);

    const first = spawn(h, ["hook", "listen"], S, h, input);
    await until(async () => (await daemonListeners(sock).catch(() => [])).some((l) => l.kind === "hook" && l.agent === me), "the listener");
    await reportUnarmed("unarmed", me, "while one is held", sock);
    expect((await daemonSeat("unarmed", me, sock))?.unarmed).toBeNull();

    await ok(owner, ["send", "--to", me, "end this listener"]);
    expect(await first.exited).toBe(2);
    await reportUnarmed("unarmed", me, "nothing armed", sock);
    expect((await daemonSeat("unarmed", me, sock))?.unarmed).toMatchObject({ why: "nothing armed" });
    const recorded = (await daemonSeat("unarmed", me, sock))?.unarmed;
    if (!recorded) throw new Error("the daemon kept no failure");
    const since = recorded.since;
    await reportUnarmed("unarmed", me, "still nothing", sock);
    expect((await daemonSeat("unarmed", me, sock))?.unarmed).toEqual({ since, why: "still nothing" });

    const second = spawn(h, ["hook", "listen"], S, h, input);
    await until(async () => (await daemonSeat("unarmed", me, sock))?.unarmed === null, "the alert to clear on arm");
    await ok(owner, ["send", "--to", me, "end the second"]);
    expect(await second.exited).toBe(2);

    await ok(h, ["wake", "off"], S);
    await reportUnarmed("unarmed", me, "wake is off", sock);
    expect((await daemonSeat("unarmed", me, sock))?.unarmed).toBeNull();
  });
});
