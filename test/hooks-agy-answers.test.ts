import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { created, joinSeats, youAre } from "./join-seats-setup.ts";

setDefaultTimeout(60_000);

const { scratch, spawn, run, ok, until } = joinSeats();

type Injected = { injectSteps: { systemMessage: { systemMessage: string } }[] };
type Continue = { decision: string; reason: string };

const CONVERSATION = "00ed029a-ac21-40e9-9722-979484ea920a";

function agyInput(workspace: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    conversationId: CONVERSATION,
    workspacePaths: [workspace],
    modelName: "gemini-3.8-flash-low",
    lastUserInput: "work on the task",
    ...extra,
  });
}

function injected(out: string): string {
  const parsed = JSON.parse(out) as Injected;
  expect(parsed.injectSteps).toHaveLength(1);
  return parsed.injectSteps[0]!.systemMessage.systemMessage;
}

async function joinFromAgy(owner: string, home: string, code: string): Promise<string> {
  const bin = scratch("agy-bin");
  symlinkSync(process.execPath, join(bin, "agy"));
  const cli = join(bin, "agy-cli.ts");
  writeFileSync(cli, "const child = Bun.spawn(process.argv.slice(2), { stdout: 'inherit', stderr: 'inherit' });\nconsole.log(`joined: ${await child.exited}`);\n");
  const env = { ANTIGRAVITY_AGENT: "1", ANTIGRAVITY_CONVERSATION_ID: CONVERSATION, CLAUDECODE: "", KIWI_MODEL: "gemini-3.8-flash-low" };
  const p = spawn(home, ["join", code, "--timeout", "40s"], env, home, undefined, [join(bin, "agy"), cli]);
  let out = "";
  void (async () => {
    for await (const chunk of p.stdout) out += new TextDecoder().decode(chunk);
  })();
  await until(() => out.includes("waiting for the owner"), "the join asking");
  let listed = "";
  await until(async () => /\d{3}-\d{3}/.test((listed = await ok(owner, ["--as", "human", "requests"]))), "the request listed with its code");
  await ok(owner, ["--as", "human", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes"]);
  await until(() => out.includes("joined: "), "the join ending");
  expect(out).toContain("joined: 0");
  return youAre(out);
}

describe("Antigravity CLI's hooks answer in agy's format", () => {
  test("session start and each model call inject a system message, and the stop continues the turn while messages are unread", async () => {
    const owner = scratch("agy-own");
    const code = created(await ok(owner, ["create", "agyroom", "--as", "boss"]));
    const home = scratch("agy-seat");
    const me = await joinFromAgy(owner, home, code);

    const hooksDir = scratch("agy-config");
    const hook = (event: string, stdin: string) => run(home, ["--harness", "agy", "hook", event], { ANTIGRAVITY_CONVERSATION_ID: CONVERSATION, CLAUDECODE: "" }, hooksDir, stdin);

    const start = await hook("session-start", agyInput(home));
    expect(start.code).toBe(0);
    expect(injected(start.out)).toContain(`You're "${me}"`);

    await ok(owner, ["send", "--to", me, "first message for agy"]);
    const prompt = await hook("prompt", agyInput(home, { invocationNum: 0, initialNumSteps: 1 }));
    expect(prompt.code).toBe(0);
    expect(injected(prompt.out)).toContain("first message for agy");
    expect((await hook("prompt", agyInput(home, { invocationNum: 1, initialNumSteps: 1 }))).out).toBe("");

    await ok(owner, ["send", "--to", me, "second message for agy"]);
    const cancelled = await hook("stop", agyInput(home, { executionNum: 0, terminationReason: "USER_CANCELED", fullyIdle: true, error: "" }));
    expect(cancelled.code).toBe(0);
    expect(cancelled.out).toBe("");

    const stop = await hook("stop", agyInput(home, { executionNum: 0, terminationReason: "NO_TOOL_CALL", fullyIdle: true, error: "" }));
    expect(stop.code).toBe(0);
    const answer = JSON.parse(stop.out) as Continue;
    expect(answer.decision).toBe("continue");
    expect(answer.reason).toContain("second message for agy");

    expect((await hook("stop", agyInput(home, { executionNum: 1, terminationReason: "NO_TOOL_CALL", fullyIdle: true, error: "" }))).out).toBe("");
  });
});
