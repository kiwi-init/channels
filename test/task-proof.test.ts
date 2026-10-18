import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { AgentLive, AgentSession } from "../src/agent.ts";
import { describeEvent, proofLabel } from "@kiwi/core/format.ts";
import { PROOF_MAX, wellFormedEvent } from "@kiwi/core/protocol.ts";
import { taskFeed } from "@kiwi/core/work.ts";
import { startRelay } from "../src/relay/bun.ts";
import { joinAgent, pairComputer, setupChannel } from "./owner.ts";

setDefaultTimeout(60_000);

describe("task proof on the wire", () => {
  const update = (proof: unknown) => ({ op: "task.update", task: 1, proof });

  test("an https link, with or without a one-line label", () => {
    expect(wellFormedEvent(update({ url: "https://preview.example.com/pr-12" }))).toBe(true);
    expect(wellFormedEvent(update({ url: "https://preview.example.com/pr-12", label: "preview" }))).toBe(true);
  });

  test("nothing else: not http, not a script, not a space, not a long or multi-line label", () => {
    expect(wellFormedEvent(update({ url: "http://preview.example.com" }))).toBe(false);
    expect(wellFormedEvent(update({ url: "javascript:alert(1)" }))).toBe(false);
    expect(wellFormedEvent(update({ url: "https://a.example.com/ b" }))).toBe(false);
    expect(wellFormedEvent(update({ url: "https://a.example.com", label: "x".repeat(81) }))).toBe(false);
    expect(wellFormedEvent(update({ url: "https://a.example.com", label: "a\nb" }))).toBe(false);
    expect(wellFormedEvent(update("https://a.example.com"))).toBe(false);
  });

  test("a label is what it's called, else the host", () => {
    expect(proofLabel({ url: "https://preview.example.com/pr-12", label: "preview" })).toBe("preview");
    expect(proofLabel({ url: "https://preview.example.com/pr-12" })).toBe("preview.example.com");
  });
});

describe("task proof on a live channel", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-proof-relay-"));
  const home = mkdtempSync(join(tmpdir(), "kiwi-proof-home-"));
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
    dev = new AgentSession("proof", { ...ch.access, relay: owner.relay, code: owner.code }, id, () => {});
  });
  afterAll(() => {
    server.stop(true);
    if (was === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = was;
    for (const d of [dataDir, home]) rmSync(d, { recursive: true, force: true });
  });

  test("a link lands on the task, once, with who added it, and reads in its feed", async () => {
    const id = await run(dev.taskAdd("ship the login page"));
    await run(dev.taskUpdate(id, { proof: { url: "https://preview.example.com/pr-12", label: "preview" } }));
    await run(dev.taskUpdate(id, { proof: { url: "https://preview.example.com/pr-12", label: "again" } }));
    await run(dev.taskUpdate(id, { proof: { url: "https://claude.ai/code/session_1" } }));
    const { state, messages } = await run(dev.state());
    const proof = state.tasks.get(id)?.proof ?? [];
    expect(proof.map((p) => [p.url, p.label, p.by])).toEqual([
      ["https://preview.example.com/pr-12", "preview", "dev"],
      ["https://claude.ai/code/session_1", undefined, "dev"],
    ]);
    const said = taskFeed(state, messages, id).flatMap((i) => (i.type === "event" ? [i.text] : []));
    expect(said).toContain("added proof: preview");
    expect(said).toContain("added proof: claude.ai");
    const last = [...messages].reverse().find((m) => m.ev?.op === "task.update")!;
    expect(describeEvent(last, state)).toContain("added proof to");
    expect(describeEvent(last, state)).toContain("claude.ai https://claude.ai/code/session_1");
  });

  test("a link that isn't https, or a task that isn't there, is refused with the reason", async () => {
    const id = await run(dev.taskAdd("another"));
    await expect(run(dev.taskUpdate(id, { proof: { url: "http://insecure.example.com" } }))).rejects.toThrow(/starts with https/);
    await expect(run(dev.taskUpdate(id, { proof: { url: "https://ok.example.com", label: "a\nb" } }))).rejects.toThrow(/one line/);
    await expect(run(dev.taskUpdate(9999, { proof: { url: "https://ok.example.com" } }))).rejects.toThrow(/no task/);
  });

  test("a task keeps at most the limit", async () => {
    const id = await run(dev.taskAdd("many links"));
    for (let i = 0; i < PROOF_MAX + 3; i++) await run(dev.taskUpdate(id, { proof: { url: `https://example.com/${i}` } }));
    expect((await run(dev.state())).state.tasks.get(id)?.proof?.length).toBe(PROOF_MAX);
  });
});
