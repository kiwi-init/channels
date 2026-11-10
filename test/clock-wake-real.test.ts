import { expect, setDefaultTimeout, test } from "bun:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { clockOf } from "@kiwi/core/clock.ts";
import { AgentSession, runAgent } from "../src/agent.ts";
import { loadConfig } from "../src/config.ts";
import { pendingDocWakes } from "../src/config/doc-wakes.ts";
import { wakeHarness } from "./wake-harness.ts";

setDefaultTimeout(200_000);

const w = wakeHarness();

test("a real daemon wakes a quiet task's mover once through its command path: a failed command isn't run again for that attempt, and nothing is said delivered (T4171)", async () => {
  await w.ownerCh.send("quiet interval", { kind: "event", ev: { op: "quiet.set", minutes: 1 } });
  await w.ownerCh.send("task", { kind: "event", ev: { op: "task.add", title: "clock probe", owner: "claude" } });
  const s = await AgentSession.open("test", loadConfig().channels.test!, "claude");
  const stateNow = async () => (await runAgent(s.state())).state;
  const task = [...(await stateNow()).tasks.values()].find((t) => t.title === "clock probe");
  expect(task).toBeDefined();
  if (!task) return;
  await w.quiet();
  appendFileSync(join(w.bin, "codex"), "\nexit 1\n");
  const before = w.calls().length;
  await w.until("the clock's wake", () => w.calls().length > before, 110_000);
  await w.until("the failed wake's record", async () => (await w.seat())?.wake.last?.ok === false);
  const once = w.calls().length;
  expect(once).toBe(before + 1);
  await w.ownerCh.send("unrelated", { to: ["nobody"] });
  await w.ownerCh.send("unrelated again", { to: ["nobody"] });
  await Bun.sleep(4_000);
  expect(w.calls().length).toBe(once);
  const state = await stateNow();
  const held = state.tasks.get(task.id);
  const clock = held ? clockOf(state, held, Date.now()) : undefined;
  expect(clock?.woke).toMatchObject({ by: "claude" });
  expect(clock?.woke?.delivered).toBeUndefined();
  expect(clock?.woke?.read).toBeUndefined();
  expect(pendingDocWakes("test", "claude").map((p) => p.clock?.task)).toEqual([task.id]);
  await w.ownerCh.send("a message of its own still wakes the seat", { to: ["claude"] });
  await w.until("the message's wake", () => w.calls().length === once + 1);
});
