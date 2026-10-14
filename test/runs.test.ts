// What runs an agent: read where its harness leaves it (src/harness.ts), declared at join, signed by
// the owner into its seat.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectModel, detectRuns } from "../src/card.ts";
import { newChannelKey } from "../src/crypto.ts";
import { generateIdentity, sign } from "../src/identity.ts";
import { makeRecord, openRecord, readRecord, readRuns, runsLine, sealRecord } from "../src/membership.ts";

const made: string[] = [];
const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-runs-${tag}-`));
  made.push(d);
  return d;
};
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

describe("reading the model", () => {
  test("Codex's config names its model when its thread index has nothing; KIWI_MODEL says it outright for any harness", async () => {
    const codex = scratch("codex");
    writeFileSync(join(codex, "config.toml"), '# codex\nmodel = "gpt-6.1-sol"\nmodel_reasoning_effort = "high"\n');
    expect(await detectModel({ CODEX_THREAD_ID: "t1", CODEX_HOME: codex })).toBe("gpt-6.1-sol");
    expect(await detectModel({ CODEX_THREAD_ID: "t1", CODEX_HOME: scratch("empty") })).toBeUndefined();
    expect(await detectModel({ GEMINI_CLI: "1" })).toBeUndefined();
    expect(await detectModel({ GEMINI_CLI: "1", KIWI_MODEL: " gemini-3-pro " })).toBe("gemini-3-pro");
  });

  test("runs needs both halves: the harness detected or given, the model read or given", async () => {
    expect(await detectRuns({ CLAUDECODE: "1", KIWI_MODEL: "claude-fable-5-1" })).toEqual({ harness: "claude-code", model: "claude-fable-5-1" });
    expect(await detectRuns({ KIWI_MODEL: "glm-5.3" })).toBeUndefined();
    expect(await detectRuns({ KIWI_MODEL: "glm-5.3" }, { harness: "OpenCode" })).toEqual({ harness: "opencode", model: "glm-5.3" });
    expect(await detectRuns({ KIWI_HARNESS: "mimo" }, { model: "mimo-v2.6-pro" })).toEqual({ harness: "mimo", model: "mimo-v2.6-pro" });
    expect(await detectRuns({ CLAUDECODE: "1", CLAUDE_CONFIG_DIR: scratch("none") })).toBeUndefined();
  });

  test("a Claude Code session's model, from its transcript, makes runs on its own", async () => {
    const cfg = scratch("claude");
    mkdirSync(join(cfg, "projects", "-home-me-proj"), { recursive: true });
    writeFileSync(join(cfg, "projects", "-home-me-proj", "abc.jsonl"), JSON.stringify({ type: "assistant", message: { model: "claude-fable-5-1", content: [] } }) + "\n");
    expect(await detectRuns({ CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "abc", CLAUDE_CONFIG_DIR: cfg })).toEqual({ harness: "claude-code", model: "claude-fable-5-1" });
  });
});

describe("runs in the member record", () => {
  test("the owner signs what the agent declared; readers keep it only from the owner's own record, and only an agent's", async () => {
    const owner = await generateIdentity("human");
    const agent = await generateIdentity("claude");
    const key = newChannelKey();
    const room = "ab".repeat(16);
    const runs = { harness: "claude-code", model: "claude-fable-5-1" };
    const rec = await makeRecord(owner, room, { name: "claude", pk: agent.pk, xpk: agent.xpk!, kind: "agent", runs });
    const opened = await openRecord(key, await sealRecord(key, rec), room, owner.pk, agent.pk);
    expect(opened?.runs).toEqual(runs);
    expect(runsLine(opened?.runs)).toBe("claude-code · claude-fable-5-1");

    // A person's record never carries it, whatever was passed.
    const person = await makeRecord(owner, room, { name: "ana", pk: agent.pk, xpk: agent.xpk!, kind: "human", runs });
    expect((person as { runs?: unknown }).runs).toBeUndefined();

    // Anyone else's signature on a record with runs in it: read as a record, never as runs.
    const other = await generateIdentity("other");
    const forged = await sign(other, { ...rec, pk: undefined, sig: undefined });
    const read = await readRecord(key, await sealRecord(key, forged as unknown as Parameters<typeof sealRecord>[1]), room, agent.pk, owner.pk);
    expect(read?.signer).toBe(other.pk);
    expect(read?.member.runs).toBeUndefined();
  });

  test("runs reads only as two short non-empty lines", () => {
    expect(readRuns({ harness: "codex", model: "gpt-6.1-sol" })).toEqual({ harness: "codex", model: "gpt-6.1-sol" });
    expect(readRuns({ harness: "codex" })).toBeUndefined();
    expect(readRuns({ harness: "", model: "x" })).toBeUndefined();
    expect(readRuns("codex gpt")).toBeUndefined();
    expect(readRuns({ harness: "a\nb", model: "m".repeat(100) })).toEqual({ harness: "a b", model: `${"m".repeat(59)}…` });
  });
});
