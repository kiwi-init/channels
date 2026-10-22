import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AgentSession, runAgent } from "../src/agent.ts";
import { loadConfig } from "../src/config.ts";
import type { Presence } from "@kiwi/core/protocol.ts";
import { wakeKey } from "@kiwi/core/wake.ts";
import { wakeHarness } from "./wake-harness.ts";

setDefaultTimeout(60_000);

const w = wakeHarness();
const { fake, calls, bindAs, until, readAll, seat, quiet, home, bin } = w;

describe("waking an agent in its own session, across sessions, relay outages and wake off", () => {
  test("a wake still unread in an old session doesn't hold back the wake of the session that replaced it", async () => {
    const before = await quiet();
    try {
      await w.ownerCh.send("for the old session", { to: ["claude"] });
      await until("the old session's wake", () => calls().length === before + 1);
      await until("the wake's record", async () => (await seat())?.wake.last?.ok === true);
      bindAs({ harness: "codex", session: "thread-replacement" });
      await w.ownerCh.send("for the new session", { to: ["claude"] });
      await until("the new session's wake", () => calls().length === before + 2, 3_500);
      expect(calls().at(-1)).toContain("thread-replacement");
    } finally {
      bindAs({ harness: "codex", session: "thread-1" });
    }
  });

  test("an agent that read the woken-for message as a reply, without moving its cursor, is woken for the next one", async () => {
    const before = await quiet();
    const cfg = loadConfig().channels.test;
    if (!cfg) throw new Error("the test channel is missing");
    const s = await AgentSession.open("test", cfg, "claude");
    const from = await w.ownerCh.head();
    const reply = await w.ownerCh.send("a reply to the agent", { to: ["claude"], re: [from] });
    await until("the reply's wake", () => calls().length === before + 1);
    const replies = await runAgent(s.awaitReplies(from, from, 2));
    expect(replies.map((r) => r.seq)).toContain(reply);
    const { messages, state } = await runAgent(s.state());
    expect(await runAgent(s.unreadCount(state, messages))).toBe(0);
    await w.ownerCh.send("after the reply was read", { to: ["claude"] });
    await until("the next message's wake", () => calls().length === before + 2, 3_500);
  });

  test("a binding that changes after the message is the one woken", async () => {
    const before = await quiet();
    const sent = w.ownerCh.send("for the new thread", { to: ["claude"] });
    bindAs({ harness: "codex", session: "thread-2" });
    await sent;
    try {
      await until("a wake", () => calls().length === before + 1);
      expect(calls().at(-1)).toContain("thread-2");
    } finally {
      bindAs({ harness: "codex", session: "thread-1" });
    }
  });

  test("an unread check that fails is tried again once the relay answers", async () => {
    const before = await quiet();
    await w.ownerCh.send("while the relay goes away", { to: ["claude"] });
    w.stopRelay();
    await Bun.sleep(2_500);
    expect(calls().length).toBe(before);
    w.startRelayAgain();
    await until("the wake after the relay is back", () => calls().length === before + 1, 25_000);
  });

  test("kiwi wake off keeps it asleep, presence stops saying it wakes, and kiwi wake on brings it back", async () => {
    await readAll();
    const cli = async (...args: string[]): Promise<string> => {
      const p = Bun.spawn([process.execPath, join(import.meta.dir, "../src/cli/main.ts"), "-c", "test", "--as", "claude", ...args], {
        env: { ...process.env, KIWI_RELAY: w.relay },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
      expect(await p.exited, err).toBe(0);
      return out;
    };
    expect(await cli("wake", "off")).toContain("won't wake claude");
    expect(loadConfig().wakeOff).toEqual([wakeKey("test", "claude")]);
    try {
      expect(await cli("wake")).toStartWith("wake off · wakes via codex queue");
      await Bun.sleep(1_600);
      const before = calls().length;
      await w.ownerCh.send("while asleep", { to: ["claude"] });
      await Bun.sleep(2_000);
      expect(calls().length).toBe(before);
      expect((await seat())?.wake.on).toBe(false);
      const fresh: Presence[] = [];
      const look = new AbortController();
      void w.ownerCh.stream(await w.ownerCh.head(), () => {}, { signal: look.signal, onPresence: (p) => void fresh.push(p) });
      try {
        await until("presence without wake", () => fresh.some((p) => p.pk === w.claudePk && p.client === "daemon" && p.wake === undefined));
      } finally {
        look.abort();
      }
    } finally {
      expect(await cli("wake", "on")).toContain("Kiwi wakes claude");
    }
    expect(loadConfig().wakeOff).toBeUndefined();
  });

  test("a wake that fails says why in the wake log", async () => {
    const before = await quiet();
    writeFileSync(join(bin, "codex"), "#!/bin/sh\necho boom >&2\nexit 3\n");
    try {
      await w.ownerCh.send("the wake will fail", { to: ["claude"] });
      await until("the failure in the log", () => existsSync(join(home, "wake.log")) && readFileSync(join(home, "wake.log"), "utf8").includes("\tfailed\texit 3: boom"));
    } finally {
      fake("codex");
    }
    expect(calls().length).toBe(before);
  });
});
