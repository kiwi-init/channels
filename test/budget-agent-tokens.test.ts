import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";

setDefaultTimeout(300_000);

interface Step {
  intent: string;
  calls: number;
  chars: number;
  shown: string;
}

const BUDGET = {
  brief: 4_400,
  shortHelp: 1_250,
  oneCommandHelp: 1_700,
  wrappingPerMessage: 40,
  everyday: 300,
  status: 800,
  busyTurn: 600,
} as const;

let steps: Step[] = [];
const step = (intent: string): Step => {
  const s = steps.find((x) => x.intent === intent);
  if (!s) throw new Error(`no step "${intent}" in scripts/agent-cost.ts`);
  return s;
};

beforeAll(async () => {
  const p = Bun.spawn(["bun", join(import.meta.dir, "../scripts/agent-cost.ts"), "--json"], { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  if ((await p.exited) !== 0) throw new Error(`scripts/agent-cost.ts failed:\n${err}`);
  steps = JSON.parse(out.trim().split("\n").at(-1)!) as Step[];
});

describe("what Channels adds to an agent's session, against a local relay (scripts/agent-cost.ts)", () => {
  test("the brief, once per session", () => {
    const s = step("session start (hook)");
    if (s.chars > BUDGET.brief) throw new Error(`the brief is ${s.chars} chars, the budget ${BUDGET.brief}:\n${s.shown}`);
  });

  test("an idle turn adds nothing", () => {
    expect(step("an idle turn (prompt + stop hooks)").chars).toBeLessThanOrEqual(2);
  });

  test("a message arrives with little around it", () => {
    const burst = step("15 messages arrive at once (prompt hook)");
    const bodies = [...burst.shown.matchAll(/: (Status update \d+: .*|Agent note \d+: .*)$/gm)].map((m) => m[1]!);
    expect(bodies).toHaveLength(15);
    expect((burst.chars - bodies.join("").length) / bodies.length).toBeLessThanOrEqual(BUDGET.wrappingPerMessage);
  });

  test("everyday intentions are one call each, with a short answer", () => {
    for (const intent of [
      "reply to a message",
      "post an update",
      "answer a message sent to everyone",
      "file a task",
      "take a task",
      "file a task and take it",
      "finish a task",
      "read one message in full",
    ]) {
      const s = step(intent);
      expect([intent, s.calls]).toEqual([intent, 1]);
      expect([intent, s.chars <= BUDGET.everyday]).toEqual([intent, true]);
    }
  });

  test("filing a task and taking it is one call", () => {
    expect(step("file a task and take it").shown).toMatch(/added T\d+, doing @/);
  });

  test("a second agent replying to a message someone already answers is told who, and sends nothing", () => {
    const s = step("a second agent answers it too");
    expect(s.calls).toBe(1);
    expect(s.shown).toContain("is answering #");
    expect(s.shown).toContain("nothing was sent");
  });

  test("help is a short page, and one command's options on request", () => {
    expect(step("read the help the brief points to").chars).toBeLessThanOrEqual(BUDGET.shortHelp);
    expect(step("read one command's options").chars).toBeLessThanOrEqual(BUDGET.oneCommandHelp);
  });

  test("in a busy channel an agent is sent only what's for it: #general, and what @mentions it", () => {
    const s = step("a busy channel: 19 messages, 4 for this agent (prompt hook)");
    for (const i of [1, 2, 3]) expect(s.shown).toContain(`Heads-up ${i}: staging is frozen`);
    expect(s.shown).toContain("can you check the new login screen copy?");
    for (const elsewhere of ["Progress ", "Design note ", "Direct "]) expect([elsewhere, s.shown.includes(elsewhere)]).toEqual([elsewhere, false]);
    expect(s.chars).toBeLessThanOrEqual(BUDGET.busyTurn);
  });

  test("status stays one screen", () => {
    expect(step("see who's here and what's open").chars).toBeLessThanOrEqual(BUDGET.status);
  });
});
