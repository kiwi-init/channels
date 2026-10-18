import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { AgentLive, AgentSession } from "../src/agent.ts";
import { TASK_TITLE_MAX_LENGTH, wellFormedEvent } from "@kiwi/core/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";
import { joinAgent, pairComputer, setupChannel } from "./owner.ts";

setDefaultTimeout(60_000);

describe("task titles", () => {
  test("a title already in the log past the limit still reads, clipped", () => {
    expect(wellFormedEvent({ op: "task.add", title: "x".repeat(500) })).toBe(true);
  });

  describe("on a live channel", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "kiwi-title-relay-"));
    const home = mkdtempSync(join(tmpdir(), "kiwi-title-home-"));
    const was = process.env.KIWI_HOME;
    let server: ReturnType<typeof startRelay>;
    const run = <A, E>(e: Effect.Effect<A, E, unknown>) => Effect.runPromise(e.pipe(Effect.provide(AgentLive)) as Effect.Effect<A, E, never>);
    let dev: AgentSession;

    beforeAll(async () => {
      process.env.KIWI_HOME = home;
      server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
      const owner = await setupChannel(server.url.origin, { ownerName: "jon" });
      const computer = await pairComputer(owner.person);
      const { id, ch } = await joinAgent(owner, "dev", computer);
      dev = new AgentSession("title", { ...ch.access, relay: owner.relay, code: owner.code }, id, () => {});
    });
    afterAll(() => {
      server.stop(true);
      if (was === undefined) delete process.env.KIWI_HOME;
      else process.env.KIWI_HOME = was;
      for (const d of [dataDir, home]) rmSync(d, { recursive: true, force: true });
    });

    test("adding one over the limit says why and leaves no task behind", async () => {
      const before = (await run(dev.state())).state.tasks.size;
      await expect(run(dev.taskAdd("x".repeat(TASK_TITLE_MAX_LENGTH + 1)))).rejects.toThrow(/most a task takes is 200/);
      expect((await run(dev.state())).state.tasks.size).toBe(before);
    });

    test("one at the limit is added", async () => {
      const id = await run(dev.taskAdd("y".repeat(TASK_TITLE_MAX_LENGTH)));
      expect((await run(dev.state())).state.tasks.get(id)?.title.length).toBe(TASK_TITLE_MAX_LENGTH);
    });

    test("renaming a task past the limit is refused the same way", async () => {
      const id = await run(dev.taskAdd("short"));
      await expect(run(dev.taskUpdate(id, { title: "z".repeat(TASK_TITLE_MAX_LENGTH + 1) }))).rejects.toThrow(/most a task takes is 200/);
    });
  });
});
