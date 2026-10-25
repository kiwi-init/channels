import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { AgentLive, AgentSession } from "../src/agent.ts";
import { TASK_BODY_MAX_LENGTH, TASK_TITLE_LIMIT, TASK_TITLE_MAX_LENGTH, wellFormedEvent } from "@kiwi/core/protocol.ts";
import { fold } from "@kiwi/core/state.ts";
import { generateIdentity, sign, verify } from "@kiwi/core/identity.ts";
import { startRelay } from "../src/relay/bun.ts";
import { joinAgent, pairComputer, setupChannel } from "./owner.ts";

setDefaultTimeout(60_000);

describe("task titles", () => {
  test("a title already in the log past the limit still reads, clipped", () => {
    expect(wellFormedEvent({ op: "task.add", title: "x".repeat(500) })).toBe(true);
  });

  test("an older client's long title, up to 200, stays whole: only new ones are held to 60", async () => {
    const title = "Linux: the missing-library message names the wrong Fedora package (libappindicator-gtk3)";
    expect(title.length).toBeGreaterThan(TASK_TITLE_LIMIT);
    const id = await generateIdentity("dev");
    const p = await sign(id, { v: 1 as const, id: "a", from: "dev", kind: "event" as const, body: "", ts: 1, ev: { op: "task.add" as const, title } });
    const m = { ...p, seq: 1, rts: 1, sigOk: await verify(p) };
    expect(fold([m], [{ name: "dev", pk: id.pk, owner: false, at: 0, active: true, kind: "agent" }]).tasks.get(1)?.title).toBe(title);
    expect(TASK_TITLE_MAX_LENGTH).toBe(200);
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

    test("adding one over 60 characters says why, points at the body, and leaves no task behind", async () => {
      const before = (await run(dev.state())).state.tasks.size;
      const long = "Linux: the missing-library message names the wrong Fedora package";
      await expect(run(dev.taskAdd(long))).rejects.toThrow(
        `the title is ${long.length} characters, and a task's title is at most 60 so people can read the board: keep the outcome in the title and move the rest into the body (--body "…" or --file spec.md)`,
      );
      expect((await run(dev.state())).state.tasks.size).toBe(before);
    });

    test("one at 60 is added, with its spec in the body, shown by task show", async () => {
      const spec = "Electrobun's launcher names libappindicator-gtk3 for Fedora (linux_dependencies.zig:136); the library is libayatana-appindicator-gtk3.";
      const id = await run(dev.taskAdd("y".repeat(TASK_TITLE_LIMIT), { detail: spec }));
      const t = (await run(dev.state())).state.tasks.get(id);
      expect([t?.title.length, t?.detail]).toEqual([TASK_TITLE_LIMIT, spec]);
    });

    test("a body past its limit is refused before anything is sent", async () => {
      const before = (await run(dev.state())).state.tasks.size;
      await expect(run(dev.taskAdd("Short title", { detail: "b".repeat(TASK_BODY_MAX_LENGTH + 1) }))).rejects.toThrow(`the most a task's body takes is ${TASK_BODY_MAX_LENGTH}`);
      expect((await run(dev.state())).state.tasks.size).toBe(before);
    });

    test("renaming a task past 60 is refused the same way", async () => {
      const id = await run(dev.taskAdd("short"));
      await expect(run(dev.taskUpdate(id, { title: "z".repeat(TASK_TITLE_LIMIT + 1) }))).rejects.toThrow(/a task's title is at most 60/);
      expect((await run(dev.state())).state.tasks.get(id)?.title).toBe("short");
    });
  });
});
