// What runs an agent: read where its harness leaves it, declared at join, signed by the owner.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectModel, detectRuns, modelInTranscript, noteTranscript } from "../src/card.ts";
import { newChannelKey } from "../src/crypto.ts";
import { generateIdentity, sign } from "../src/identity.ts";
import { makeAdmittedRecord, makeRecord, openRecord, readRecord, readRuns, runsLine, sealRecord } from "../src/membership.ts";

const made: string[] = [];
const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-runs-${tag}-`));
  made.push(d);
  return d;
};
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const prevHome = process.env.KIWI_HOME;
afterEach(() => {
  if (prevHome === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = prevHome;
});

/** A Claude Code transcript: one JSON line per event, assistant lines naming the model. */
function transcript(dir: string, session: string, models: string[]): string {
  const file = join(dir, `${session}.jsonl`);
  const lines = [JSON.stringify({ type: "user", message: { role: "user", content: "hi" } })];
  for (const model of models) lines.push(JSON.stringify({ type: "assistant", requestedModel: model, message: { model, role: "assistant", content: [] } }));
  writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

describe("reading the model", () => {
  test("a Claude Code transcript names the model its newest assistant line used, never a synthetic one", () => {
    const dir = scratch("tr");
    expect(modelInTranscript(transcript(dir, "s1", ["claude-sonnet-5-5", "claude-fable-5-1"]))).toBe("claude-fable-5-1");
    const file = transcript(dir, "s2", ["claude-fable-5-1"]);
    writeFileSync(file, JSON.stringify({ type: "assistant", message: { model: "<synthetic>", role: "assistant" } }) + "\n", { flag: "a" });
    expect(modelInTranscript(file)).toBe("claude-fable-5-1");
    expect(modelInTranscript(transcript(dir, "s3", []))).toBeUndefined();
    expect(modelInTranscript(join(dir, "missing.jsonl"))).toBeUndefined();
  });

  test("a Claude Code session's transcript is found by the hook's note, else under the projects folder", () => {
    const home = scratch("home");
    process.env.KIWI_HOME = home;
    const cfg = scratch("claude");
    mkdirSync(join(cfg, "projects", "-home-me-proj"), { recursive: true });
    transcript(join(cfg, "projects", "-home-me-proj"), "abc", ["claude-fable-5-1"]);
    const env = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "abc", CLAUDE_CONFIG_DIR: cfg };
    expect(detectModel(env)).toBe("claude-fable-5-1");
    // The hook noted another path for this session: that one wins.
    const elsewhere = transcript(scratch("else"), "abc", ["claude-opus-5-5"]);
    noteTranscript("abc", elsewhere);
    expect(detectModel(env)).toBe("claude-opus-5-5");
    // No session id, or a session with no transcript anywhere: nothing to read.
    expect(detectModel({ CLAUDECODE: "1", CLAUDE_CONFIG_DIR: cfg })).toBeUndefined();
    expect(detectModel({ CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "nope", CLAUDE_CONFIG_DIR: cfg })).toBeUndefined();
  });

  test("Codex's config names its model; KIWI_MODEL says it outright for any harness", () => {
    const codex = scratch("codex");
    writeFileSync(join(codex, "config.toml"), '# codex\nmodel = "gpt-6.1-sol"\nmodel_reasoning_effort = "high"\n');
    expect(detectModel({ CODEX_THREAD_ID: "t1", CODEX_HOME: codex })).toBe("gpt-6.1-sol");
    expect(detectModel({ CODEX_THREAD_ID: "t1", CODEX_HOME: scratch("empty") })).toBeUndefined();
    expect(detectModel({ GEMINI_CLI: "1" })).toBeUndefined();
    expect(detectModel({ GEMINI_CLI: "1", KIWI_MODEL: " gemini-3-pro " })).toBe("gemini-3-pro");
  });

  test("runs needs both halves: the harness detected or given, the model read or given", () => {
    expect(detectRuns({ CLAUDECODE: "1", KIWI_MODEL: "claude-fable-5-1" })).toEqual({ harness: "claude-code", model: "claude-fable-5-1" });
    expect(detectRuns({ KIWI_MODEL: "glm-5.3" })).toBeUndefined();
    expect(detectRuns({ KIWI_MODEL: "glm-5.3" }, { harness: "OpenCode" })).toEqual({ harness: "opencode", model: "glm-5.3" });
    expect(detectRuns({ KIWI_HARNESS: "mimo" }, { model: "mimo-v2.6-pro" })).toEqual({ harness: "mimo", model: "mimo-v2.6-pro" });
    expect(detectRuns({ CLAUDECODE: "1", CLAUDE_CONFIG_DIR: scratch("none") })).toBeUndefined();
  });
});

describe("runs in the member record", () => {
  test("the owner signs what the agent declared; readers keep it only from the owner's own record", async () => {
    const owner = await generateIdentity("human");
    const agent = await generateIdentity("claude");
    const key = newChannelKey();
    const room = "ab".repeat(16);
    const runs = { harness: "claude-code", model: "claude-fable-5-1" };
    const rec = await makeRecord(owner, room, { name: "claude", pk: agent.pk, xpk: agent.xpk!, kind: "agent", runs });
    const opened = await openRecord(key, await sealRecord(key, rec), room, owner.pk, agent.pk);
    expect(opened?.runs).toEqual(runs);
    expect(runsLine(opened?.runs)).toBe("claude-code · claude-fable-5-1");

    // A person's or a computer's record never carries it, whatever was passed.
    const person = await makeRecord(owner, room, { name: "ana", pk: agent.pk, xpk: agent.xpk!, kind: "human", runs });
    expect((person as { runs?: unknown }).runs).toBeUndefined();
    const box = await makeRecord(owner, room, { name: "box", pk: agent.pk, xpk: agent.xpk!, kind: "computer", runs });
    expect((box as { runs?: unknown }).runs).toBeUndefined();

    // A computer letting its own agent in signs no runs: that is the owner's to attest.
    const machine = await generateIdentity("machine");
    const admitted = await makeAdmittedRecord(machine, room, { name: "claude", pk: agent.pk, xpk: agent.xpk! });
    expect(Object.keys(admitted)).not.toContain("runs");
    const forged = await sign(machine, { ...admitted, runs, sig: undefined });
    const read = await readRecord(key, await sealRecord(key, forged as unknown as Parameters<typeof sealRecord>[1]), room, agent.pk, owner.pk);
    expect(read?.signer).toBe(machine.pk);
    expect(read?.member.runs).toEqual(runs);
    // (admitRoster then drops the whole record: `runs` is not among ADMITTED_FIELDS.)
    expect(read?.fields).toContain("runs");
  });

  test("runs reads only as two short non-empty lines", () => {
    expect(readRuns({ harness: "codex", model: "gpt-6.1-sol" })).toEqual({ harness: "codex", model: "gpt-6.1-sol" });
    expect(readRuns({ harness: "codex" })).toBeUndefined();
    expect(readRuns({ harness: "", model: "x" })).toBeUndefined();
    expect(readRuns("codex gpt")).toBeUndefined();
    expect(readRuns({ harness: "a\nb", model: "m".repeat(100) })).toEqual({ harness: "a b", model: `${"m".repeat(59)}…` });
  });
});
